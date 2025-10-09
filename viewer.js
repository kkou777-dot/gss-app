// --- DOM要素のキャッシュ ---
let appState = {
    competitionName: '',
    lastUpdated: '',
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
        'competitionName', 'lastUpdated', 'playerSearchInput',
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

    dom.playerSearchInput.addEventListener('input', (e) => {
        appState.ui.searchTerm = e.target.value.trim();
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
        appState.lastUpdated = newState.lastUpdated;
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
    const name = appState.competitionName || '大会結果速報';
    dom.competitionName.textContent = name;
    if (dom.lastUpdated) {
        dom.lastUpdated.textContent = appState.lastUpdated ? `(最終更新: ${appState.lastUpdated})` : '';
    }
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

        const searchTerm = appState.ui.searchTerm || '';
        const sortedPlayers = appState.players
            .filter(p => p.playerClass === classVal)
            .filter(p => p.name.includes(searchTerm)) // 検索語でフィルタリング
            .sort((a, b) => b.total - a.total);
        tbody.innerHTML = '';
        let rank = 1;
        sortedPlayers.forEach((p, i) => {
            // 同順位のロジック: 前の選手より点数が低い場合のみ順位を更新
            if (i > 0 && p.total < sortedPlayers[i - 1].total) {
                rank = i + 1;
            }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${rank}</td>
                <td>${p.name}</td>
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
            const searchTerm = appState.ui.searchTerm || '';
            const sortedPlayers = appState.players
                .filter(p => p.playerClass === classVal)
                .filter(p => p.name.includes(searchTerm)) // 検索語でフィルタリング
                .sort((a, b) => (b[eventVal] || 0) - (a[eventVal] || 0));

            tbody.innerHTML = '';
            let rank = 1;
            sortedPlayers.forEach((p, i) => {
                const currentScore = p[eventVal] || 0;
                // 同順位のロジック
                if (i > 0 && currentScore < (sortedPlayers[i - 1][eventVal] || 0)) {
                    rank = i + 1;
                }
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${rank}</td>
                    <td>${p.name}</td>
                    <td>${currentScore.toFixed(3)}</td>
                `;
                tbody.appendChild(tr);
            });
        });
    });
}
