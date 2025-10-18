document.addEventListener('DOMContentLoaded', () => {
    // --- 定数定義 ---
    const CLASS_ORDER_MAP = { '上級': 1, '中級': 2, '初級': 3 };
    const EVENTS = { floor: '床', vault: '跳馬', bars: '段違い平行棒', beam: '平均台' };

    // --- DOM要素のキャッシュ ---
    const dom = {};
    const ids = [
        'competitionName', 'lastUpdated', 'playerSearchInput',
        'classTabs', 'rankingTypeSelect',
        'totalRankingSection', 'eventRankingSection', 'connectionStatus', 
        'totalRankTableWrapper', 'eventRankTableWrapper'
    ];
    ids.forEach(id => dom[id] = document.getElementById(id));

    // --- アプリケーションの状態 ---
    let appState = {
        competitionName: '',
        lastUpdated: '',
        players: [],
        ui: {
            selectedClass: '',
            rankingType: 'total',
            searchTerm: ''
        }
    };

    // --- イベントリスナー設定 ---
    function setupEventListeners() {
        dom.classTabs.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                appState.ui.selectedClass = e.target.dataset.class;
                renderAll(appState, dom, CLASS_ORDER_MAP, EVENTS);
            }
        });

        dom.rankingTypeSelect.addEventListener('change', (e) => {
            appState.ui.rankingType = e.target.value;
            renderAll(appState, dom, CLASS_ORDER_MAP, EVENTS);
        });

        dom.playerSearchInput.addEventListener('input', (e) => {
            appState.ui.searchTerm = e.target.value.trim();
            renderAll(appState, dom, CLASS_ORDER_MAP, EVENTS);
        });
    }

    // --- Socket.IO設定 ---
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
            appState = { ...appState, ...newState };
            const classes = getSortedUniqueClasses(appState.players, CLASS_ORDER_MAP);
            if (classes.length > 0 && !classes.includes(appState.ui.selectedClass)) {
                appState.ui.selectedClass = classes[0];
            }
            renderAll(appState, dom, CLASS_ORDER_MAP, EVENTS);
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

    // --- 初期化処理 ---
    setupEventListeners();
    const socket = io({
        transports: ['websocket', 'polling']
    });
    setupSocketEventListeners(socket);
});

// --- 描画処理 ---
function renderAll(appState, dom, classOrder, events) {
    renderTabsAndSelectors(appState, dom, classOrder);
    renderTotalRanking(appState, dom);
    renderEventRanking(appState, dom, events);
    renderCompetitionName(appState, dom);
}

function renderCompetitionName(appState, dom) {
    const competitionTitle = appState.competitionName || '大会結果速報';
    dom.competitionName.textContent = competitionTitle;
    if (dom.lastUpdated) {
        dom.lastUpdated.textContent = appState.lastUpdated ? `(最終更新: ${appState.lastUpdated})` : '';
    }
    document.title = competitionTitle;
}

// 存在するユニークなクラス名を取得し、定義された順序でソートするヘルパー関数
function getSortedUniqueClasses(players, CLASS_ORDER_MAP) {
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

function renderTabsAndSelectors(appState, dom, classOrder) {
    const { selectedClass, rankingType } = appState.ui;
    const classes = getSortedUniqueClasses(appState.players, classOrder);

    // クラス選択タブの動的生成
    dom.classTabs.innerHTML = '';
    classes.forEach((playerClass, index) => {
        const isActive = (selectedClass === '' && index === 0) || selectedClass === playerClass;
        dom.classTabs.innerHTML += `<button data-class="${playerClass}" class="${isActive ? 'active' : ''}">${playerClass}クラス</button>`;
    });

    // Ranking Sections
    const isTotal = rankingType === 'total';
    dom.totalRankingSection.classList.toggle('active', isTotal);
    dom.eventRankingSection.classList.toggle('active', !isTotal);
}

function renderTotalRanking(appState, dom) {
    const selectedClass = appState.ui.selectedClass;
    const totalTableWrapper = dom.totalRankTableWrapper;

    if (!totalTableWrapper) return;
    totalTableWrapper.innerHTML = ''; // クリア

    // 選択されたクラスが存在しない場合は何もしない
    if (!selectedClass) return;

    const classId = selectedClass.replace(/\s/g, '');
    totalTableWrapper.innerHTML = `

            <div id="totalRankContent_${classId}" class="tab-content active">
                <h3>${selectedClass}クラス 総合得点ランキング</h3>
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
        .filter(p => p.name.includes(searchTerm)) // 検索語でフィルタリング
        .sort((a, b) => b.total - a.total);

    let rank = 1;
    const rowsHtml = sortedPlayers.map((p, i) => {
        if (i > 0 && p.total < sortedPlayers[i - 1].total) {
            rank = i + 1;
        }
        return `
            <tr>
                <td>${rank}</td>
                <td>${p.name}</td>
                <td>${p.total.toFixed(3)}</td>
            </tr>`;
    }).join('');
    tbody.innerHTML = rowsHtml;
}

function renderEventRanking(appState, dom, events) {
    const selectedClass = appState.ui.selectedClass;
    const rankingType = appState.ui.rankingType;
    const eventTableWrapper = dom.eventRankTableWrapper;

    if (!eventTableWrapper) return;
    eventTableWrapper.innerHTML = ''; // クリア

    // 選択されたクラスやランキング種別がなければ何もしない
    if (!selectedClass || rankingType === 'total') return;

    const classId = selectedClass.replace(/\s/g, '');
    const eventVal = rankingType;
    const eventName = events[eventVal];

    if (eventName) {
        eventTableWrapper.innerHTML = `
            <div id="eventRankContent_${classId}" class="tab-content active">
                <div class="event-rank-wrapper">
                    <div data-event="${eventVal}" class="active">
                        <h3>${selectedClass}クラス - ${events[eventVal]} ランキング</h3>
                        <table>
                            <thead><tr><th>順位</th><th>名前</th><th>得点</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>`;
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
                    <td>${rank}</td>
                    <td>${p.name}</td>
                    <td>${currentScore.toFixed(3)}</td>
                </tr>`;
        }).join('');
        tbody.innerHTML = rowsHtml;
    }
}
