// --- DOM要素のキャッシュ ---
const dom = {};

// --- アプリケーションの状態管理 ---
const appState = {
    socket: null,
    competitionName: '',
    players: [], // { name, playerClass, playerGroup, floor, vault, bars, beam, total }
    ui: {
        totalRankClass: 'C',
        eventRankClass: 'C',
    }
};
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
    ].concat([
        'saveButton',
        'saveStatus',
        'connectionStatus' // 接続状態を表示する要素
    ]);
    ids.forEach(id => dom[id] = document.getElementById(id));
}


// --- 初期化処理 ---

// --- データ処理 ---
function handleCsvUpload() {
    if (!dom.csvInput.files.length) {
        alert('CSVファイルを選択してください');
        return;
    }
    const file = dom.csvInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        const result = parseCSV(e.target.result);
        if (result.newPlayers.length > 0) {
            appState.players = result.newPlayers;
            renderAll();
        }

        let message = `${result.newPlayers.length}名の選手データを読み込みました。`;
        if (result.errors.length > 0) {
            message += `\n\n以下の${result.errors.length}件のエラーが見つかりました：\n`;
            message += result.errors.map(err => `- ${err.lineNumber}行目: ${err.message}`).join('\n');
            console.error("CSVパースエラー:", result.errors);
        }
        alert(message);
    };
    reader.readAsText(file, 'Shift_JIS'); // Excelで作成した日本語CSVはShift_JISが多い
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).slice(1); // ヘッダー行を除外
    const newPlayers = [];
    const errors = [];

    lines.forEach((line, index) => {
        const lineNumber = index + 2; // ヘッダーが1行目なので、データは2行目から
        const cols = line.split(',');

        if (cols.length < 8) {
            errors.push({ lineNumber, message: '列の数が不足しています。' });
            return; // この行の処理をスキップ
        }

        const playerClass = cols[0].trim();
        let playerGroup = cols[1].trim();
        if (/^\d+$/.test(playerGroup)) playerGroup += '組';
        const name = cols[3].trim();

        if (!name || !playerClass || !playerGroup) {
            errors.push({ lineNumber, message: 'クラス、組、または選手名が空です。' });
            return; // この行の処理をスキップ
        }

        const floor = parseFloat(cols[4]) || 0;
        const vault = parseFloat(cols[5]) || 0;
        const bars = parseFloat(cols[6]) || 0;
        const beam = parseFloat(cols[7]) || 0;

        newPlayers.push({ name, playerClass, playerGroup, floor, vault, bars, beam, total: floor + vault + bars + beam });
    });

    dom.csvInput.value = ''; // ファイル選択をリセット

    return { newPlayers, errors };
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

    renderAll();
    alert('点数を登録しました');
}

// --- サーバーとの通信 ---
function saveStateToServer() {
    if (!appState.socket) return;
    console.log('サーバーに状態を送信します (閲覧者向け)');
    // UIの状態は送信しない
    const stateToSend = {
        competitionName: appState.competitionName,
        players: appState.players,
    };
    appState.socket.emit('viewerUpdate', stateToSend);
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

    // タブとコンテンツの表示を更新
    updateTabAndContentActiveState(dom.totalRankTabs, 'totalRankContent', selectedClass);
    
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
                <td>${rank}</td>`;
            tr.appendChild(document.createElement('td')).textContent = p.name;
            tr.appendChild(document.createElement('td')).textContent = p.playerGroup;
            tr.innerHTML += `<td>${p.total.toFixed(3)}</td>
                <td><button type="button" onclick="scrollToPlayerInput(${p.originalIndex})">編集</button></td>
            `;
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    });
}

function renderEventRanking() {
    const selectedClass = appState.ui.eventRankClass;
    // タブとコンテンツの表示を更新
    updateTabAndContentActiveState(dom.eventRankTabs, 'eventRankContent', selectedClass);

    // 全てのクラス・種目のランキングを更新
    ['C', 'B', 'A'].forEach(classVal => {
        const classContentDiv = dom[`eventRankContent_${classVal}`];
        if (!classContentDiv) return;

        ['floor', 'vault', 'bars', 'beam'].forEach(eventVal => {
            const table = dom[`eventRankContent_${classVal}_${eventVal}`];
            if (!table) return;

            const tbody = table.querySelector('tbody');
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
                    <td>${rank}</td>`;
                tr.appendChild(document.createElement('td')).textContent = p.name;
                tr.innerHTML += `<td>${(p[eventVal] || 0).toFixed(3)}</td>`;
                tbody.appendChild(tr);
            });
        });
    });
}

/**
 * タブコンポーネントのアクティブ状態と、関連するコンテンツの表示/非表示を切り替えるヘルパー関数
 * @param {HTMLElement} tabsContainer - タブボタンをラップしている親要素
 * @param {string} contentIdPrefix - コンテンツ要素のIDのプレフィックス (例: 'totalRankContent')
 * @param {string} selectedClass - アクティブにするクラス ('A', 'B', 'C')
 */
function updateTabAndContentActiveState(tabsContainer, contentIdPrefix, selectedClass) {
    tabsContainer.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.class === selectedClass);
    });
    ['C', 'B', 'A'].forEach(cls => {
        const contentDiv = dom[`${contentIdPrefix}_${cls}`] || (contentIdPrefix === 'eventRankContent' ? dom[`${contentIdPrefix}_${cls}_floor`]?.parentElement.parentElement : null);
        if (contentDiv) contentDiv.classList.toggle('active', cls === selectedClass);
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

// --- 初期化処理 ---
function setupEventListeners() {
    // 印刷ボタン
    dom.printBtn.addEventListener('click', () => window.print());

    dom.competitionNameInput.addEventListener('change', (e) => {
        appState.competitionName = e.target.value;
        // 自動保存は行わない
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

    // リアルタイムでh1タグだけ更新
    dom.competitionNameInput.addEventListener('input', (e) => {
        appState.competitionName = e.target.value;
        renderCompetitionName();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const socket = io({
        // Renderの無料プランでは、一定時間アクセスがないと接続が切れるため、
        // 自動的に再接続するように設定します。
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
    });
    appState.socket = socket;

    setupSocketEventListeners(socket);
    // サーバー接続を待たずに実行できるUIの初期化
    cacheDOMElements();

    // UIの準備ができたので、基本的なイベントリスナーを設定
    setupEventListeners();

    // サーバーから最新の状態を受け取った時の処理
    socket.on('stateUpdate', (newState) => {
        console.log('サーバーから最新の状態を受信しました。UIを初期化します。');
        appState.players = newState.players || [];
        appState.competitionName = newState.competitionName || '';

        // データ受信後に初めて保存ボタンの機能を有効化する
        if (!dom.saveButton.dataset.listenerAttached) {
            dom.saveButton.addEventListener('click', () => {
                dom.saveStatus.textContent = '保存中...';
                const stateToSend = {
                    competitionName: appState.competitionName,
                    players: appState.players,
                };
                appState.socket.emit('saveData', stateToSend);
            });
            dom.saveButton.dataset.listenerAttached = 'true';
        }
        dom.saveButton.disabled = false; // 保存ボタンを有効化
        renderAll();
    });

    // 保存完了通知
    socket.on('saveSuccess', (message) => {
        dom.saveStatus.textContent = message;
        setTimeout(() => dom.saveStatus.textContent = '', 3000);
    });

    // サーバーに接続が確立した時の処理
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        dom.connectionStatus.textContent = '';
        dom.connectionStatus.style.display = 'none';
        dom.saveButton.disabled = true; // データ受信まで保存ボタンを無効化
        socket.emit('requestInitialData'); // 接続時に初期データを要求
    });
});

/**
 * WebSocketのイベントリスナーを設定する
 * @param {Socket} socket - Socket.IOのインスタンス
 */
function setupSocketEventListeners(socket) {
    socket.on('disconnect', () => {
        console.warn('サーバーから切断されました。');
        dom.connectionStatus.textContent = 'サーバーとの接続が切れました。再接続します...';
        dom.connectionStatus.style.display = 'block';
    });

    socket.on('reconnecting', (attemptNumber) => {
        console.log(`再接続試行中... (${attemptNumber}回目)`);
        dom.connectionStatus.textContent = `サーバーとの接続が切れました。再接続します... (${attemptNumber}回目)`;
        dom.connectionStatus.style.display = 'block';
    });
}
