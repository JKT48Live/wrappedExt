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

// === Toggle panel ===
btn.addEventListener("click", () => {
  panel.style.display = panel.style.display === "none" ? "block" : "none";

  // setiap buka → reload tahun
  chrome.runtime.sendMessage({ action: "REQ_YEARS" });
});

// === Terima list tahun ===
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "SEND_YEARS") {
    const select = document.getElementById("wrappedYear");
    select.innerHTML = "";

    msg.years.forEach(y => {
      const opt = document.createElement("option");
      opt.value = y.year;
      opt.textContent = y.year;
      select.appendChild(opt);
    });

    // All Time
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All Time";
    select.appendChild(all);
  }
});

// === klik AMBIL ===
document.getElementById("wrappedPanel").addEventListener("click", e => {
  if (e.target.id === "wrappedGo") {
    const year = document.getElementById("wrappedYear").value;
    const loading = document.getElementById("wrappedLoading");

    // tampilkan loading
    loading.style.display = "block";

    // kirim request
    chrome.runtime.sendMessage({ action: "SCRAP_YEAR", year }, () => {
      // loading tetap terlihat sampai background buka tab baru
    });
  }
});
