// === Floating button ===
const btn = document.createElement("div");
btn.id = "wrappedFloatBtn";
btn.innerText = "JKT48 Wrapped";
document.body.appendChild(btn);

// === Panel ===
const panel = document.createElement("div");
panel.id = "wrappedPanel";
panel.style.display = "none";
panel.innerHTML = `
  <div style="padding:10px;font-family:sans-serif;">

    <div id="sortMemberSection" style="display:none; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
      <div style="display:flex; align-items:center; justify-content: space-between;">
        <span style="font-size:13px; font-weight: 600; color: #333;">Sort by Team</span>
        <label class="ios-switch">
          <input type="checkbox" id="teamSortToggle" checked>
          <span class="ios-slider"></span>
        </label>
      </div>
    </div>

    <b>Pilih Tahun:</b><br>
    <select id="wrappedYear" style="padding:5px;margin:8px 0;width:100%;border-radius:6px;"></select>

    <button id="wrappedGo" style="
      padding:6px 10px;
      width:100%;
      background:#ff4081;
      color:#fff;
      border:0;
      border-radius:6px;
      cursor:pointer;
      margin-top:5px;
    ">Ambil</button>

    <p id="wrappedLoading" style="
      display:none;
      margin-top:10px;
      font-size:13px;
      color:#555;
    ">Loading...</p>

    <div style="
      margin-top:15px;
      font-size:11px;
      color:#999;
      text-align:center;
    ">
      Made with &hearts; by JKT48 Live
    </div>

  </div>
`;
document.body.appendChild(panel);

let cachedYears = [];
let cachedSessionActive = null;
let lastYearsFetchAt = 0;
const YEARS_THROTTLE_MS = 15000;

function isMemberPage() {
  return window.location.pathname === "/member";
}

function isSortableMemberPage() {
  const memberType = new URLSearchParams(window.location.search).get("type");
  return isMemberPage() && memberType !== "TRAINEE";
}

function updateSortMemberVisibility() {
  const sortSection = document.getElementById("sortMemberSection");
  const sortToggle = document.getElementById("teamSortToggle");
  if (!sortSection) return;

  const shouldShow = isSortableMemberPage();
  sortSection.style.display = shouldShow ? "block" : "none";

  if (sortToggle && !shouldShow) {
    const wasChecked = sortToggle.checked;
    sortToggle.checked = false;
    if (wasChecked) {
      window.dispatchEvent(new CustomEvent("DO_TEAM_SORT", {
        detail: { status: false }
      }));
    }
  }
}

updateSortMemberVisibility();

window.addEventListener("popstate", updateSortMemberVisibility);

const originalPushState = history.pushState;
history.pushState = function (...args) {
  const result = originalPushState.apply(this, args);
  updateSortMemberVisibility();
  return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  const result = originalReplaceState.apply(this, args);
  updateSortMemberVisibility();
  return result;
};

document.getElementById("teamSortToggle").addEventListener("change", (e) => {
  const event = new CustomEvent("DO_TEAM_SORT", {
    detail: { status: e.target.checked }
  });
  window.dispatchEvent(event);
});

function setWrappedSessionState(sessionActive, message = "") {
  const select = document.getElementById("wrappedYear");
  const loading = document.getElementById("wrappedLoading");
  const goButton = document.getElementById("wrappedGo");

  if (!select || !loading || !goButton) return;

  goButton.disabled = !sessionActive;
  goButton.style.opacity = sessionActive ? "1" : "0.6";
  goButton.style.cursor = sessionActive ? "pointer" : "not-allowed";

  if (!sessionActive) {
    select.innerHTML = `<option value="">Login dulu</option>`;
    loading.style.display = "block";
    loading.textContent = message || "Login dulu di JKT48.com untuk memakai Wrapped.";
    loading.style.color = "#b42318";
    return;
  }

  loading.style.color = "#555";
  loading.textContent = message || "";
  loading.style.display = message ? "block" : "none";
}

function renderWrappedYears(years, sessionActive = true) {
  const select = document.getElementById("wrappedYear");
  if (!select) return;

  select.innerHTML = "";

  if (sessionActive === false) {
    setWrappedSessionState(false);
    return;
  }

  setWrappedSessionState(true);

  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y.year;
    opt.textContent = y.year;
    select.appendChild(opt);
  });

  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All Time";
  select.appendChild(all);
}

// === Toggle panel ===
btn.addEventListener("click", () => {
  const isOpening = panel.style.display === "none";
  panel.style.display = isOpening ? "block" : "none";

  if (!isOpening) {
    return;
  }

  const isCacheFresh = cachedSessionActive === true
    && cachedYears.length > 0
    && (Date.now() - lastYearsFetchAt < YEARS_THROTTLE_MS);

  if (isCacheFresh) {
    renderWrappedYears(cachedYears, true);
    return;
  }

  const loading = document.getElementById("wrappedLoading");
  loading.style.display = "block";
  loading.style.color = "#555";
  loading.textContent = "Mengambil daftar tahun...";
  chrome.runtime.sendMessage({ action: "REQ_YEARS" });
});

// === Terima list tahun / progress ===
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "SEND_YEARS") {
    if (msg.sessionActive === false) {
      cachedSessionActive = false;
      cachedYears = [];
      setWrappedSessionState(false);
      return;
    }

    cachedSessionActive = true;
    cachedYears = Array.isArray(msg.years) ? msg.years : [];
    lastYearsFetchAt = Date.now();
    renderWrappedYears(cachedYears, true);
  }

  if (msg.action === "SESSION_REQUIRED") {
    cachedSessionActive = false;
    cachedYears = [];
    setWrappedSessionState(false, msg.message);
  }

  if (msg.action === "WRAPPED_PROGRESS") {
    const loading = document.getElementById("wrappedLoading");
    if (!loading) return;
    loading.style.display = "block";
    loading.style.color = "#555";
    loading.textContent = msg.message;
  }
});

// === klik AMBIL ===
document.getElementById("wrappedPanel").addEventListener("click", e => {
  if (e.target.id === "wrappedGo") {
    const year = document.getElementById("wrappedYear").value;
    const loading = document.getElementById("wrappedLoading");
    const goButton = document.getElementById("wrappedGo");

    if (goButton.disabled || !year) {
      return;
    }

    loading.style.display = "block";
    loading.style.color = "#555";
    loading.textContent = `Menyiapkan Wrapped ${year === "all" ? "All Time" : year}...`;

    chrome.runtime.sendMessage({ action: "SCRAP_YEAR", year }, () => {
      // Progress berikutnya akan dikirim lewat WRAPPED_PROGRESS.
    });
  }
});
