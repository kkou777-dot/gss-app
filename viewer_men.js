// --- アプリケーションの状態管理 ---
// クラスの表示順序を定義 (数値が小さいほど上位)
const CLASS_ORDER_MAP = {
    '上級': 1,
    '中級': 2,
    '初級': 3,
    // 他のクラスは動的に追加され、このマップにない場合はアルファベット順
};
const appState = {
    competitionName: '',
    lastUpdated: '',
    players: [],
    ui: {
        selectedClass: '', // 初期選択クラスを空にする
        rankingType: 'total',
    }
};

// --- DOM要素のキャッシュ ---
const dom = {}; // グローバルスコープで定義
function cacheDOMElements() {
    const ids = [
        'competitionName', 'lastUpdated', 'classTabs', 'rankingTypeSelect',
        'totalRankingSection', 'eventRankingSection', 'connectionStatus',
        'playerSearchInput', 'totalRankTableWrapper', 'eventRankTableWrapper'
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

document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    const socket = io({ transports: ['websocket', 'polling'] });
    setupSocketEventListeners(socket);
});

function setupSocketEventListeners(socket) {
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        if (dom.connectionStatus) { dom.connectionStatus.textContent = ''; dom.connectionStatus.style.display = 'none'; }
        socket.emit('requestInitialDataMen');
    });
    socket.on('stateUpdateMen', (newState) => {
        console.log('State received from server');
        appState.competitionName = newState.competitionName;
        appState.lastUpdated = newState.lastUpdated;
        appState.players = newState.players;
        renderAll();
    });
    socket.on('disconnect', () => {
        if (dom.connectionStatus) { dom.connectionStatus.textContent = 'サーバーとの接続が切れました。再接続します...'; dom.connectionStatus.style.display = 'block'; }
    });
    socket.on('reconnecting', (attemptNumber) => {
        if (dom.connectionStatus) { dom.connectionStatus.textContent = `サーバーとの接続が切れました。再接続します... (${attemptNumber}回目)`; dom.connectionStatus.style.display = 'block'; }
    });
}

function renderAll() {
    renderCompetitionName();
    renderTabsAndSelectors();
    renderTotalRanking();
    renderEventRanking();
}

function renderCompetitionName() {
    const competitionTitle = appState.competitionName || '大会結果速報 (男子)';
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

    // アクティブなタブを更新
    dom.classTabs.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === appState.ui.selectedClass);
    });

    // ランキングセクションの表示/非表示
    const isTotal = rankingType === 'total';
    dom.totalRankingSection.classList.toggle('active', isTotal);
    dom.eventRankingSection.classList.toggle('active', !isTotal);
}

function renderTotalRanking() {
    const selectedClass = appState.ui.selectedClass;
    const totalTableWrapper = dom.totalRankTableWrapper;

    if (!totalTableWrapper) return;
    totalTableWrapper.innerHTML = ''; // クリア

    // 選択されたクラスが存在しない場合は何もしない
    if (!selectedClass) return;

    const classId = selectedClass.replace(/\s/g, '');
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
        .filter(p => p.playerClass === selectedClass)
        .filter(p => p.name.includes(searchTerm))
        .sort((a, b) => b.total - a.total);

    let rank = 1;
    const rowsHtml = sortedPlayers.map((p, i) => {
        // スタンダードランキング（同点は同順位、次の順位は飛ぶ）
        if (i > 0 && p.total < sortedPlayers[i - 1].total) {
            rank = i + 1;
        }
        return `
            <tr>
                <td>${rank}</td><td>${p.name}</td><td>${p.total.toFixed(3)}</td>
            </tr>`;
    }).join('');
    tbody.innerHTML = rowsHtml;
}

function renderEventRanking() {
    const selectedClass = appState.ui.selectedClass;
    const rankingType = appState.ui.rankingType;
    const eventTableWrapper = dom.eventRankTableWrapper;

    if (!eventTableWrapper) return;
    eventTableWrapper.innerHTML = ''; // クリア

    // 選択されたクラスやランキング種別がなければ何もしない
    if (!selectedClass || rankingType === 'total') return;

    const classId = selectedClass.replace(/\s/g, '');
    const eventVal = rankingType;

    const EVENT_NAMES = {
        floor: '床',
        pommel: 'あん馬',
        rings: 'つり輪',
        vault: '跳馬',
        pbars: '平行棒',
        hbar: '鉄棒'
    };
    const eventName = EVENT_NAMES[eventVal];

    if (eventName) {
        eventTableWrapper.innerHTML = `
            <div id="eventRankContent_${classId}" class="tab-content active">
                <div class="event-rank-wrapper">
                    <div data-event="${eventVal}" class="active">
                        <h3>${selectedClass}クラス - ${eventName} ランキング</h3>
                        <table>
                            <thead><tr><th>順位</th><th>名前</th><th>得点</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>`;

        const tbody = document.querySelector(`#eventRankContent_${classId} div[data-event="${eventVal}"] tbody`);
        if (!tbody) return;

        const searchTerm = appState.ui.searchTerm || '';
        const sortedPlayers = appState.players
            .filter(p => p.playerClass === selectedClass)
            .filter(p => p.name.includes(searchTerm))
            .sort((a, b) => (b.scores?.[eventVal] || 0) - (a.scores?.[eventVal] || 0));

        let rank = 1;
        const rowsHtml = sortedPlayers.map((p, i) => {
            const currentScore = p.scores?.[eventVal] || 0;
            if (i > 0 && currentScore < (sortedPlayers[i - 1].scores?.[eventVal] || 0)) {
                rank = i + 1;
            }
            return `
                <tr>
                    <td>${rank}</td><td>${p.name}</td><td>${currentScore.toFixed(3)}</td>
                </tr>`;
        }).join('');
        tbody.innerHTML = rowsHtml;
    }
}
