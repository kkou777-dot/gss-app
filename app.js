// --- アプリケーションの状態管理 ---
const appState = {
    socket: null,
    competitionName: '',
    players: [], // { name, playerClass, playerGroup, floor, vault, bars, beam, total }
    ui: {
        totalRankClass: 'C',
        eventRankClass: 'C',
        eventRankEvent: 'floor',
    }
};

// --- DOM要素のキャッシュ ---
const dom = {};
function cacheDOMElements() {
    const ids = [
        'csvInput', 'csvUploadBtn', 'inputClassSelect', 'inputGroupSelect',
        'inputPlayersArea', 'inputScoreSubmitBtn', 'totalRankTabs', 'eventRankTabs', 
        'printBtn', 'competitionNameInput',
        'competitionName',
        'totalRankContent_C', 'totalRankContent_B', 'totalRankContent_A',
        'classC_playersTable', 'classB_playersTable', 'classA_playersTable',
        'eventRankContent_C_floor', 'eventRankContent_C_vault', 'eventRankContent_C_bars', 'eventRankContent_C_beam',
        'eventRankContent_B_floor', 'eventRankContent_B_vault', 'eventRankContent_B_bars', 'eventRankContent_B_beam',
        'eventRankContent_A_floor', 'eventRankContent_A_vault', 'eventRankContent_A_bars', 'eventRankContent_A_beam'
    ];
    ids.forEach(id => dom[id] = document.getElementById(id));
}


// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    appState.socket = socket;

    cacheDOMElements();
    setupEventListeners();

    // サーバーから最新の状態を受け取る
    socket.on('stateUpdate', (newState) => {
        console.log('サーバーから状態を受信しました');
        appState.players = newState.players || [];
        appState.competitionName = newState.competitionName || '';
        renderAll();
    });

    // 接続時に現在の状態を要求
    socket.on('connect', () => {
        console.log('サーバーに接続しました');
    });
});

function setupEventListeners() {
    // 印刷ボタン
    dom.printBtn.addEventListener('click', () => window.print());

    dom.competitionNameInput.addEventListener('change', (e) => {
        appState.competitionName = e.target.value;
        saveStateToServer();
    });
    // リアルタイムでh1タグだけ更新
    dom.competitionNameInput.addEventListener('input', (e) => {
        appState.competitionName = e.target.value;
        renderCompetitionName();
        saveStateToServer();
    });
    // CSV読み込み
    dom.csvUploadBtn.addEventListener('click', handleCsvUpload);

    // 点数手動入力
    dom.inputClassSelect.addEventListener('change', () => {
        renderGroupOptions();
        renderInputPlayersArea();
    });
    dom.inputGroupSelect.addEventListener('change', renderInputPlayersArea);
    dom.inputScoreSubmitBtn.addEventListener('click', handleSubmitScores);

    // Enterキーで次の入力欄へ移動
    dom.inputPlayersArea.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') {
            return;
        }
        e.preventDefault(); // フォームの送信など、Enterキーのデフォルト動作をキャンセル

        const currentInput = e.target;
        const currentEvent = currentInput.dataset.event;

        // 表示されているすべての入力欄を取得
        const allInputs = Array.from(dom.inputPlayersArea.querySelectorAll('input[type="number"]'));
        const currentIndex = allInputs.indexOf(currentInput);

        // 次の同じ種目の入力欄を探す
        for (let i = currentIndex + 1; i < allInputs.length; i++) {
            if (allInputs[i].dataset.event === currentEvent) {
                allInputs[i].focus();
                return; // 次の入力欄にフォーカスしたら処理を終了
            }
        }
    });

    // 総合ランキングのタブ
    dom.totalRankTabs.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            appState.ui.totalRankClass = e.target.dataset.class;
            renderTotalRanking();
        }
    });

    // 種目別ランキングのタブ
    dom.eventRankTabs.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            appState.ui.eventRankClass = e.target.dataset.class;
            renderEventRanking();
        }
    });

}

// --- データ処理 ---
function handleCsvUpload() {
    if (!dom.csvInput.files.length) {
        alert('CSVファイルを選択してください');
        return;
    }
    const file = dom.csvInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        parseCSV(e.target.result);
        saveStateToServer(); // データをサーバーに保存
        renderAll();
        alert(`${appState.players.length}名の選手データを読み込みました。`);
    };
    reader.readAsText(file, 'UTF-8');
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).slice(1); // ヘッダー行を除外
    appState.players = lines.map(line => {
        const cols = line.split(',');
        if (cols.length < 8) return null;

        const playerClass = cols[0].trim();
        let playerGroup = cols[1].trim();
        if (/^\d+$/.test(playerGroup)) playerGroup += '組';
        const name = cols[3].trim();
        const floor = parseFloat(cols[4]) || 0;
        const vault = parseFloat(cols[5]) || 0;
        const bars = parseFloat(cols[6]) || 0;
        const beam = parseFloat(cols[7]) || 0;

        if (!name || !playerClass || !playerGroup) return null;

        return { name, playerClass, playerGroup, floor, vault, bars, beam, total: floor + vault + bars + beam };
    }).filter(p => p !== null); // 不正な行を除外

    dom.csvInput.value = '';
}

function handleSubmitScores() {
    const inputs = dom.inputPlayersArea.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
        const index = parseInt(input.dataset.index, 10);
        const event = input.dataset.event;
        const value = parseFloat(input.value) || 0;
        if (!isNaN(index) && event && appState.players[index]) {
            appState.players[index][event] = value;
        }
    });

    // 合計点を再計算
    appState.players.forEach(p => {
        p.total = (p.floor || 0) + (p.vault || 0) + (p.bars || 0) + (p.beam || 0);
    });

    saveStateToServer(); // データをサーバーに保存
    renderAll();
    alert('点数を登録しました');
}

// --- サーバーとの通信 ---
function saveStateToServer() {
    if (!appState.socket) return;
    console.log('サーバーに状態を送信します');
    // UIの状態は送信しない
    const stateToSend = {
        competitionName: appState.competitionName,
        players: appState.players,
    };
    appState.socket.emit('stateUpdate', stateToSend);
}

// --- 描画処理 ---
function renderAll() {
    renderCompetitionName();
    renderGroupOptions();
    renderInputPlayersArea();
    renderTotalRanking();
    renderEventRanking();
}

function renderGroupOptions() {
    const classVal = dom.inputClassSelect.value;
    const groups = [...new Set(appState.players.filter(p => p.playerClass === classVal).map(p => p.playerGroup))].sort();

    dom.inputGroupSelect.innerHTML = '';
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = group;
        dom.inputGroupSelect.appendChild(option);
    });
}

function renderCompetitionName() {
    const name = appState.competitionName || '体操スコアシート';
    dom.competitionName.textContent = name;
    dom.competitionNameInput.value = appState.competitionName;
    document.title = name;
}
function renderInputPlayersArea() {
    const classVal = dom.inputClassSelect.value;
    const groupVal = dom.inputGroupSelect.value;
    const filteredPlayers = appState.players.map((p, i) => ({...p, originalIndex: i}))
                                        .filter(p => p.playerClass === classVal && p.playerGroup === groupVal);

    if (filteredPlayers.length === 0) {
        dom.inputPlayersArea.innerHTML = '<div style="color:#888;">このクラス・組には選手がいません。</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    filteredPlayers.forEach(p => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-input-row';
        playerDiv.innerHTML = `
            <div class="player-name">${p.name}</div>
            <div class="score-inputs">
                <span>床: <input type='number' min='0' step='0.001' value='${p.floor|| ""}' data-event='floor' data-index='${p.originalIndex}'></span>
                <span>跳馬: <input type='number' min='0' step='0.001' value='${p.vault|| ""}' data-event='vault' data-index='${p.originalIndex}'></span>
                <span>段違い: <input type='number' min='0' step='0.001' value='${p.bars|| ""}' data-event='bars' data-index='${p.originalIndex}'></span>
                <span>平均台: <input type='number' min='0' step='0.001' value='${p.beam|| ""}' data-event='beam' data-index='${p.originalIndex}'></span>
            </div>
        `;
        fragment.appendChild(playerDiv);
    });
    dom.inputPlayersArea.innerHTML = '';
    dom.inputPlayersArea.appendChild(fragment);
}

function renderTotalRanking() {
    const selectedClass = appState.ui.totalRankClass;

    // タブのアクティブ状態を更新
    dom.totalRankTabs.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === selectedClass);
    });
    // C, B, Aクラス全てのランキングコンテンツを一度取得し、IDが一致するものだけをアクティブにする
    ['C', 'B', 'A'].forEach(cls => {
        const contentDiv = dom[`totalRankContent_${cls}`];
        if (contentDiv) contentDiv.classList.toggle('active', cls === selectedClass);
    });

    // 全てのクラスのテーブルを更新
    ['C', 'B', 'A'].forEach(classVal => {
        const table = dom[`class${classVal}_playersTable`];
        if (!table) return;
        const tbody = table.querySelector('tbody');

        const sortedPlayers = appState.players
            .map((p, i) => ({ ...p, originalIndex: i }))
            .filter(p => p.playerClass === classVal)
            .sort((a, b) => b.total - a.total);

        tbody.innerHTML = '';
        const fragment = document.createDocumentFragment();
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
                <td><button type="button" onclick="scrollToPlayerInput(${p.originalIndex})">編集</button></td>
            `;
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    });
}

function renderEventRanking() {
    const selectedClass = appState.ui.eventRankClass;
    // タブのアクティブ状態を更新
    dom.eventRankTabs.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === selectedClass);
    });
    ['C', 'B', 'A'].forEach(cls => {
        const contentDiv = document.getElementById(`eventRankContent_${cls}`);
        if (contentDiv) contentDiv.classList.toggle('active', cls === selectedClass);
    });

    // 全てのクラス・種目のランキングを更新
    ['C', 'B', 'A'].forEach(classVal => {
        const classContentDiv = document.getElementById(`eventRankContent_${classVal}`);
        if (!classContentDiv) return;

        ['floor', 'vault', 'bars', 'beam'].forEach(eventVal => {
            const eventDiv = classContentDiv.querySelector(`[data-event="${eventVal}"]`);
            if (!eventDiv) return;

            const tbody = eventDiv.querySelector('tbody');
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

/**
 * 指定された選手のスコア入力欄にスクロールする
 * @param {number} originalIndex - スクロール対象の選手の元のインデックス
 */
function scrollToPlayerInput(originalIndex) {
    const player = appState.players[originalIndex];
    if (!player) {
        console.error(`Player with index ${originalIndex} not found.`);
        return;
    }

    // 1. クラスと組のセレクトボックスを該当選手の値に設定
    dom.inputClassSelect.value = player.playerClass;
    renderGroupOptions(); // クラスに合わせた組の選択肢を再描画
    dom.inputGroupSelect.value = player.playerGroup;

    // 2. スコア入力欄を再描画
    renderInputPlayersArea();

    // 3. 該当選手の入力欄までスクロール
    const targetInput = dom.inputPlayersArea.querySelector(`input[data-index="${originalIndex}"]`);
    if (targetInput) {
        const playerRow = targetInput.closest('.player-input-row');
        playerRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
