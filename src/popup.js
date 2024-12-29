(function () {
    'use strict';

    const secretKey = 'JKT48Live';
    const loginBtn = document.getElementById('login');
    const yearSelectorDiv = document.getElementById('yearSelector');
    const yearSelect = document.getElementById('year');
    const submitBtn = document.getElementById('submit');
    const resultText = document.getElementById('result');

    resultText.style.display = 'none';

    loginBtn?.addEventListener('click', async () => {
        resultText.innerText = 'Loading...';
        resultText.style.display = 'block';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            const message = { action: "login" };
            chrome.tabs.sendMessage(activeTab.id, message, function (response) {
                console.log('Received response:', response);
                if (response && response.data.success) {
                    response.data.data.forEach(year => {
                        const option = document.createElement('option');
                        option.value = year.year;
                        option.text = year.year;
                        yearSelect.add(option);
                    });

                    const allTimeOption = document.createElement('option');
                    allTimeOption.value = "all";
                    allTimeOption.text = "All Time";
                    yearSelect.add(allTimeOption);

                    yearSelectorDiv.style.display = 'block';
                    loginBtn.style.display = 'none';
                    resultText.style.display = 'none';
                } else {
                    resultText.innerText = 'Gagal mengambil data, buka dan login pada web JKT48 dulu.';
                    resultText.style.display = 'block';
                }
            });
        });
    });

    submitBtn?.addEventListener('click', async () => {
        const selectedYear = yearSelect.value;
        resultText.innerText = 'Loading...';
        resultText.style.display = 'block';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            const message = { action: "scrap", year: selectedYear };
            chrome.tabs.sendMessage(activeTab.id, message, function (response) {
                console.log('Received response:', response);
                if (response && response.data.success) {
                    resultText.style.display = 'none';
                    const tahun = (selectedYear == "all") ? "All Time" : selectedYear;
                    const resulto = { data: response.data.data, year: tahun }

                    const encryptedData = CryptoJS.AES.encrypt(JSON.stringify(resulto), secretKey).toString();
                    chrome.tabs.create({ url: `https://jkt48live.github.io/wrappedExtWeb/${encodeURIComponent(encryptedData)}` });
                } else {
                    resultText.innerText = 'Gagal mengambil data.';
                    resultText.style.display = 'block';
                }
            });
        });
    });
})();