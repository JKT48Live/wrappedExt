let originalMemberHTML = "";
const originalMemberHTMLByUrl = new Map();
let teamSortEnabled = true;
let lastMemberViewUrl = window.location.href;
let memberRouteRefreshTimer = null;
const WRAPPED_MEMBER_GRID_ATTR = 'data-wrapped-member-grid';
const WRAPPED_TEAM_SECTION_ATTR = 'data-wrapped-team-sections';
const WRAPPED_PAGE_AUTH_BRIDGE_ID = 'jkt48-wrapped-auth-bridge';
const WRAPPED_PAGE_AUTH_REQUEST = 'JKT48_WRAPPED_AUTH_REQUEST';
const WRAPPED_PAGE_AUTH_RESPONSE = 'JKT48_WRAPPED_AUTH_RESPONSE';
const pageContextAuthState = {
    accessToken: null,
    refreshToken: null,
    lastUpdatedAt: 0
};

function updatePageContextAuthState(payload = {}) {
    if (payload.accessToken) {
        pageContextAuthState.accessToken = payload.accessToken;
    }

    if (payload.refreshToken) {
        pageContextAuthState.refreshToken = payload.refreshToken;
    }

    if (payload.accessToken || payload.refreshToken) {
        pageContextAuthState.lastUpdatedAt = Date.now();
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window) {
        return;
    }

    if (event.data?.type !== WRAPPED_PAGE_AUTH_RESPONSE) {
        return;
    }

    updatePageContextAuthState(event.data);
});

function injectPageAuthBridge() {
    if (document.getElementById(WRAPPED_PAGE_AUTH_BRIDGE_ID)) {
        return;
    }

    const script = document.createElement('script');
    script.id = WRAPPED_PAGE_AUTH_BRIDGE_ID;
    script.textContent = `
        (() => {
            const REQUEST = '${WRAPPED_PAGE_AUTH_REQUEST}';
            const RESPONSE = '${WRAPPED_PAGE_AUTH_RESPONSE}';
            const authState = {
                accessToken: null,
                refreshToken: null
            };

            const emitAuthState = () => {
                window.postMessage({
                    type: RESPONSE,
                    accessToken: authState.accessToken,
                    refreshToken: authState.refreshToken
                }, '*');
            };

            const captureFromValue = (value) => {
                if (!value) return;
                if (typeof value === 'string' && value.startsWith('Bearer ')) {
                    authState.accessToken = value.slice(7);
                    emitAuthState();
                }
            };

            const originalFetch = window.fetch;
            if (typeof originalFetch === 'function') {
                window.fetch = async function(...args) {
                    const requestInit = args[1];
                    if (requestInit?.headers) {
                        if (requestInit.headers instanceof Headers) {
                            captureFromValue(requestInit.headers.get('authorization'));
                        } else if (Array.isArray(requestInit.headers)) {
                            const authHeader = requestInit.headers.find(([key]) => String(key).toLowerCase() === 'authorization');
                            captureFromValue(authHeader?.[1]);
                        } else if (typeof requestInit.headers === 'object') {
                            captureFromValue(requestInit.headers.authorization || requestInit.headers.Authorization);
                        }
                    }

                    return originalFetch.apply(this, args);
                };
            }

            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function(...args) {
                this.__wrappedRequestUrl = args[1];
                return originalOpen.apply(this, args);
            };
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                if (String(name).toLowerCase() === 'authorization') {
                    captureFromValue(value);
                }
                return originalSetRequestHeader.apply(this, arguments);
            };

            window.addEventListener('message', async (event) => {
                if (event.source !== window || event.data?.type !== REQUEST) {
                    return;
                }

                if (event.data?.forceRefresh || !authState.accessToken) {
                    try {
                        const response = await originalFetch('/api/auth/session', {
                            credentials: 'include',
                            headers: {
                                accept: 'application/json, text/plain, */*'
                            }
                        });

                        if (response.ok) {
                            const json = await response.json();
                            if (json?.access_token) authState.accessToken = json.access_token;
                            if (json?.refresh_token) authState.refreshToken = json.refresh_token;
                        }
                    } catch (_) {
                        // Ignore session fetch failure in page bridge.
                    }
                }

                emitAuthState();
            });
        })();
    `;

    (document.documentElement || document.head || document.body).appendChild(script);
}

async function requestPageContextAuthState(forceRefresh = false, timeoutMs = 1500) {
    injectPageAuthBridge();

    return await new Promise((resolve) => {
        const start = Date.now();
        const finish = () => resolve({ ...pageContextAuthState });

        const messageHandler = (event) => {
            if (event.source !== window || event.data?.type !== WRAPPED_PAGE_AUTH_RESPONSE) {
                return;
            }

            window.removeEventListener('message', messageHandler);
            finish();
        };

        window.addEventListener('message', messageHandler);
        window.postMessage({ type: WRAPPED_PAGE_AUTH_REQUEST, forceRefresh }, '*');

        setTimeout(() => {
            window.removeEventListener('message', messageHandler);
            if (Date.now() - start >= timeoutMs) {
                finish();
            }
        }, timeoutMs);
    });
}

function isMemberPage() {
    return window.location.pathname === "/member";
}

function isSortableMemberPage() {
    const memberType = new URLSearchParams(window.location.search).get('type');
    return isMemberPage() && memberType !== 'TRAINEE';
}

function getMemberGridContainer() {
    const taggedGrid = document.querySelector(`[${WRAPPED_MEMBER_GRID_ATTR}="true"]`);
    if (taggedGrid) {
        return taggedGrid;
    }

    const firstMemberCard = document.querySelector('a.member-card');
    if (!firstMemberCard) {
        return null;
    }

    const memberGrid = firstMemberCard.parentElement;
    if (memberGrid) {
        memberGrid.setAttribute(WRAPPED_MEMBER_GRID_ATTR, 'true');
    }

    return memberGrid;
}

function scheduleMemberSortRefresh() {
    if (!isSortableMemberPage() || !teamSortEnabled) {
        return;
    }

    if (memberRouteRefreshTimer) {
        clearTimeout(memberRouteRefreshTimer);
    }

    memberRouteRefreshTimer = setTimeout(() => {
        handleSortLogic(true);
    }, 250);
}

function isSortedMemberGrid(memberGrid) {
    return memberGrid?.getAttribute(WRAPPED_TEAM_SECTION_ATTR) === 'true';
}

function captureOriginalMemberHTML(memberGrid, force = false) {
    if (!memberGrid) {
        return;
    }

    if (!force && isSortedMemberGrid(memberGrid)) {
        return;
    }

    const hasMemberCards = memberGrid.querySelector('a.member-card');
    if (!hasMemberCards) {
        return;
    }

    originalMemberHTML = memberGrid.innerHTML;
    originalMemberHTMLByUrl.set(window.location.href, originalMemberHTML);
}

function getOriginalMemberHTMLForCurrentView() {
    return originalMemberHTMLByUrl.get(window.location.href) || originalMemberHTML || '';
}

function normalizeMemberCardElements(root) {
    if (!root) {
        return;
    }

    root.querySelectorAll('.member-card-inner').forEach(card => {
        card.style.opacity = '1';
        card.style.transform = 'translate(0px, 0px)';
        card.style.translate = 'none';
        card.style.rotate = 'none';
        card.style.scale = 'none';
    });

    root.querySelectorAll('.member-card').forEach(card => {
        card.classList.add('aos-animate');
    });
}

async function handleSortLogic(isEnabled) {
    const memberGrid = getMemberGridContainer();
    if (!memberGrid) return;

    if (isEnabled) {
        if (!originalMemberHTML || originalMemberHTML.trim() === "" || !isSortedMemberGrid(memberGrid)) {
            captureOriginalMemberHTML(memberGrid);
        }
        await applyTeamSort();
    } else {
        memberGrid.removeAttribute(WRAPPED_TEAM_SECTION_ATTR);
        const originalHTML = getOriginalMemberHTMLForCurrentView();
        if (originalHTML) {
            memberGrid.innerHTML = originalHTML;
            normalizeMemberCardElements(memberGrid);
            window.scrollTo(0, 0);
            console.log("Tampilan dikembalikan ke semula.");
        } else {
            console.warn("Restore dibatalkan karena snapshot member asli belum tersedia.");
        }
    }
}

window.addEventListener("DO_TEAM_SORT", (e) => {
    teamSortEnabled = Boolean(e.detail.status);
    handleSortLogic(e.detail.status);
});

if (isMemberPage()) {
    const checkExist = setInterval(() => {
        const memberGrid = getMemberGridContainer();
        if (memberGrid) {
            if (isSortableMemberPage()) {
                handleSortLogic(true);
            }
            clearInterval(checkExist);
        }
    }, 100);
}

function handleMemberRouteChange() {
    if (window.location.href === lastMemberViewUrl) {
        return;
    }

    lastMemberViewUrl = window.location.href;

    if (!isMemberPage()) {
        originalMemberHTML = "";
        return;
    }

    if (!isSortableMemberPage()) {
        return;
    }

    const memberGrid = getMemberGridContainer();
    if (memberGrid && !isSortedMemberGrid(memberGrid)) {
        captureOriginalMemberHTML(memberGrid, true);
    }

    scheduleMemberSortRefresh();
}

window.addEventListener("popstate", handleMemberRouteChange);

const originalContentPushState = history.pushState;
history.pushState = function (...args) {
    const result = originalContentPushState.apply(this, args);
    handleMemberRouteChange();
    return result;
};

const originalContentReplaceState = history.replaceState;
history.replaceState = function (...args) {
    const result = originalContentReplaceState.apply(this, args);
    handleMemberRouteChange();
    return result;
};

const memberPageObserver = new MutationObserver(() => {
    if (!isSortableMemberPage() || !teamSortEnabled) {
        return;
    }

    const memberGrid = getMemberGridContainer();
    if (!memberGrid) {
        return;
    }

    const hasSortedSections = memberGrid.getAttribute(WRAPPED_TEAM_SECTION_ATTR) === 'true';
    if (!hasSortedSections && window.location.href === lastMemberViewUrl) {
        captureOriginalMemberHTML(memberGrid, true);
        scheduleMemberSortRefresh();
    }
});

memberPageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
});

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        const API_BASE_URL = 'https://jkt48.com/api/v1/accounts';
        let cachedAuthToken = null;
        let cachedRefreshToken = null;
        let cachedSessionPayload = null;
        let cachedSessionFetchedAt = 0;
        let cachedMembersPromise = null;
        const DEFAULT_MEMBER_IMAGE = 'https://jkt48.com/images/no-image-2.png';
        const SESSION_CACHE_TTL_MS = 60 * 1000;
        const PAGINATION_DELAY_MS = 250;

        function extractJwtCandidatesFromValue(value, bucket = []) {
            if (!value) return bucket;

            if (typeof value === 'string') {
                const jwtMatches = value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g);
                if (jwtMatches) {
                    bucket.push(...jwtMatches);
                }

                try {
                    const parsed = JSON.parse(value);
                    extractJwtCandidatesFromValue(parsed, bucket);
                } catch (_) {
                    // Ignore non-JSON strings.
                }

                return bucket;
            }

            if (Array.isArray(value)) {
                value.forEach(item => extractJwtCandidatesFromValue(item, bucket));
                return bucket;
            }

            if (typeof value === 'object') {
                Object.values(value).forEach(item => extractJwtCandidatesFromValue(item, bucket));
            }

            return bucket;
        }

        function reportProgress(message) {
            chrome.runtime.sendMessage({
                action: 'PROGRESS_UPDATE',
                message
            });
        }

        function delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function getSessionPayload(forceRefresh = false) {
            const isCacheFresh = !forceRefresh
                && cachedSessionPayload
                && (Date.now() - cachedSessionFetchedAt < SESSION_CACHE_TTL_MS);

            if (isCacheFresh) {
                return cachedSessionPayload;
            }

            try {
                const sessionResponse = await fetch('https://jkt48.com/api/auth/session', {
                    credentials: 'include',
                    headers: {
                        'accept': 'application/json, text/plain, */*'
                    }
                });

                if (!sessionResponse.ok) {
                    return null;
                }

                const sessionJson = await sessionResponse.json();
                cachedSessionPayload = sessionJson;
                cachedSessionFetchedAt = Date.now();
                cachedAuthToken = sessionJson?.access_token || cachedAuthToken;
                cachedRefreshToken = sessionJson?.refresh_token || cachedRefreshToken;
                return sessionJson;
            } catch (_) {
                return null;
            }
        }

        async function getAuthToken(forceRefresh = false) {
            if (!forceRefresh && cachedAuthToken) {
                return cachedAuthToken;
            }

            const candidateValues = [];

            const pageContextTokens = await requestPageContextAuthState(forceRefresh);
            if (pageContextTokens?.accessToken) {
                cachedAuthToken = pageContextTokens.accessToken;
                cachedRefreshToken = pageContextTokens.refreshToken || cachedRefreshToken;
                return cachedAuthToken;
            }

            const sessionPayload = await getSessionPayload(forceRefresh);
            if (sessionPayload) {
                candidateValues.push(sessionPayload);
            }

            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key) {
                        candidateValues.push(localStorage.getItem(key));
                    }
                }
            } catch (error) {
                console.warn('Unable to read localStorage:', error);
            }

            try {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key) {
                        candidateValues.push(sessionStorage.getItem(key));
                    }
                }
            } catch (error) {
                console.warn('Unable to read sessionStorage:', error);
            }

            const jwtCandidates = extractJwtCandidatesFromValue(candidateValues);
            cachedAuthToken = jwtCandidates.find(token => token.split('.').length === 3) || null;
            return cachedAuthToken;
        }

        async function fetchApiJson(path, page = null) {
            const url = new URL(`${API_BASE_URL}/${path}`);
            url.searchParams.set('lang', 'id');

            if (page !== null) {
                url.searchParams.set('page', page);
            }

            const authToken = await getAuthToken();
            const headers = {
                'accept': 'application/json, text/plain, */*'
            };

            if (authToken) {
                headers.authorization = `Bearer ${authToken}`;
            }

            const response = await fetch(url.toString(), {
                credentials: 'include',
                headers
            });

            if (!response.ok) {
                const error = new Error(`HTTP error! Status: ${response.status} (${path})${authToken ? '' : ' - bearer token not found'}`);
                error.status = response.status;
                throw error;
            }

            return response.json();
        }

        async function fetchApiJsonWithRetry(path, page = null, retries = 2) {
            let lastError = null;

            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    if (attempt > 0) {
                        cachedAuthToken = null;
                        cachedSessionPayload = null;
                        cachedSessionFetchedAt = 0;
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                    }

                    return await fetchApiJson(path, page);
                } catch (error) {
                    lastError = error;
                    if ((error?.status === 401 || error?.status === 403) && attempt < retries) {
                        reportProgress('Menyegarkan sesi login...');
                        const refreshedSession = await getSessionPayload(true);
                        if (refreshedSession?.access_token) {
                            cachedAuthToken = refreshedSession.access_token;
                            cachedRefreshToken = refreshedSession.refresh_token || cachedRefreshToken;
                            continue;
                        }
                    }
                    const isNetworkError = error instanceof TypeError || /Failed to fetch/i.test(error?.message || '');
                    if (!isNetworkError || attempt === retries) {
                        throw error;
                    }
                    console.warn(`Retrying ${path}${page !== null ? ` page ${page}` : ''} after fetch failure (attempt ${attempt + 1}/${retries + 1})`, error);
                }
            }

            throw lastError;
        }

        async function fetchPurchaseHistoryPage(page) {
            const json = await fetchApiJsonWithRetry('purchase-history', page);
            return {
                items: Array.isArray(json?.data) ? json.data : [],
                meta: json?._meta || {}
            };
        }

        async function fetchAllPurchaseHistory() {
            try {
                reportProgress('Mengambil histori transaksi...');
                const firstPage = await fetchPurchaseHistoryPage(1);
                const totalPages = parseInt(firstPage.meta?.total_page, 10) || 1;
                let allData = firstPage.items;

                for (let page = 2; page <= totalPages; page++) {
                    try {
                        await delay(PAGINATION_DELAY_MS);
                        reportProgress(`Mengambil histori transaksi halaman ${page}/${totalPages}...`);
                        const nextPage = await fetchPurchaseHistoryPage(page);
                        allData = allData.concat(nextPage.items);
                    } catch (error) {
                        console.error(`Error fetching purchase history page ${page}:`, error);
                        break;
                    }
                }

                return allData;
            } catch (error) {
                console.error('Error fetchAllPurchaseHistory:', error);
                return [];
            }
        }

        async function fetchUserProfile() {
            try {
                reportProgress('Mengambil profil user...');
                const json = await fetchApiJsonWithRetry('user');
                return json?.data || null;
            } catch (error) {
                console.error('Error fetchUserProfile:', error);
                return null;
            }
        }

        function formatMembershipDate(dateString) {
            if (!dateString) {
                return '';
            }

            const date = new Date(dateString);
            if (Number.isNaN(date.getTime())) {
                return '';
            }

            return date.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }

        function getMembershipDuration(dateString) {
            if (!dateString) {
                return '';
            }

            const startDate = new Date(dateString);
            const now = new Date();

            if (Number.isNaN(startDate.getTime()) || startDate > now) {
                return '';
            }

            let years = now.getFullYear() - startDate.getFullYear();
            let months = now.getMonth() - startDate.getMonth();
            let days = now.getDate() - startDate.getDate();

            if (days < 0) {
                months -= 1;
                days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
            }

            if (months < 0) {
                years -= 1;
                months += 12;
            }

            if (years > 0) {
                return `${years} tahun`;
            }

            if (months > 0) {
                return `${months} bulan`;
            }

            return `${Math.max(days, 0)} hari`;
        }

        async function fetchAllMembers() {
            if (cachedMembersPromise) {
                return cachedMembersPromise;
            }

            cachedMembersPromise = (async () => {
                try {
                    const response = await fetch('https://jkt48.com/api/v1/members?lang=id', {
                        credentials: 'include',
                        headers: {
                            'accept': 'application/json, text/plain, */*'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status} (members)`);
                    }

                    const json = await response.json();
                    return Array.isArray(json?.data) ? json.data : [];
                } catch (error) {
                    console.error('Error fetchAllMembers:', error);
                    return [];
                }
            })();

            return cachedMembersPromise;
        }

        async function getOshiPhotoById(oshimenId) {
            if (!oshimenId) {
                return DEFAULT_MEMBER_IMAGE;
            }

            const members = await fetchAllMembers();
            const matchedMember = members.find(member => Number(member?.jkt48_member_id) === Number(oshimenId));
            return matchedMember?.photo || DEFAULT_MEMBER_IMAGE;
        }

        const getTotalPages = async () => {
            try {
                const { meta } = await fetchPurchaseHistoryPage(1);
                return parseInt(meta?.total_page, 10) || 0;
            } catch (error) {
                console.error('Error fetching getTotalPages total pages:', error);
                return 0;
            }
        };

        async function getAllYears() {
            try {
                const totalPages = await getTotalPages().then(res => res);
                const uniqueYears = new Set();

                for (let page = 1; page <= totalPages; page++) {
                    const tableData = await scrapeTableData(page).then(res => res);
                    tableData.forEach(row => {
                        const year = row?.createdYear;
                        uniqueYears.add(year);
                    });
                }

                uniqueYears.delete(undefined);
                uniqueYears.delete(null);
                uniqueYears.delete(NaN);

                const currentYear = new Date().getFullYear();
                const yearsArray = Array.from(uniqueYears);
                if (yearsArray.length === 0) {
                    return [currentYear];
                }
                const maxYear = yearsArray.length ? Math.max(...yearsArray) : currentYear;

                for (let y = maxYear + 1; y <= currentYear; y++) {
                    uniqueYears.add(y);
                }

                return Array.from(uniqueYears).sort((a, b) => b - a);
            } catch (error) {
                console.error("Error getAllYears:", error);
                return false;
            }
        }

        async function scrapeTableData(page) {
            try {
                const { items } = await fetchPurchaseHistoryPage(page);

                return items.map(item => ({
                    ...item,
                    createdYear: item?.created_date ? new Date(item.created_date).getFullYear() : null
                }));
            } catch (error) {
                console.error(`Error fetching data from page ${page}:`, error);
                return [];
            }
        }

        if (request?.action === 'login') {
            async function login() {
                try {
                    reportProgress('Menganalisis tahun transaksi yang tersedia...');
                    const years = await getAllYears();
                    const yrs = years.map(year => ({ year }));

                    return { success: true, sessionActive: true, data: yrs };
                } catch (error) {
                    if (error?.status === 401 || error?.status === 403) {
                        return { success: false, sessionActive: false, message: "Sesi login tidak aktif" };
                    }
                    console.error(error);
                    return { success: false, sessionActive: true, message: "Terjadi kesalahan pada server" };
                }
            }

            login().then(response => {
                sendResponse({ data: response });
            }).catch(error => {
                console.error('Error:', error);
                sendResponse({ success: false, message: "Terjadi kesalahan pada server" });
            });
            return true;
        }
        if (request?.action === 'scrap') {
            async function getAllTableData() {
                try {
                    return await fetchAllPurchaseHistory();
                } catch (error) {
                    console.error("Error getAllTableData:", error);
                    return false;
                }
            }

            function extractAndSumValuesByYear(data) {
                let yearSummary = {};

                data.forEach(transaction => {
                    const year = transaction?.created_date ? new Date(transaction.created_date).getFullYear() : null;
                    if (!year) return;

                    const isTopUp = transaction?.type === 'JKT48POINT';
                    const isPointSpend = transaction?.payment_method_name === 'JKT48 Point';
                    const usage = isTopUp ? 'JKT48 Points' : (transaction?.title || transaction?.type || 'Lainnya');

                    let bonus = 0;
                    let point = 0;

                    if (isTopUp) {
                        point = Number(transaction?.total_quantity ?? transaction?.total_amount ?? 0);
                    } else if (isPointSpend) {
                        point = -Math.abs(Number(transaction?.payment_amount ?? transaction?.total_amount ?? 0));
                    } else {
                        return;
                    }

                    if (!yearSummary[year]) {
                        yearSummary[year] = { summary: {}, totalBonus: 0, totalPoints: 0 };
                    }

                    if (!yearSummary[year].summary[usage]) {
                        yearSummary[year].summary[usage] = { totalBonus: 0, totalPoints: 0 };
                    }

                    yearSummary[year].summary[usage].totalBonus += bonus;
                    yearSummary[year].summary[usage].totalPoints += point;
                    yearSummary[year].totalBonus += bonus;
                    yearSummary[year].totalPoints += point;
                });

                return yearSummary;
            }

            async function myPage() {
                try {
                    const profile = await fetchUserProfile();
                    if (!profile) {
                        return false;
                    }

                    const oshi = profile.oshimen_name || "<s>Tidak ada</s> / 1 Jeketi";
                    const oshiPic = await getOshiPhotoById(profile.oshimen_id);
                    const userPic = profile.profile_picture || DEFAULT_MEMBER_IMAGE;
                    const memberSince = formatMembershipDate(profile.created_date);
                    const memberDuration = getMembershipDuration(profile.created_date);
                    const isOfc = Number(profile.is_ofc) === 1;
                    const teaterKedatangan = '';
                    const jkt48Points = '';
                    const bonusPoints = '';

                    return {
                        oshi,
                        userPic,
                        teaterKedatangan,
                        jkt48Points,
                        bonusPoints,
                        oshiPic,
                        memberSince,
                        memberDuration,
                        isOfc
                    };
                } catch (error) {
                    console.error("Error myPage:", error);
                    return false;
                }
            }

            async function scrapeProfile() {
                try {
                    const profile = await fetchUserProfile();
                    return profile?.nickname || profile?.full_name || null;
                } catch (error) {
                    console.error('Error fetching data from profile page:', error);
                    return null;
                }
            }

            function getHistoryDateRange() {
                const today = new Date();
                return {
                    from: '2011-11-02',
                    to: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
                };
            }

            let cachedMyTicketsPromise = null;

            async function fetchMyTicketsPage(page) {
                const { from, to } = getHistoryDateRange();
                const url = new URL(`${API_BASE_URL}/my-tickets`);
                url.searchParams.set('lang', 'id');
                url.searchParams.set('limit', '1000');
                url.searchParams.set('page', page);
                url.searchParams.set('from', from);
                url.searchParams.set('to', to);

                const authToken = await getAuthToken();
                const headers = { 'accept': 'application/json, text/plain, */*' };

                if (authToken) {
                    headers.authorization = `Bearer ${authToken}`;
                }

                const response = await fetch(url.toString(), {
                    credentials: 'include',
                    headers
                });

                if (!response.ok) {
                    const error = new Error(`HTTP error! Status: ${response.status} (my-tickets)${authToken ? '' : ' - bearer token not found'}`);
                    error.status = response.status;
                    throw error;
                }

                const json = await response.json();
                return {
                    items: Array.isArray(json?.data) ? json.data : [],
                    meta: json?._meta || {}
                };
            }

            async function fetchMyTicketsPageWithRetry(page, retries = 2) {
                let lastError = null;

                for (let attempt = 0; attempt <= retries; attempt++) {
                    try {
                        if (attempt > 0) {
                            cachedAuthToken = null;
                            cachedSessionPayload = null;
                            cachedSessionFetchedAt = 0;
                            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                        }

                        return await fetchMyTicketsPage(page);
                    } catch (error) {
                        lastError = error;
                        if ((error?.status === 401 || error?.status === 403) && attempt < retries) {
                            reportProgress('Menyegarkan token akses...');
                            const refreshedSession = await getSessionPayload(true);
                            if (refreshedSession?.access_token) {
                                cachedAuthToken = refreshedSession.access_token;
                                cachedRefreshToken = refreshedSession.refresh_token || cachedRefreshToken;
                                continue;
                            }
                        }
                        const isNetworkError = error instanceof TypeError || /Failed to fetch/i.test(error?.message || '');
                        if (!isNetworkError || attempt === retries) {
                            throw error;
                        }
                        console.warn(`Retrying my-tickets page ${page} after fetch failure (attempt ${attempt + 1}/${retries + 1})`, error);
                    }
                }

                throw lastError;
            }

            async function fetchAllMyTickets() {
                if (cachedMyTicketsPromise) {
                    return cachedMyTicketsPromise;
                }

                cachedMyTicketsPromise = (async () => {
                try {
                    reportProgress('Mengambil histori tiket...');
                    const firstPage = await fetchMyTicketsPageWithRetry(1);
                    const totalPages = parseInt(firstPage.meta?.total_page, 10) || 1;
                    let allTickets = firstPage.items;

                    for (let page = 2; page <= totalPages; page++) {
                        try {
                            await delay(PAGINATION_DELAY_MS);
                            reportProgress(`Mengambil histori tiket halaman ${page}/${totalPages}...`);
                            const nextPage = await fetchMyTicketsPageWithRetry(page);
                            allTickets = allTickets.concat(nextPage.items);
                        } catch (error) {
                            console.error(`Error fetching my-tickets page ${page}:`, error);
                            break;
                        }
                    }

                    return allTickets;
                } catch (error) {
                    console.error('Error fetchAllMyTickets:', error);
                    return [];
                }
                })();

                return cachedMyTicketsPromise;
            }

            function normalizeTransactionNumber(item) {
                return item?.transaction_numbers?.[0] || item?.reference_code || item?.name || JSON.stringify(item);
            }

            function getTicketYear(item) {
                const sourceDate = item?.date || item?.expired_date;
                return sourceDate ? new Date(sourceDate).getFullYear() : null;
            }

            function getTicketDate(item) {
                return item?.date || item?.expired_date || null;
            }

            function groupShowTickets(tickets, year = null) {
                const filtered = tickets.filter(item => {
                    if (item?.ticket_type !== 'SHOW') return false;
                    const itemYear = getTicketYear(item);
                    return year ? itemYear === Number(year) : true;
                });

                const grouped = new Map();

                filtered.forEach(item => {
                    const key = normalizeTransactionNumber(item);
                    if (!grouped.has(key)) {
                        grouped.set(key, []);
                    }
                    grouped.get(key).push(item);
                });

                return Array.from(grouped.values()).map(items => {
                    const sample = items[0];
                    const hasLose = items.some(item => item?.raffle_status === 'LOSE');
                    const usedCount = items.reduce((max, item) => Math.max(max, Number(item?.used_count || 0)), 0);
                    const isWin = !hasLose && (usedCount > 0 || items.length === 1);

                    return {
                        name: sample?.ticket_label || sample?.name || 'Unknown Show',
                        date: getTicketDate(sample),
                        isWin,
                        isLoss: hasLose
                    };
                });
            }

            async function fetchTopSetlists(year = null) {
                try {
                    const tickets = await fetchAllMyTickets();
                    const showGroups = groupShowTickets(tickets, year);
                    let setlistCounts = {};

                    showGroups.forEach(item => {
                        if (!setlistCounts[item.name]) {
                            setlistCounts[item.name] = { appearances: 0, wins: 0 };
                        }

                        setlistCounts[item.name].appearances++;
                        if (item.isWin) {
                            setlistCounts[item.name].wins++;
                        }
                    });

                    const topByWins = Object.entries(setlistCounts)
                        .filter(([_, count]) => count.wins > 0)
                        .sort((a, b) => b[1].wins - a[1].wins)
                        .slice(0, 3)
                        .map(item => ({ name: item[0], wins: item[1].wins }));

                    const topByApply = Object.entries(setlistCounts)
                        .sort((a, b) => b[1].appearances - a[1].appearances)
                        .slice(0, 3)
                        .map(item => ({ name: item[0], appearances: item[1].appearances }));

                    return { topByWins, topByApply };
                } catch (error) {
                    console.error("Error fetchTopSetlists:", error);
                    return { topByWins: [], topByApply: [] };
                }
            }

            async function calculateWinLossRate(year = null) {
                try {
                    const tickets = await fetchAllMyTickets();
                    const showGroups = groupShowTickets(tickets, year);
                    let wins = 0;
                    let losses = 0;

                    showGroups.forEach(item => {
                        if (item.isWin) {
                            wins++;
                        } else if (item.isLoss) {
                            losses++;
                        }
                    });

                    const totalGames = wins + losses;
                    const winRate = totalGames > 0 ? (wins / totalGames) * 100 : 0;

                    return {
                        year: year || 'All Time',
                        wins,
                        losses,
                        winRate: winRate.toFixed(2) + '%'
                    };
                } catch (error) {
                    console.error("Error calculateWinLossRate:", error);
                    return { year: year || 'All Time', wins: 0, losses: 0, winRate: '0.00%' };
                }
            }

            function filterTicketsByYearAndType(tickets, type, year = null) {
                return tickets.filter(item => {
                    if (item?.ticket_type !== type) return false;
                    const itemYear = getTicketYear(item);
                    return year ? itemYear === Number(year) : true;
                });
            }

            async function fetchTopThreeEventWins(year) {
                try {
                    const tickets = await fetchAllMyTickets();
                    const eventTickets = filterTicketsByYearAndType(tickets, 'EVENT', year);
                    const grouped = new Map();

                    eventTickets.forEach(item => {
                        const key = normalizeTransactionNumber(item);
                        if (!grouped.has(key)) {
                            grouped.set(key, {
                                name: item?.ticket_label || item?.name || 'Unknown Event',
                                date: getTicketDate(item)
                            });
                        }
                    });

                    return Array.from(grouped.values())
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .slice(0, 3);
                } catch (error) {
                    console.error("Error in fetchTopThreeEventWins:", error);
                    return [];
                }
            }

            function isTwoShotTicket(item) {
                const text = [
                    item?.reference_code,
                    item?.ticket_label,
                    item?.name,
                    item?.session_label,
                    item?.lane_label
                ].filter(Boolean).join(' ').toLowerCase();

                return /two\s*shot|twoshot|2\s*shot|2shot/.test(text) || /^oext/i.test(item?.reference_code || '');
            }

            function isVideoCallTicket(item) {
                if (isTwoShotTicket(item)) return false;

                const text = [
                    item?.reference_code,
                    item?.ticket_label,
                    item?.name,
                    item?.session_label,
                    item?.lane_label
                ].filter(Boolean).join(' ').toLowerCase();

                return /video\s*call|videocall|vc|meet/.test(text) || /^oexh/i.test(item?.reference_code || '');
            }

            async function fetchTopVideoCallMembersByYear(year) {
                try {
                    const tickets = await fetchAllMyTickets();
                    const filtered = filterTicketsByYearAndType(tickets, 'EXCLUSIVE', year).filter(isVideoCallTicket);
                    let memberTicketData = {};
                    let totalTickets = 0;

                    filtered.forEach(item => {
                        const memberName = item?.member_name;
                        const ticketsBought = Number(item?.bought_count || 0);

                        if (!memberName || ticketsBought <= 0) return;

                        totalTickets += ticketsBought;
                        if (!memberTicketData[memberName]) {
                            memberTicketData[memberName] = 0;
                        }
                        memberTicketData[memberName] += ticketsBought;
                    });

                    const sortedMembers = Object.entries(memberTicketData)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(member => ({ name: member[0], tickets: member[1] }));

                    return { topMembers: sortedMembers, totalTickets };
                } catch (error) {
                    console.error('Error in fetchTopVideoCallMembersByYear:', error);
                    return { topMembers: [], totalTickets: 0 };
                }
            }

            async function fetchTopTwoShotMembersByYear(year) {
                try {
                    const tickets = await fetchAllMyTickets();
                    const filtered = filterTicketsByYearAndType(tickets, 'EXCLUSIVE', year).filter(isTwoShotTicket);
                    let memberTicketData = {};
                    let totalTickets = 0;

                    filtered.forEach(item => {
                        const memberName = item?.member_name;
                        const ticketsBought = Number(item?.bought_count || 0);

                        if (!memberName || ticketsBought <= 0) return;

                        totalTickets += ticketsBought;
                        if (!memberTicketData[memberName]) {
                            memberTicketData[memberName] = 0;
                        }
                        memberTicketData[memberName] += ticketsBought;
                    });

                    const sortedMembers = Object.entries(memberTicketData)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(member => ({ name: member[0], tickets: member[1] }));

                    return { topMembers: sortedMembers, totalTickets };
                } catch (error) {
                    console.error('Error in fetchTopTwoShotMembersByYear:', error);
                    return { topMembers: [], totalTickets: 0 };
                }
            }

            function formatYearData(byYear, year) {
                let result = `<b>=== ${year} ===</b>\n`;
                let totalTopup = 0;
                let totalBonus = 0;
                let totalSpend = 0;
                let totalBonusSpend = 0;

                if (byYear[year].summary['JKT48 Points']) {
                    totalTopup = byYear[year].summary['JKT48 Points'].totalPoints;
                    totalBonus = byYear[year].summary['JKT48 Points'].totalBonus;
                    result += `Topup: ${numbFormat(totalTopup)} P\n`;
                    if (byYear[year].summary['JKT48 Points'].totalBonus !== 0) {
                        result += `Bonus: ${numbFormat(byYear[year].summary['JKT48 Points'].totalBonus)} P\n`;
                    }
                    result += "\n";
                }

                for (let usage in byYear[year].summary) {
                    if (usage !== 'JKT48 Points') {
                        let spend = byYear[year].summary[usage].totalPoints;
                        let bonus = byYear[year].summary[usage].totalBonus;
                        totalSpend += Math.abs(spend);
                        totalBonusSpend += bonus;
                        result += `${usage}: ${numbFormat(spend)} P\n`;
                        if (byYear[year].summary[usage].totalBonus !== 0) {
                            result += `${usage} Bonus: ${numbFormat(byYear[year].summary[usage].totalBonus)} P\n`;
                        }
                    }
                }

                let sisaPoin = totalTopup - totalSpend;
                result += `\nTotal Spend: -${numbFormat(totalSpend)} P\n`;
                result += `Bonus Spend: ${numbFormat(totalBonusSpend)} P\n`;
                //result += `Sisa Point: ${numbFormat(sisaPoin)} P\n`;
                result += "====================\n\n";

                return { result, totalTopup, totalBonus, totalSpend, totalBonusSpend };
            }

            function numbFormat(number) {
                return new Intl.NumberFormat(['id']).format(number);
            }

            const getData = async (req, res) => {
                try {
                    const { year } = req.body;
                    reportProgress(`Menyusun data Wrapped ${year === 'all' ? 'All Time' : year}...`);
                    let data = {
                        theater: {},
                        events: {},
                        videoCall: {},
                        topUp: {},
                        twoShot: {}
                    };
            
                    if (year === "all") {
                        // Ambil semua tahun
                        const years = await getAllYears();
                        let allSetlists = [];
                        let allWinLossData = { wins: 0, losses: 0 };
                        let allVideoCalls = { topMembers: {}, totalTickets: 0 };
                        let allSpendTable = [];
                        let allEvents = [];
                        let allTwoShots = { topMembers: {}, totalTickets: 0 };
            
                        for (const yr of years) {

                            const [{ topByWins, topByApply }, winLossData, topVideoCalls, profile, spendTable, myPej, lastEvent, topTwoShots] = await Promise.all([
                                fetchTopSetlists(yr),
                                calculateWinLossRate(yr),
                                fetchTopVideoCallMembersByYear(yr),
                                scrapeProfile(),
                                getAllTableData(),
                                myPage(),
                                fetchTopThreeEventWins(yr),
                                fetchTopTwoShotMembersByYear(yr),
                            ]);
            
                            data.name = profile;
                            data.oshi = myPej.oshi;
                            data.userPic = myPej.userPic;
                            data.oshiPic = myPej.oshiPic;
                            data.memberSince = myPej.memberSince;
                            data.memberDuration = myPej.memberDuration;
                            data.isOfc = myPej.isOfc;

                            // Gabungkan data setlists
                            allSetlists = allSetlists.concat(topByWins);

                            // Gabungkan data setlist paling sering apply
                            if (!allApplied) var allApplied = [];
                            allApplied = allApplied.concat(topByApply);
            
                            // Tambahkan data win/loss
                            allWinLossData.wins += winLossData.wins;
                            allWinLossData.losses += winLossData.losses;
            
                            allEvents = allEvents.concat(lastEvent);

                            // Gabungkan data video calls
                            for (const member of topVideoCalls.topMembers) {
                                if (!allVideoCalls.topMembers[member.name]) {
                                    allVideoCalls.topMembers[member.name] = 0;
                                }
                                allVideoCalls.topMembers[member.name] += member.tickets;
                            }
                            allVideoCalls.totalTickets += topVideoCalls.totalTickets;

                            // Gabungkan data two shot
                            for (const member of topTwoShots.topMembers) {
                                if (!allTwoShots.topMembers[member.name]) {
                                    allTwoShots.topMembers[member.name] = 0;
                                }
                                allTwoShots.topMembers[member.name] += member.tickets;
                            }
                            allTwoShots.totalTickets += topTwoShots.totalTickets;
            
                            // Gabungkan data top-up
                            allSpendTable = spendTable;
                        }
            
                        // Format data yang digabungkan
                        if (allSetlists.length !== 0) {
                            data.theater.topSetlists = allSetlists
                                .reduce((acc, item) => {
                                    const found = acc.find(x => x.name === item.name);
                                    if (found) {
                                        found.wins += item.wins;
                                    } else {
                                        acc.push(item);
                                    }
                                    return acc;
                                }, [])
                                .sort((a, b) => b.wins - a.wins)
                                .slice(0, 3)
                                .map((setlist, index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                    return `${medal} ${setlist.name} - ${setlist.wins}x`;
                                });

                            data.theater.mostApplied = allApplied
                                .reduce((acc, item) => {
                                    const found = acc.find(x => x.name === item.name);
                                    if (found) {
                                        found.appearances += item.appearances;
                                    } else {
                                        acc.push(item);
                                    }
                                    return acc;
                                }, [])
                                .sort((a, b) => b.appearances - a.appearances)
                                .slice(0, 3)
                                .map((setlist, index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                    return `${medal} ${setlist.name} - ${setlist.appearances}x`;
                                });
                        } else {
                            data.theater.topSetlists = "Belum pernah Theateran 😭";
                        }
            
                        const allTimeTotalGames = allWinLossData.wins + allWinLossData.losses;
                        data.theater.winrate = {
                            rate: (allTimeTotalGames > 0 ? ((allWinLossData.wins / allTimeTotalGames) * 100).toFixed(2) : '0.00') + '%',
                            detail: {
                                menang: allWinLossData.wins,
                                kalah: allWinLossData.losses
                            }
                        };

                        // Format data event
                        if (allEvents.length !== 0) {
                            allEvents.sort((a, b) => new Date(b.date) - new Date(a.date)); // Urutkan berdasarkan tanggal terbaru
                            data.events.lastEvents = allEvents.slice(0, 3).map(event => event.name);
                        } else {
                            data.events = "Belum pernah ikut Event 😭";
                        }
            
                        if (Object.keys(allVideoCalls.topMembers).length !== 0) {
                            data.videoCall.topMembers = Object.entries(allVideoCalls.topMembers)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 3)
                                .map(([name, tickets], index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                    return `${medal} ${name} - ${tickets} tiket`;
                                });
                            data.videoCall.totalTickets = allVideoCalls.totalTickets;
                        } else {
                            data.videoCall = "Belum pernah Video Call 😭";
                        }

                        //2s
                        if (Object.keys(allTwoShots.topMembers).length !== 0) {
                            data.twoShot.topMembers = Object.entries(allTwoShots.topMembers)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 3)
                                .map(([name, tickets], index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                    return `${medal} ${name} - ${tickets} tiket`;
                                });
                            data.twoShot.totalTickets = allTwoShots.totalTickets;
                        } else {
                            data.twoShot = "Belum pernah Two Shot 😭";
                        }
            
                        const byYear = extractAndSumValuesByYear(allSpendTable);
                        let totalTopup = 0;
                        for (const yr in byYear) {
                            const spendData = formatYearData(byYear, yr);
                            totalTopup += spendData.totalTopup;
                        }

                        data.years = years.sort((a, b) => a - b);
                        data.topUp = `${numbFormat(totalTopup)} P`;
                    } else {
                        // Jika tahun tertentu dipilih, proses data untuk tahun tersebut
                        const yearSelected = year;
                        const [{ topByWins, topByApply }, winLossData, topVideoCalls, profile, spendTable, myPej, lastEvent, topTwoShots] = await Promise.all([
                            fetchTopSetlists(yearSelected),
                            calculateWinLossRate(yearSelected),
                            fetchTopVideoCallMembersByYear(yearSelected),
                            scrapeProfile(),
                            getAllTableData(),
                            myPage(),
                            fetchTopThreeEventWins(yearSelected),
                            fetchTopTwoShotMembersByYear(yearSelected),
                        ]);
            
                        data.name = profile;
                        data.oshi = myPej.oshi;
                        data.userPic = myPej.userPic;
                        data.oshiPic = myPej.oshiPic;
                        data.memberSince = myPej.memberSince;
                        data.memberDuration = myPej.memberDuration;
                        data.isOfc = myPej.isOfc;

                        // Theater
                        if (topByWins.length !== 0) {
                            // Menambahkan Top 3 Setlist
                            data.theater.topSetlists = topByWins.slice(0, 3).map((setlist, index) => {
                                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                return `${medal} ${setlist.name} - ${setlist.wins}x`;
                            });
                        } else {
                            data.theater.topSetlists = "Belum pernah Theateran 😭";
                        }

                        if (topByApply.length !== 0) {
                            data.theater.mostApplied = topByApply.slice(0, 3).map((setlist, index) => {
                                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                return `${medal} ${setlist.name} - ${setlist.appearances}x`;
                            });
                        } else {
                            data.theater.mostApplied = "Belum pernah Apply Theater 😭";
                        }

                        // Menambahkan Winrate data
                        data.theater.winrate = {
                            rate: winLossData.winRate,
                            detail: {
                                menang: winLossData.wins,
                                kalah: winLossData.losses
                            }
                        };

                        // Event
                        if (lastEvent.length !== 0) {
                            data.events.lastEvents = lastEvent.slice(0, 3).map(event => event.name);
                        } else {
                            data.events = "Belum pernah ikut Event 😭";
                        }

                        // Video Call
                        if (topVideoCalls.topMembers.length !== 0) {
                            data.videoCall.topMembers = topVideoCalls.topMembers.slice(0, 3).map((member, index) => {
                                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                return `${medal} ${member.name} - ${member.tickets} tiket`;
                            });

                            data.videoCall.totalTickets = topVideoCalls.totalTickets;
                        } else {
                            data.videoCall = "Belum pernah Video Call 😭";
                        }

                        // Two Shot
                        if (topTwoShots.topMembers.length !== 0) {
                            data.twoShot.topMembers = topTwoShots.topMembers.slice(0, 3).map((member, index) => {
                                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                                return `${medal} ${member.name} - ${member.tickets} tiket`;
                            });

                            data.twoShot.totalTickets = topTwoShots.totalTickets;
                        } else {
                            data.twoShot = "Belum pernah Two Shot 😭";
                        }

                        // Top-up
                        const byYear = extractAndSumValuesByYear(spendTable);
                        if (byYear[yearSelected]) {
                            const spendData = formatYearData(byYear, yearSelected);
                            data.topUp = `${numbFormat(spendData.totalTopup)} P`;
                        } else {
                            data.topUp = "0 P";
                        }

                        data.years = year;
                    }

                    res.json({ success: true, data });
                } catch (error) {
                    if (error?.status === 401 || error?.status === 403) {
                        return res.status(401).json({ success: false, sessionActive: false, message: "Sesi login tidak aktif" });
                    }
                    console.error(error);
                    res.status(500).json({ success: false, sessionActive: true, message: "Terjadi kesalahan pada server" });
                }
            };                   

            getData({ body: { year: request.year } }, {
                json: (data) => {
                    sendResponse({ data });
                },
                status: (code) => {
                    sendResponse({ success: false, message: "Terjadi kesalahan pada server" });
                }
            });

            return true;
        }
    }
);

// === Sort Member by Team ===
async function applyTeamSort() {
    const jsonUrl = "https://gist.githubusercontent.com/dandyraka/ccff2c3810acf2094df6bcc1d65225d5/raw/590dcffd80c49214fbc06e2fd9e61010d999605a/jkt48_team.json";
    
    try {
        const response = await fetch(jsonUrl);
        const teams = await response.json();

        const memberGrid = getMemberGridContainer();
        if (!memberGrid) return;
        memberGrid.setAttribute(WRAPPED_MEMBER_GRID_ATTR, 'true');

        let sourceHTML = getOriginalMemberHTMLForCurrentView();
        if ((!sourceHTML || sourceHTML.trim() === '') && !isSortedMemberGrid(memberGrid)) {
            sourceHTML = memberGrid.innerHTML;
            captureOriginalMemberHTML(memberGrid, true);
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = sourceHTML;
        const allMemberNodes = Array.from(tempDiv.querySelectorAll('a.member-card'));

        if (allMemberNodes.length === 0) {
            console.warn('Sort by Team dibatalkan karena source member card tidak ditemukan.');
            return;
        }

        memberGrid.innerHTML = '';

        const sectionWrapper = document.createElement('div');
        sectionWrapper.style.display = 'flex';
        sectionWrapper.style.flexDirection = 'column';
        sectionWrapper.style.gap = '2rem';
        sectionWrapper.style.width = '100%';
        sectionWrapper.style.gridColumn = '1 / -1';
        sectionWrapper.setAttribute(WRAPPED_TEAM_SECTION_ATTR, 'true');

        const findMemberElement = (name) => {
            return allMemberNodes.find(node => {
                const nodeText = node.innerText.toLowerCase().replace(/\s+/g, '');
                const targetName = name.toLowerCase().replace(/\s+/g, '');
                return nodeText.includes(targetName) || targetName.includes(nodeText);
            });
        };

        const cloneMemberCard = (element) => {
            const clone = element.cloneNode(true);
            const animatedCard = clone.querySelector('.member-card-inner');
            if (animatedCard) {
                animatedCard.style.opacity = '1';
                animatedCard.style.transform = 'translate(0px, 0px)';
                animatedCard.style.translate = 'none';
                animatedCard.style.rotate = 'none';
                animatedCard.style.scale = 'none';
            }
            clone.classList.add('aos-animate');
            return clone;
        };

        const createSection = (title) => {
            const section = document.createElement('section');
            section.style.width = '100%';

            const header = document.createElement('h2');
            header.className = 'title-home text-center inline-block mx-auto pb-6 lg:pb-4 aos-init aos-animate';
            header.textContent = title;
            header.setAttribute('data-aos', 'fade-up');
            header.setAttribute('data-aos-delay', '200');
            header.style.display = 'block';
            header.style.margin = '0 auto 1rem auto';

            const grid = document.createElement('div');
            grid.className = memberGrid.className;

            section.appendChild(header);
            section.appendChild(grid);
            return { section, grid };
        };

        Object.keys(teams).forEach(teamName => {
            const { section, grid } = createSection(teamName);
            
            teams[teamName].forEach(memberName => {
                const element = findMemberElement(memberName);
                if (element) grid.appendChild(cloneMemberCard(element));
            });

            if (grid.children.length > 0) {
                sectionWrapper.appendChild(section);
            }
        });

        const assignedNames = Object.values(teams).flat().map(name => name.toLowerCase().replace(/\s+/g, ''));
        const { section: traineeSection, grid: traineeGrid } = createSection('Trainee JKT48');

        allMemberNodes.forEach(node => {
            const nodeText = node.innerText.toLowerCase().replace(/\s+/g, '');
            const isAlreadyAssigned = assignedNames.some(targetName => 
                nodeText.includes(targetName) || targetName.includes(nodeText)
            );
            if (!isAlreadyAssigned) traineeGrid.appendChild(cloneMemberCard(node));
        });

        if (traineeGrid.children.length > 0) {
            sectionWrapper.appendChild(traineeSection);
        }

        memberGrid.appendChild(sectionWrapper);
        memberGrid.setAttribute(WRAPPED_TEAM_SECTION_ATTR, 'true');

        window.scrollTo(0, 0);

    } catch (error) {
        console.error("Gagal sortir:", error);
    }
}
