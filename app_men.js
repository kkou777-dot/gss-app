// --- DOM要素のキャッシュ ---
const dom = {};

// --- アプリケーションの状態管理 ---
const appState = {
    socket: null,
    competitionName: '',
    players: [], // { name, playerClass, playerGroup, floor, pommel, rings, vault, pbars, hbar, total }
    ui: {
        totalRankClass: 'C',
        eventRankClass: 'C',
    }
};
const MEN_EVENTS = ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'];

function cacheDOMElements() {
    const ids = [
        'csvInput', 'csvUploadBtn', 'inputClassSelect', 'inputGroupSelect',
        'inputPlayersArea', 'inputScoreSubmitBtn', 'totalRankTabs', 'eventRankTabs',
        'printBtn', 'competitionNameInput', 'competitionName',
        'totalRankContent_C', 'totalRankContent_B', 'totalRankContent_A',
        'classC_playersTable', 'classB_playersTable', 'classA_playersTable',
        'eventRankContent_C', 'eventRankContent_B', 'eventRankContent_A',
        'saveButton', 'saveStatus', 'connectionStatus', 'print-container',
        'csvHelpBtn', 'csvHelpModal', 'closeCsvHelpModal'
    ];
    // 動的に種目別ランキングのIDを追加
    ['C', 'B', 'A'].forEach(cls => {
        MEN_EVENTS.forEach(evt => {
            ids.push(`eventRankContent_${cls}_${evt}`);
        });
    });
    ids.forEach(id => dom[id] = document.getElementById(id));
}

function handleCsvUpload() {
    if (!dom.csvInput.files.length) {
        alert('CSVファイルを選択してください。');
        return;
    }
    const file = dom.csvInput.files[0];
    const reader = new FileReader();
    reader.onerror = () => { alert(`ファイルの読み込みに失敗しました: ${reader.error}`); console.error('FileReader error:', reader.error); };
    reader.onload = (e) => {
        const result = parseCSV(e.target.result);
        if (result.newPlayers.length > 0) {
            appState.players = result.newPlayers;
            renderAll();
            saveStateToServer();
        }
        let message = `${result.newPlayers.length}名の選手データを読み込みました。`;
        if (result.errors.length > 0) {
            message += `\n\n以下の${result.errors.length}件のエラーが見つかりました：\n`;
            message += result.errors.map(err => `- ${err.lineNumber}行目: ${err.message}`).join('\n');
        }
        alert(message);
        dom.csvInput.value = '';
    };
    reader.readAsText(file, 'Shift_JIS');
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).slice(1);
    const newPlayers = [];
    const errors = [];
    lines.forEach((line, index) => {
        const lineNumber = index + 2;
        const cols = line.split(',');
        if (cols.length < 10) {
            errors.push({ lineNumber, message: '列の数が不足しています(男子は10列必要)。' });
            return;
        }
        const playerClass = cols[0].trim();
        let playerGroup = cols[1].trim();
        if (/^\d+$/.test(playerGroup)) playerGroup += '組';
        const name = cols[3].trim();
        if (!name || !playerClass || !playerGroup) {
            errors.push({ lineNumber, message: 'クラス、組、または選手名が空です。' });
            return;
        }
        const scores = {};
        MEN_EVENTS.forEach((event, i) => {
            scores[event] = parseFloat(cols[4 + i]) || 0;
        });
        const total = MEN_EVENTS.reduce((sum, event) => sum + scores[event], 0);
        newPlayers.push({ name, playerClass, playerGroup, ...scores, total });
    });
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
    appState.players.forEach(p => {
        p.total = MEN_EVENTS.reduce((sum, event) => sum + (p[event] || 0), 0);
    });
    renderAll();
    saveStateToServer();
    alert('点数を登録しました');
}

function saveStateToServer(data) {
    if (!appState.socket) return;
    dom.saveStatus.textContent = '保存中...';
    const stateToSend = data || { competitionName: appState.competitionName, players: appState.players };
    appState.socket.emit('saveDataMen', stateToSend, (response) => { // 男子用イベントを送信
        if (response && response.success) {
            dom.saveStatus.textContent = response.message || '自動保存しました';
            setTimeout(() => dom.saveStatus.textContent = '', 3000);
        } else {
            dom.saveStatus.textContent = (response && response.message) || '自動保存に失敗しました';
        }
    });
}

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
    const name = appState.competitionName || '体操スコアシート (男子)';
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
                <span>あん馬: <input type='number' min='0' step='0.001' value='${p.pommel|| ""}' data-event='pommel' data-index='${p.originalIndex}'></span>
                <span>つり輪: <input type='number' min='0' step='0.001' value='${p.rings|| ""}' data-event='rings' data-index='${p.originalIndex}'></span>
                <span>跳馬: <input type='number' min='0' step='0.001' value='${p.vault|| ""}' data-event='vault' data-index='${p.originalIndex}'></span>
                <span>平行棒: <input type='number' min='0' step='0.001' value='${p.pbars|| ""}' data-event='pbars' data-index='${p.originalIndex}'></span>
                <span>鉄棒: <input type='number' min='0' step='0.001' value='${p.hbar|| ""}' data-event='hbar' data-index='${p.originalIndex}'></span>
            </div>
        `;
        fragment.appendChild(playerDiv);
    });
    dom.inputPlayersArea.innerHTML = '';
    dom.inputPlayersArea.appendChild(fragment);
}

function renderTotalRanking() {
    const selectedClass = appState.ui.totalRankClass;
    updateTabAndContentActiveState(dom.totalRankTabs, 'totalRankContent', selectedClass);
    ['C', 'B', 'A'].forEach(classVal => {
        const tbody = dom[`class${classVal}_playersTable`]?.querySelector('tbody');
        if (!tbody) return;
        const sortedPlayers = appState.players.map((p, i) => ({ ...p, originalIndex: i })).filter(p => p.playerClass === classVal).sort((a, b) => b.total - a.total);
        tbody.innerHTML = '';
        let rank = 1;
        sortedPlayers.forEach((p, i) => {
            if (i > 0 && (p.total || 0) < (sortedPlayers[i - 1].total || 0)) rank = i + 1;
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${rank}</td><td>${p.name}</td><td>${p.playerGroup}</td><td>${p.total.toFixed(3)}</td><td><button type="button" onclick="scrollToPlayerInput(${p.originalIndex})">編集</button></td>`;
            tbody.appendChild(tr);
        });
    });
}

function renderEventRanking() {
    const selectedClass = appState.ui.eventRankClass;
    updateTabAndContentActiveState(dom.eventRankTabs, 'eventRankContent', selectedClass);
    ['C', 'B', 'A'].forEach(classVal => {
        MEN_EVENTS.forEach(eventVal => {
            const tbody = dom[`eventRankContent_${classVal}_${eventVal}`]?.querySelector('tbody');
            if (!tbody) return;
            const sortedPlayers = appState.players.filter(p => p.playerClass === classVal).sort((a, b) => (b[eventVal] || 0) - (a[eventVal] || 0));
            tbody.innerHTML = '';
            let rank = 1;
            sortedPlayers.forEach((p, i) => {
                if (i > 0 && (p[eventVal] || 0) < (sortedPlayers[i - 1][eventVal] || 0)) rank = i + 1;
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${rank}</td><td>${p.name}</td><td>${(p[eventVal] || 0).toFixed(3)}</td>`;
                tbody.appendChild(tr);
            });
        });
    });
}

function updateTabAndContentActiveState(tabsContainer, contentIdPrefix, selectedClass) {
    tabsContainer.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.class === selectedClass));
    ['C', 'B', 'A'].forEach(cls => dom[`${contentIdPrefix}_${cls}`]?.classList.toggle('active', cls === selectedClass));
}

function scrollToPlayerInput(originalIndex) {
    const player = appState.players[originalIndex];
    if (!player) return;
    dom.inputClassSelect.value = player.playerClass;
    renderGroupOptions();
    dom.inputGroupSelect.value = player.playerGroup;
    renderInputPlayersArea();
    const targetInput = dom.inputPlayersArea.querySelector(`input[data-index="${originalIndex}"]`);
    targetInput?.closest('.player-input-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function prepareForPrint() {
    const container = dom['print-container'];
    if (!container) return;
    container.innerHTML = '';
    const competitionName = appState.competitionName || '体操スコアシート (男子)';
    ['C', 'B', 'A'].forEach(classVal => {
        const playersInClass = appState.players.filter(p => p.playerClass === classVal).sort((a, b) => (b.total || 0) - (a.total || 0));
        if (playersInClass.length === 0) return;
        let rank = 1;
        const rankedPlayers = playersInClass.map((p, i) => {
            if (i > 0 && (p.total || 0) < (playersInClass[i - 1].total || 0)) rank = i + 1;
            return { ...p, rank };
        });
        const pageDiv = document.createElement('div');
        pageDiv.className = 'print-page';
        let tableHTML = `<h2>${competitionName} - ${classVal}クラス 結果</h2><table><thead><tr><th>順位</th><th>選手名</th>
            <th>床</th><th>あん馬</th><th>つり輪</th><th>跳馬</th><th>平行棒</th><th>鉄棒</th><th>総合得点</th></tr></thead><tbody>`;
        rankedPlayers.forEach(p => {
            tableHTML += `<tr><td>${p.rank}</td><td>${p.name}</td>
                <td>${(p.floor || 0).toFixed(3)}</td><td>${(p.pommel || 0).toFixed(3)}</td><td>${(p.rings || 0).toFixed(3)}</td>
                <td>${(p.vault || 0).toFixed(3)}</td><td>${(p.pbars || 0).toFixed(3)}</td><td>${(p.hbar || 0).toFixed(3)}</td>
                <td>${(p.total || 0).toFixed(3)}</td></tr>`;
        });
        tableHTML += `</tbody></table>`;
        pageDiv.innerHTML = tableHTML;
        container.appendChild(pageDiv);
    });
}

function setupEventListeners() {
    dom.printBtn.addEventListener('click', () => { prepareForPrint(); window.print(); });
    dom.competitionNameInput.addEventListener('change', (e) => { appState.competitionName = e.target.value; saveStateToServer(); });
    dom.csvUploadBtn.addEventListener('click', handleCsvUpload);
    dom.inputClassSelect.addEventListener('change', () => { renderGroupOptions(); renderInputPlayersArea(); });
    dom.inputGroupSelect.addEventListener('change', renderInputPlayersArea);
    dom.inputScoreSubmitBtn.addEventListener('click', handleSubmitScores);
    dom.inputPlayersArea.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
        e.preventDefault();
        const allInputs = Array.from(dom.inputPlayersArea.querySelectorAll('input[type="number"]'));
        const currentIndex = allInputs.indexOf(e.target);
        for (let i = currentIndex + 1; i < allInputs.length; i++) {
            if (allInputs[i].dataset.event === e.target.dataset.event) {
                allInputs[i].focus();
                return;
            }
        }
    });
    dom.totalRankTabs.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { appState.ui.totalRankClass = e.target.dataset.class; renderTotalRanking(); } });
    dom.eventRankTabs.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { appState.ui.eventRankClass = e.target.dataset.class; renderEventRanking(); } });
    dom.competitionNameInput.addEventListener('input', (e) => { appState.competitionName = e.target.value; renderCompetitionName(); });

    // CSVヘルプモーダルのイベントリスナー
    dom.csvHelpBtn.addEventListener('click', () => {
        dom.csvHelpModal.style.display = 'block';
    });
    dom.closeCsvHelpModal.addEventListener('click', () => {
        dom.csvHelpModal.style.display = 'none';
    });
    window.addEventListener('click', (e) => {
        if (e.target == dom.csvHelpModal) {
            dom.csvHelpModal.style.display = 'none';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://gymnastics-score-app.onrender.com', {
        reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000,
    });
    appState.socket = socket;
    setupSocketEventListeners(socket);
    cacheDOMElements();
    setupEventListeners();
});

function setupSocketEventListeners(socket) {
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        if (dom.connectionStatus) { dom.connectionStatus.textContent = ''; dom.connectionStatus.style.display = 'none'; }
        dom.saveButton.disabled = true;
        socket.emit('requestInitialDataMen'); // 男子用データを要求
    });
    socket.on('stateUpdateMen', (newState) => { // 男子用データを受信
        console.log('サーバーから男子の最新の状態を受信しました。');
        appState.players = newState.players || [];
        appState.competitionName = newState.competitionName || '';
        if (!dom.saveButton.dataset.listenerAttached) {
            dom.saveButton.addEventListener('click', () => {
                const stateToSend = { competitionName: appState.competitionName, players: appState.players };
                saveStateToServer(stateToSend);
            });
            dom.saveButton.dataset.listenerAttached = 'true';
        }
        dom.saveButton.disabled = false;
        renderAll();
    });
    socket.on('disconnect', () => {
        if (dom.connectionStatus) { dom.connectionStatus.textContent = 'サーバーとの接続が切れました。再接続します...'; dom.connectionStatus.style.display = 'block'; }
    });
    socket.on('reconnecting', (attemptNumber) => {
        if (dom.connectionStatus) { dom.connectionStatus.textContent = `サーバーとの接続が切れました。再接続します... (${attemptNumber}回目)`; dom.connectionStatus.style.display = 'block'; }
    });
}
