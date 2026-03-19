importScripts("crypto-js.min.js");

function getTargetTabId(sender, callback) {
  if (sender?.tab?.id) {
    callback(sender.tab.id);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    callback(tabs?.[0]?.id ?? null);
  });
}

function sendMessageToTab(tabId, message, callback) {
  if (!tabId) {
    callback?.({ ok: false, error: "Tab aktif tidak ditemukan." });
    return;
  }

  chrome.tabs.sendMessage(tabId, message, response => {
    if (chrome.runtime.lastError) {
      console.warn("sendMessageToTab error:", chrome.runtime.lastError.message);
      callback?.({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }

    callback?.({ ok: true, response });
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {

  function notifySessionRequired(tabId) {
    sendMessageToTab(tabId, {
      action: "SESSION_REQUIRED",
      message: "Login dulu di JKT48.com untuk memakai Wrapped."
    });
  }

  // ====== AMBIL LIST TAHUN =====
  if (msg.action === "REQ_YEARS") {
    getTargetTabId(sender, tabId => {
      sendMessageToTab(tabId, { action: "check_session" }, sessionResult => {
        const sessionActive = Boolean(sessionResult?.ok && sessionResult?.response?.active);

        if (!sessionActive) {
          sendMessageToTab(tabId, {
            action: "SEND_YEARS",
            years: [],
            sessionActive: false
          });
          return;
        }

        sendMessageToTab(tabId, { action: "login" }, result => {
          const years = result?.ok ? (result.response?.data?.data || []) : [];

          sendMessageToTab(tabId, {
            action: "SEND_YEARS",
            years,
            sessionActive: true
          });
        });
      });
    });
  }

  // ====== AMBIL DATA =====
  if (msg.action === "SCRAP_YEAR") {
    const year = msg.year;

    getTargetTabId(sender, tabId => {
      sendMessageToTab(tabId, { action: "check_session" }, sessionResult => {
        const sessionActive = Boolean(sessionResult?.ok && sessionResult?.response?.active);
        if (!sessionActive) {
          notifySessionRequired(tabId);
          return;
        }

        sendMessageToTab(tabId, { action: "scrap", year }, result => {
          if (!result?.ok || !result.response?.data?.success) {
            console.warn("SCRAP_YEAR gagal:", result?.error || result?.response?.message || "No response");
            if (result?.response?.data?.sessionActive === false) {
              notifySessionRequired(tabId);
            }
            return;
          }

          const secret = "JKT48Live";
          const resulto = { data: result.response.data.data, year };

          const encrypted = CryptoJS.AES.encrypt(
            JSON.stringify(resulto),
            secret
          ).toString();

          chrome.tabs.create({
            url: "https://jkt48live.github.io/wrappedExtWeb/" + encodeURIComponent(encrypted)
          });
        });
      });
    });
  }

});
