document.addEventListener('DOMContentLoaded', () => {
    const GENDER = 'men';
    const EVENTS = ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'];
    const EVENT_NAMES = {
        floor: '床',
        pommel: 'あん馬',
        rings: 'つり輪',
        vault: '跳馬',
        pbars: '平行棒',
        hbar: '鉄棒'
    };

    const socket = io({
        transports: ['websocket', 'polling']
    });

    let appState = {
        competitionName: '',
        players: []
    };

    // --- DOM Elements ---
    const competitionNameDisplay = document.getElementById('competitionName');
    const competitionNameInput = document.getElementById('competitionNameInput');
    const saveButton = document.getElementById('saveButton');
    const saveStatus = document.getElementById('saveStatus');
    const connectionStatus = document.getElementById('connectionStatus');

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        connectionStatus.textContent = 'サーバーに接続済み';
        connectionStatus.style.backgroundColor = '#e8f5e9';
        connectionStatus.style.borderColor = '#a5d6a7';
        connectionStatus.style.display = 'block';
        socket.emit('requestInitialDataMen');
    });

    socket.on('disconnect', () => {
        console.log('サーバーから切断されました。');
        connectionStatus.textContent = 'サーバーから切断されました。再接続を試みています...';
        connectionStatus.style.backgroundColor = '#ffebee';
        connectionStatus.style.borderColor = '#ef9a9a';
        connectionStatus.style.display = 'block';
    });

    socket.on('stateUpdateMen', (newState) => {
        console.log('サーバーから状態の更新を受け取りました。', newState);
        appState = newState;
        updateAllUI();
    });

    // --- UI Update Functions ---
    function updateAllUI() {
        if (!appState) return;
        competitionNameDisplay.textContent = appState.competitionName || `体操スコアシート (${GENDER === 'women' ? '女子' : '男子'})`;
        competitionNameInput.value = appState.competitionName;
        updateRankingTables();
        updateInputArea();
    }

    function updateRankingTables() {
        const classes = ['A', 'B', 'C'];
        classes.forEach(playerClass => {
            const totalRankTableBody = document.querySelector(`#class${playerClass}_playersTable tbody`);
            if(totalRankTableBody) {
                totalRankTableBody.innerHTML = '';
                const classPlayers = appState.players
                    .map((p, index) => ({ ...p, originalIndex: index }))
                    .filter(p => p.playerClass === playerClass)
                    .sort((a, b) => b.total - a.total);

                classPlayers.forEach((player, rankIndex) => {
                    const rank = rankIndex + 1;
                    const row = totalRankTableBody.insertRow();
                    row.innerHTML = `
                        <td>${rank}</td>
                        <td>${player.name}</td>
                        <td>${player.playerGroup || ''}</td>
                        <td>${player.total.toFixed(3)}</td>
                        <td><button class="edit-btn" data-player-index="${player.originalIndex}">編集</button></td>
                    `;
                });
            }

            EVENTS.forEach(event => {
                const eventRankTableBody = document.querySelector(`#eventRankContent_${playerClass}_${event} tbody`);
                if(eventRankTableBody) {
                    eventRankTableBody.innerHTML = '';
                    const eventPlayers = appState.players
                        .filter(p => p.playerClass === playerClass)
                        .sort((a, b) => b[event] - a[event]);

                    eventPlayers.forEach((player, rankIndex) => {
                        const rank = rankIndex + 1;
                        const row = eventRankTableBody.insertRow();
                        row.innerHTML = `
                            <td>${rank}</td>
                            <td>${player.name}</td>
                            <td>${player[event].toFixed(3)}</td>
                        `;
                    });
                }
            });
        });
    }

    function updateInputArea() {
        const classSelect = document.getElementById('inputClassSelect');
        const groupSelect = document.getElementById('inputGroupSelect');
        const playersArea = document.getElementById('inputPlayersArea');

        const selectedClass = classSelect.value;

        const groups = [...new Set(appState.players.filter(p => p.playerClass === selectedClass).map(p => p.playerGroup))];
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

        const selectedGroup = groupSelect.value;

        playersArea.innerHTML = '';
        const targetPlayers = appState.players
            .map((p, index) => ({ ...p, originalIndex: index }))
            .filter(p => p.playerClass === selectedClass && p.playerGroup === selectedGroup);

        targetPlayers.forEach(player => {
            const playerRow = document.createElement('div');
            playerRow.className = 'player-input-row';
            playerRow.dataset.playerIndex = player.originalIndex;
            let inputsHTML = '';
            EVENTS.forEach(event => {
                inputsHTML += `<label>${EVENT_NAMES[event]}: <input type="number" class="score-input" data-event="${event}" value="${player[event] || ''}" placeholder="0" step="0.001"></label>`;
            });

            playerRow.innerHTML = `
                <span class="player-name">${player.name}</span>
                <div class="score-inputs">${inputsHTML}</div>
            `;
            playersArea.appendChild(playerRow);
        });
    }

    // --- Helper Functions ---
    function setupEnterKeyNavigation() {
        const container = document.getElementById('inputPlayersArea');
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // フォームの送信を防ぐ
                const allInputs = Array.from(container.querySelectorAll('.score-input'));
                const currentIndex = allInputs.indexOf(e.target);
                const nextInput = allInputs[currentIndex + 1];
                if (nextInput) {
                    nextInput.focus();
                }
            }
        });
    }
    // --- Event Listeners ---

    competitionNameInput.addEventListener('input', (e) => {
        appState.competitionName = e.target.value;
        competitionNameDisplay.textContent = appState.competitionName;
    });

    saveButton.addEventListener('click', () => {
        saveStatus.textContent = '保存中...';
        saveStatus.style.color = 'orange';

        socket.emit('saveData', { gender: GENDER, newState: appState }, (response) => {
            if (response.success) {
                saveStatus.textContent = `保存しました (${new Date().toLocaleTimeString()})`;
                saveStatus.style.color = 'green';
            } else {
                saveStatus.textContent = `エラー: ${response.message}`;
                saveStatus.style.color = 'red';
            }
        });
    });

    document.getElementById('inputClassSelect').addEventListener('change', updateInputArea);
    document.getElementById('inputGroupSelect').addEventListener('change', updateInputArea);

    document.getElementById('inputScoreSubmitBtn').addEventListener('click', () => {
        const playerRows = document.querySelectorAll('#inputPlayersArea .player-input-row');
        playerRows.forEach(row => {
            const playerIndex = parseInt(row.dataset.playerIndex, 10);
            let total = 0;
            row.querySelectorAll('.score-input').forEach(input => {
                const event = input.dataset.event;
                const score = parseFloat(input.value) || 0;
                appState.players[playerIndex][event] = score;
                total += score;
            });
            appState.players[playerIndex].total = total;
        });
        updateAllUI();
        alert('点数を登録しました。忘れずに「スプレッドシートに保存」ボタンを押してください。');
    });

    document.getElementById('csvUploadBtn').addEventListener('click', () => {
        const fileInput = document.getElementById('csvInput');
        if (fileInput.files.length === 0) {
            alert('CSVファイルを選択してください。');
            return;
        }
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const rows = text.split('\n').filter(row => row.trim() !== '');
                const newPlayers = rows.slice(1).map(row => {
                    const cols = row.split(',');
                    const player = {
                        playerClass: cols[0]?.trim() || 'C',
                        playerGroup: cols[1]?.trim() || '1組',
                        name: cols[3]?.trim() || '名無し',
                        floor: 0,
                        pommel: 0,
                        rings: 0,
                        vault: 0,
                        pbars: 0,
                        hbar: 0,
                        total: 0
                    };
                    EVENTS.forEach((event, i) => player[event] = parseFloat(cols[i + 4]) || 0);
                    player.total = EVENTS.reduce((sum, event) => sum + player[event], 0);
                    return player;
                });
                appState.players = newPlayers;
                updateAllUI();
                alert(`${newPlayers.length}人の選手データを読み込みました。内容を確認し、問題なければ「スプレッドシートに保存」してください。`);
            } catch (error) {
                alert('CSVファイルの読み込みに失敗しました。形式を確認してください。');
                console.error(error);
            }
        };
        reader.readAsText(file);
    });

    function setupTabs(tabContainerId) {
        const tabContainer = document.getElementById(tabContainerId);
        if (!tabContainer) return;
        tabContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                const playerClass = e.target.dataset.class;
                tabContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                const contentContainer = tabContainer.nextElementSibling.querySelector('.table-wrapper') || tabContainer.nextElementSibling;
                contentContainer.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                document.getElementById(`${contentContainer.children[0].id.split('_')[0]}_${playerClass}`).classList.add('active');
            }
        });
    }
    setupTabs('totalRankTabs');
    setupTabs('eventRankTabs');

    document.querySelector('.container').addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const playerIndex = parseInt(e.target.dataset.playerIndex, 10);
            const player = appState.players[playerIndex];
            openEditModal(player, playerIndex);
        }
    });

    function openEditModal(player, playerIndex) {
        const oldModal = document.getElementById('editModal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'editModal';
        modal.className = 'modal';
        modal.style.display = 'block';

        let inputsHTML = '';
        EVENTS.forEach(event => {
            inputsHTML += `
                <label>${EVENT_NAMES[event]}: 
                    <input type="number" id="edit_${event}" value="${player[event]}" step="0.001">
                </label><br>`;
        });

        modal.innerHTML = `
            <div class="modal-content">
                <span class="close-button" id="closeEditModal">&times;</span>
                <h3>${player.name} のスコア編集</h3>
                <label>名前: <input type="text" id="edit_name" value="${player.name}"></label><br>
                <label>クラス: <input type="text" id="edit_playerClass" value="${player.playerClass}"></label><br>
                <label>組: <input type="text" id="edit_playerGroup" value="${player.playerGroup}"></label><br>
                <hr>
                ${inputsHTML}
                <hr>
                <button id="saveEditBtn">変更を保存</button>
                <button id="deletePlayerBtn" style="background-color: #d32f2f;">選手を削除</button>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('closeEditModal').onclick = () => modal.style.display = 'none';
        modal.onclick = (event) => { if (event.target == modal) { modal.style.display = 'none'; } };

        document.getElementById('saveEditBtn').onclick = () => {
            const editedPlayer = appState.players[playerIndex];
            editedPlayer.name = document.getElementById('edit_name').value;
            editedPlayer.playerClass = document.getElementById('edit_playerClass').value;
            editedPlayer.playerGroup = document.getElementById('edit_playerGroup').value;

            let total = 0;
            EVENTS.forEach(event => {
                const score = parseFloat(document.getElementById(`edit_${event}`).value) || 0;
                editedPlayer[event] = score;
                total += score;
            });
            editedPlayer.total = total;

            updateAllUI();
            modal.style.display = 'none';
        };

        document.getElementById('deletePlayerBtn').onclick = () => {
            if (confirm(`${player.name}さんを削除しますか？この操作は元に戻せません。`)) {
                appState.players.splice(playerIndex, 1);
                updateAllUI();
                modal.style.display = 'none';
            }
        };
    }

    document.getElementById('csvHelpBtn').onclick = () => document.getElementById('csvHelpModal').style.display = 'block';
    document.getElementById('closeCsvHelpModal').onclick = () => document.getElementById('csvHelpModal').style.display = 'none';
    window.onclick = (event) => {
        const modal = document.getElementById('csvHelpModal');
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };

    document.getElementById('printBtn').addEventListener('click', () => {
        const printContainer = document.getElementById('print-container');
        printContainer.innerHTML = '';

        const classes = ['A', 'B', 'C'];
        classes.forEach(playerClass => {
            const classPlayers = appState.players.filter(p => p.playerClass === playerClass).sort((a, b) => b.total - a.total);
            if (classPlayers.length > 0) {
                const page = document.createElement('div');
                page.className = 'print-page';
                let tableHTML = `<h2>${appState.competitionName} - ${playerClass}クラス 総合結果</h2>`;
                tableHTML += `
                    <table border="1" style="width:100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th>順位</th><th>名前</th><th>組</th>
                                ${EVENTS.map(e => `<th>${EVENT_NAMES[e]}</th>`).join('')}
                                <th>合計</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${classPlayers.map((p, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${p.name}</td>
                                    <td>${p.playerGroup}</td>
                                    ${EVENTS.map(e => `<td>${p[e].toFixed(3)}</td>`).join('')}
                                    <td>${p.total.toFixed(3)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>`;
                page.innerHTML = tableHTML;
                printContainer.appendChild(page);
            }
        });

        if (printContainer.innerHTML === '') {
            alert('印刷するデータがありません。');
            return;
        }
        window.print();
    });

    // Enterキーでの移動機能を有効化
    setupEnterKeyNavigation();
});