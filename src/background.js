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

function sendRuntimeMessageSafe(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // Ignore when no extension page is listening.
      }
    });
  } catch (_) {
    // Ignore runtime delivery issues for optional UI listeners.
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {

  function notifySessionRequired(tabId) {
    sendMessageToTab(tabId, {
      action: "SESSION_REQUIRED",
      message: "Login dulu di JKT48.com untuk memakai Wrapped."
    });
  }

  function notifyProgress(tabId, message) {
    sendMessageToTab(tabId, {
      action: "WRAPPED_PROGRESS",
      message
    });

    sendRuntimeMessageSafe({
      action: "WRAPPED_PROGRESS",
      message
    });
  }

  if (msg.action === "PROGRESS_UPDATE") {
    if (sender?.tab?.id) {
      notifyProgress(sender.tab.id, msg.message);
    }
    return;
  }

  // ====== AMBIL LIST TAHUN =====
  if (msg.action === "REQ_YEARS") {
    getTargetTabId(sender, tabId => {
      notifyProgress(tabId, "Mengambil daftar tahun...");
      sendMessageToTab(tabId, { action: "login" }, result => {
        const years = result?.ok ? (result.response?.data?.data || []) : [];
        const sessionActive = Boolean(result?.ok && result.response?.data?.sessionActive !== false);

        sendMessageToTab(tabId, {
          action: "SEND_YEARS",
          years,
          sessionActive
        });
      });
    });
  }

  // ====== AMBIL DATA =====
  if (msg.action === "SCRAP_YEAR") {
    const year = msg.year;

    getTargetTabId(sender, tabId => {
      notifyProgress(tabId, `Menyiapkan Wrapped ${year === "all" ? "All Time" : year}...`);
      sendMessageToTab(tabId, { action: "scrap", year }, result => {
        if (!result?.ok || !result.response?.data?.success) {
          console.warn("SCRAP_YEAR gagal:", result?.error || result?.response?.message || "No response");
          if (result?.response?.data?.sessionActive === false) {
            notifySessionRequired(tabId);
          }
          return;
        }

        if (result?.response?.data?.sessionActive === false) {
          notifySessionRequired(tabId);
          return;
        }

        const secret = "JKT48Live";
        const resulto = { data: result.response.data.data, year };

        const encrypted = CryptoJS.AES.encrypt(
          JSON.stringify(resulto),
          secret
        ).toString();

        notifyProgress(tabId, 'Membuka hasil Wrapped...');
        chrome.tabs.create({
          url: "https://jkt48live.github.io/wrappedExtWeb/" + encodeURIComponent(encrypted)
        });
      });
    });
  }

});
