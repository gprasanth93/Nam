document.addEventListener('DOMContentLoaded', () => {
    const consoleElement = document.getElementById('console');
    const hostnameColors = {};
    const colorPalette = ['cyan', 'magenta', 'yellow', 'orange', 'lightgreen', 'lightblue', 'violet'];

    function getRandomColor() {
        return colorPalette[Math.floor(Math.random() * colorPalette.length)];
    }

    function fetchAndDisplayData() {
        fetch('/api/logs')  // Replace with your actual API endpoint
            .then(response => response.json())
            .then(data => {
                consoleElement.innerHTML = '';  // Clear previous data

                // Sort the data based on timestamp
                data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                data.forEach(item => {
                    if (!hostnameColors[item.hostname]) {
                        hostnameColors[item.hostname] = getRandomColor();
                    }

                    const itemElement = document.createElement('div');
                    itemElement.classList.add('console-item', `color-${item.level}`);

                    const timestampElement = document.createElement('span');
                    timestampElement.textContent = `${item.timestamp} `;

                    const hostnameElement = document.createElement('span');
                    hostnameElement.style.color = hostnameColors[item.hostname];
                    hostnameElement.textContent = `[${item.hostname}] `;

                    const messageElement = document.createElement('span');
                    messageElement.textContent = `${item.label.toUpperCase()}: ${item.message}`;

                    itemElement.appendChild(timestampElement);
                    itemElement.appendChild(hostnameElement);
                    itemElement.appendChild(messageElement);

                    consoleElement.appendChild(itemElement);
                });
            })
            .catch(error => console.error('Error fetching data:', error));
    }

    // Fetch data initially
    fetchAndDisplayData();

    // Set interval to fetch data every 30 seconds
    setInterval(fetchAndDisplayData, 30000);
});
