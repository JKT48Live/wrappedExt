importScripts("crypto-js.min.js");

chrome.runtime.onMessage.addListener((msg, sender) => {

  // ====== AMBIL LIST TAHUN =====
  if (msg.action === "REQ_YEARS") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "login" }, (response) => {

        // kirim kembali ke float.js
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "SEND_YEARS",
          years: response?.data?.data || []
        });

      });
    });
  }

  // ====== AMBIL DATA =====
  if (msg.action === "SCRAP_YEAR") {
    const year = msg.year;

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "scrap", year }, (resp) => {

        const secret = "JKT48Live";
        const resulto = { data: resp.data.data, year };

        const encrypted = CryptoJS.AES.encrypt(
          JSON.stringify(resulto),
          secret
        ).toString();

        chrome.tabs.create({
          url: "https://jkt48live.github.io/wrappedExtWeb/" + encodeURIComponent(encrypted)
        });
      });
    });
  }

});
