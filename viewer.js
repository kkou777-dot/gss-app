// --- DOM要素のキャッシュ ---
let appState = {
    competitionName: '',
    players: [],
    ui: {
        selectedClass: 'C',
        rankingType: 'total', // 'total', 'floor', 'vault', 'bars', 'beam'
    }
};

// --- DOM要素のキャッシュ ---
const dom = {};
function cacheDOMElements() {
    const ids = [
        'competitionName',
        'classTabs', 'rankingTypeSelect',
        'totalRankingSection', 'eventRankingSection', 'connectionStatus',
        'totalRankContent_C', 'totalRankContent_B', 'totalRankContent_A',
        'classC_playersTable', 'classB_playersTable', 'classA_playersTable',
        'eventRankContent_C', 'eventRankContent_B', 'eventRankContent_A'
    ];
    ids.forEach(id => dom[id] = document.getElementById(id));
}

function setupEventListeners() {
    dom.classTabs.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            appState.ui.selectedClass = e.target.dataset.class;
            renderAll();
        }
    });

    dom.rankingTypeSelect.addEventListener('change', (e) => {
        appState.ui.rankingType = e.target.value;
        renderAll();
    });
}

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();

    const socket = io('https://gymnastics-score-app.onrender.com', {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
    });

    setupSocketEventListeners(socket);
});

function setupSocketEventListeners(socket) {
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        if (dom.connectionStatus) {
            dom.connectionStatus.textContent = '';
            dom.connectionStatus.style.display = 'none';
        }
        socket.emit('requestInitialData');
    });

    socket.on('stateUpdate', (newState) => {
        console.log('State received from server');
        appState.competitionName = newState.competitionName;
        appState.players = newState.players;
        renderAll();
    });

    socket.on('disconnect', () => {
        console.warn('サーバーから切断されました。');
        if (dom.connectionStatus) {
            dom.connectionStatus.textContent = 'サーバーとの接続が切れました。再接続します...';
            dom.connectionStatus.style.display = 'block';
        }
    });

    socket.on('reconnecting', (attemptNumber) => {
        if (dom.connectionStatus) {
            dom.connectionStatus.textContent = `サーバーとの接続が切れました。再接続します... (${attemptNumber}回目)`;
            dom.connectionStatus.style.display = 'block';
        }
    });
}

// --- 描画処理 ---
function renderAll() {
    renderCompetitionName();
    renderTabsAndSelectors();
    renderTotalRanking();
    renderEventRanking();
}

function renderCompetitionName() {
    const name = appState.competitionName || '体操スコアシート';
    dom.competitionName.textContent = name;
    document.title = name;
}

function renderTabsAndSelectors() {
    const { selectedClass, rankingType } = appState.ui;

    // Class Tabs
    dom.classTabs.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === selectedClass);
    });

    // Ranking Sections
    const isTotal = rankingType === 'total';
    dom.totalRankingSection.classList.toggle('active', isTotal);
    dom.eventRankingSection.classList.toggle('active', !isTotal);

    // Total Ranking Content
    ['C', 'B', 'A'].forEach(classVal => {
        dom[`totalRankContent_${classVal}`]?.classList.toggle('active', isTotal && classVal === selectedClass);
    });

    // Event Ranking Content
    ['C', 'B', 'A'].forEach(classVal => {
        const classContentDiv = dom[`eventRankContent_${classVal}`];
        classContentDiv?.classList.toggle('active', !isTotal && classVal === selectedClass);
        if (classContentDiv) {
            classContentDiv.querySelectorAll('.event-rank-wrapper > div').forEach(eventDiv => {
                eventDiv.classList.toggle('active', eventDiv.dataset.event === rankingType);
            });
        }
    });
}

function renderTotalRanking() {
    ['C', 'B', 'A'].forEach(classVal => {
        const table = dom[`class${classVal}_playersTable`];
        if (!table) return;
        const tbody = table.querySelector('tbody');

        const sortedPlayers = appState.players
            .filter(p => p.playerClass === classVal)
            .sort((a, b) => b.total - a.total);

        tbody.innerHTML = '';
        let rank = 1;
        let lastScore = -1;
        sortedPlayers.forEach((p, i) => {
            if (p.total < lastScore) {
                rank = i + 1;
            }
            lastScore = p.total;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${rank}</td>
                <td>${p.name}</td>
                <td>${p.playerGroup}</td>
                <td>${p.total.toFixed(3)}</td>
            `;
            tbody.appendChild(tr);
        });
    });
}

function renderEventRanking() {
    ['C', 'B', 'A'].forEach(classVal => {
        const classContentDiv = document.getElementById(`eventRankContent_${classVal}`);
        if (!classContentDiv) return;

        ['floor', 'vault', 'bars', 'beam'].forEach(eventVal => {
            const eventDiv = classContentDiv.querySelector(`.event-rank-wrapper > div[data-event="${eventVal}"]`);
            if (!eventDiv) return;

            const tbody = eventDiv.querySelector('table > tbody');
            const sortedPlayers = appState.players
                .filter(p => p.playerClass === classVal)
                .sort((a, b) => (b[eventVal] || 0) - (a[eventVal] || 0));

            tbody.innerHTML = '';
            let rank = 1;
            let lastScore = -1;
            sortedPlayers.forEach((p, i) => {
                const currentScore = p[eventVal] || 0;
                if (currentScore < lastScore) {
                    rank = i + 1;
                }
                lastScore = currentScore;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${rank}</td>
                    <td>${p.name}</td>
                    <td>${(p[eventVal] || 0).toFixed(3)}</td>
                `;
                tbody.appendChild(tr);
            });
        });
    });
}
