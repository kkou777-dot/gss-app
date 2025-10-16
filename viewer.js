// --- DOM要素のキャッシュ ---
// クラスの表示順序を定義 (数値が小さいほど上位)
const CLASS_ORDER_MAP = {
    '上級': 1,
    '中級': 2,
    '初級': 3,
    // 他のクラスは動的に追加され、このマップにない場合はアルファベット順
};
let appState = {
    competitionName: '',
    lastUpdated: '',
    players: [],
    ui: {
        selectedClass: '', // 初期選択クラスを空にする
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
        'totalRankTableWrapper', 'eventRankTableWrapper'
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
    const socket = io({
        // Render.comのスリープ対策
        transports: ['websocket', 'polling']
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
    const competitionTitle = appState.competitionName || '大会結果速報';
    dom.competitionName.textContent = competitionTitle;
    if (dom.lastUpdated) {
        dom.lastUpdated.textContent = appState.lastUpdated ? `(最終更新: ${appState.lastUpdated})` : '';
    }
    document.title = competitionTitle;
}

// 存在するユニークなクラス名を取得し、定義された順序でソートするヘルパー関数
function getSortedUniqueClasses(players) {
    const uniqueClasses = [...new Set(players.map(p => p.playerClass))];
    return uniqueClasses.sort((a, b) => {
        const orderA = CLASS_ORDER_MAP[a] !== undefined ? CLASS_ORDER_MAP[a] : Infinity;
        const orderB = CLASS_ORDER_MAP[b] !== undefined ? CLASS_ORDER_MAP[b] : Infinity;

        if (orderA !== Infinity && orderB !== Infinity) {
            return orderA - orderB;
        }
        // 定義されていないクラスはアルファベット順
        return a.localeCompare(b);
    });
}

function renderTabsAndSelectors() {
    const { selectedClass, rankingType } = appState.ui;
    const classes = getSortedUniqueClasses(appState.players);

    // クラス選択タブの動的生成
    dom.classTabs.innerHTML = '';
    classes.forEach((playerClass, index) => {
        const isActive = (selectedClass === '' && index === 0) || selectedClass === playerClass;
        dom.classTabs.innerHTML += `<button data-class="${playerClass}" class="${isActive ? 'active' : ''}">${playerClass}クラス</button>`;
    });

    // 選択されたクラスが現在のクラスリストにない場合、最初のクラスを選択
    if (!classes.includes(selectedClass) && classes.length > 0) {
        appState.ui.selectedClass = classes[0];
    } else if (classes.length === 0) {
        appState.ui.selectedClass = ''; // クラスがない場合はクリア
    }

    // Class Tabs
    dom.classTabs.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === appState.ui.selectedClass);
    });

    // Ranking Sections
    const isTotal = rankingType === 'total';
    dom.totalRankingSection.classList.toggle('active', isTotal);
    dom.eventRankingSection.classList.toggle('active', !isTotal);
}

function renderTotalRanking() {
    const classes = getSortedUniqueClasses(appState.players);
    const selectedClass = appState.ui.selectedClass;
    const totalTableWrapper = dom.totalRankTableWrapper;

    if (!totalTableWrapper) return;
    totalTableWrapper.innerHTML = ''; // クリア

    classes.forEach(playerClass => {
        const classId = playerClass.replace(/\s/g, '');
        const isActive = playerClass === selectedClass;

        if (!isActive) return; // アクティブなクラスのみ描画

        totalTableWrapper.innerHTML = `
            <div id="totalRankContent_${classId}" class="tab-content active">
                <h3>${playerClass}クラス 総合得点ランキング</h3>
                <table id="class${classId}_playersTable">
                    <thead><tr><th>順位</th><th>名前</th><th>合計</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;

        const tbody = document.getElementById(`class${classId}_playersTable`)?.querySelector('tbody');
        if (!tbody) return;

        const searchTerm = appState.ui.searchTerm || '';
        const sortedPlayers = appState.players
            .filter(p => p.playerClass === playerClass)
            .filter(p => p.name.includes(searchTerm)) // 検索語でフィルタリング
            .sort((a, b) => b.total - a.total);
        tbody.innerHTML = '';
        sortedPlayers.forEach((p, i) => {
            let rank = 1;
            // 同順位のロジック: 前の選手より点数が低い場合のみ順位を更新
            if (i > 0 && p.total < sortedPlayers[i - 1].total) {
                rank = i + 1;
            }
            tbody.innerHTML += `
            <tr>
                <td>${rank}</td>
                <td>${p.name}</td>
                <td>${p.total.toFixed(3)}</td>
            </tr>`;
        });
    });
}

function renderEventRanking() {
    const classes = getSortedUniqueClasses(appState.players);
    const selectedClass = appState.ui.selectedClass;
    const rankingType = appState.ui.rankingType;
    const eventTableWrapper = dom.eventRankTableWrapper;

    if (!eventTableWrapper) return;
    eventTableWrapper.innerHTML = ''; // クリア

    const EVENTS = ['floor', 'vault', 'bars', 'beam']; // 女子用種目
    const EVENT_NAMES = { floor: '床', vault: '跳馬', bars: '段違い平行棒', beam: '平均台' };

    classes.forEach(playerClass => {
        const classId = playerClass.replace(/\s/g, '');
        const isActive = playerClass === selectedClass;

        if (!isActive) return; // アクティブなクラスのみ描画

        let eventContentHTML = '';
        EVENTS.forEach(eventVal => {
            const eventIsActive = rankingType === eventVal;
            if (!eventIsActive) return; // 選択中の種目のみ描画

            eventContentHTML += `
                <div class="event-rank-wrapper">
                    <div data-event="${eventVal}" class="active">
                        <h3>${playerClass}クラス - ${EVENT_NAMES[eventVal]} ランキング</h3>
                        <table>
                            <thead><tr><th>順位</th><th>名前</th><th>得点</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>`;
        });

        eventTableWrapper.innerHTML = `<div id="eventRankContent_${classId}" class="tab-content active">${eventContentHTML}</div>`;

        // 各種目テーブルのtbodyを埋める
        EVENTS.forEach(eventVal => {
            if (rankingType !== eventVal) return;

            const tbody = document.querySelector(`#eventRankContent_${classId} div[data-event="${eventVal}"] tbody`);
            if (!tbody) return;

            const searchTerm = appState.ui.searchTerm || '';
            const sortedPlayers = appState.players
                .filter(p => p.playerClass === playerClass)
                .filter(p => p.name.includes(searchTerm)) // 検索語でフィルタリング
                .sort((a, b) => (b.scores?.[eventVal] || 0) - (a.scores?.[eventVal] || 0));

            tbody.innerHTML = '';
            sortedPlayers.forEach((p, i) => {
                let rank = 1;
                const currentScore = p.scores?.[eventVal] || 0;
                // 同順位のロジック
                if (i > 0 && currentScore < (sortedPlayers[i - 1].scores?.[eventVal] || 0)) {
                    rank = i + 1;
                }
                tbody.innerHTML += `
                <tr>
                    <td>${rank}</td>
                    <td>${p.name}</td>
                    <td>${currentScore.toFixed(3)}</td>
                </tr>`;
            });
        });
    });
}
