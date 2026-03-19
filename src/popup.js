(function () {
    'use strict';

    const secretKey = 'JKT48Live';
    const loginBtn = document.getElementById('login');
    const yearSelectorDiv = document.getElementById('yearSelector');
    const yearSelect = document.getElementById('year');
    const submitBtn = document.getElementById('submit');
    const resultText = document.getElementById('result');

    resultText.style.display = 'none';
    let sessionActive = false;

    function setResult(message, isError = false) {
        resultText.innerText = message;
        resultText.style.display = message ? 'block' : 'none';
        resultText.style.color = isError ? '#ffb4b4' : '#ffffff';
    }

    function setSessionState(isActive, message = '') {
        sessionActive = isActive;

        if (!isActive) {
            loginBtn.style.display = 'block';
            loginBtn.disabled = false;
            yearSelectorDiv.style.display = 'none';
            yearSelect.innerHTML = '';
            setResult(message || 'Login dulu di web JKT48 untuk memakai Wrapped.', true);
            return;
        }

        setResult(message, false);
    }

    function getActiveTab(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            callback(tabs?.[0] || null);
        });
    }

    function sendMessageToActiveTab(message, callback) {
        getActiveTab((activeTab) => {
            if (!activeTab?.id) {
                callback?.({ ok: false, error: 'Tab aktif tidak ditemukan.' });
                return;
            }

            chrome.tabs.sendMessage(activeTab.id, message, function (response) {
                if (chrome.runtime.lastError) {
                    callback?.({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }

                callback?.({ ok: true, response });
            });
        });
    }

    function loadYears() {
        setResult('Loading...', false);

        sendMessageToActiveTab({ action: 'check_session' }, (sessionResult) => {
            const isActive = Boolean(sessionResult?.ok && sessionResult?.response?.active);
            if (!isActive) {
                setSessionState(false);
                return;
            }

            sendMessageToActiveTab({ action: 'login' }, function (response) {
                if (response?.ok && response.response?.data?.success) {
                    yearSelect.innerHTML = '';

                    response.response.data.data.forEach(year => {
                        const option = document.createElement('option');
                        option.value = year.year;
                        option.text = year.year;
                        yearSelect.add(option);
                    });

                    const allTimeOption = document.createElement('option');
                    allTimeOption.value = 'all';
                    allTimeOption.text = 'All Time';
                    yearSelect.add(allTimeOption);

                    sessionActive = true;
                    yearSelectorDiv.style.display = 'block';
                    loginBtn.style.display = 'none';
                    setResult('', false);
                } else {
                    setSessionState(false, 'Login dulu di web JKT48 untuk memakai Wrapped.');
                }
            });
        });
    }

    loginBtn?.addEventListener('click', async () => {
        loadYears();
    });

    submitBtn?.addEventListener('click', async () => {
        if (!sessionActive) {
            setSessionState(false);
            return;
        }

        const selectedYear = yearSelect.value;
        setResult('Loading...', false);

        sendMessageToActiveTab({ action: 'check_session' }, (sessionResult) => {
            const isActive = Boolean(sessionResult?.ok && sessionResult?.response?.active);
            if (!isActive) {
                setSessionState(false);
                return;
            }

            sendMessageToActiveTab({ action: 'scrap', year: selectedYear }, function (response) {
                if (response?.ok && response.response?.data?.success) {
                    setResult('', false);
                    const tahun = (selectedYear === 'all') ? 'All Time' : selectedYear;
                    const resulto = { data: response.response.data.data, year: tahun };

                    const encryptedData = CryptoJS.AES.encrypt(JSON.stringify(resulto), secretKey).toString();
                    chrome.tabs.create({ url: `https://jkt48live.github.io/wrappedExtWeb/${encodeURIComponent(encryptedData)}` });
                } else {
                    setResult('Gagal mengambil data.', true);
                }
            });
        });
    });

    loadYears();
})();
