document.addEventListener('DOMContentLoaded', () => {
    const GENDER = 'women';
    const EVENTS = ['floor', 'vault', 'bars', 'beam'];
    const EVENT_NAMES = {
        floor: '床',
        vault: '跳馬',
        bars: '段違い平行棒',
        beam: '平均台'
    };

    const socket = io({
        // Render.comのスリープ対策
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
    const finalizeToggle = document.getElementById('finalizeToggle');

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        connectionStatus.textContent = 'サーバーに接続済み';
        connectionStatus.style.backgroundColor = '#e8f5e9';
        connectionStatus.style.borderColor = '#a5d6a7';
        connectionStatus.style.display = 'block';
        // サーバーから最新データを要求
        socket.emit('requestInitialData');
    });

    socket.on('disconnect', () => {
        console.log('サーバーから切断されました。');
        connectionStatus.textContent = 'サーバーから切断されました。再接続を試みています...';
        connectionStatus.style.backgroundColor = '#ffebee';
        connectionStatus.style.borderColor = '#ef9a9a';
        connectionStatus.style.display = 'block';
    });

    socket.on('stateUpdate', (newState) => {
        console.log('サーバーから状態の更新を受け取りました。', newState);
        appState = newState;
        updateAllUI();
    });

    // --- UI Update Functions ---
    function updateAllUI() {
        if (!appState) return;
        // 大会名の更新
        competitionNameDisplay.textContent = appState.competitionName || `体操スコアシート (${GENDER === 'women' ? '女子' : '男子'})`;
        competitionNameInput.value = appState.competitionName;

        // ランキングテーブルの更新
        updateRankingTables();
        // 入力エリアの更新
        updateInputArea();
    }

    function updateRankingTables() {
        const classes = ['A', 'B', 'C'];
        classes.forEach(playerClass => {
            // 総合ランキング
            const totalRankTableBody = document.querySelector(`#class${playerClass}_playersTable tbody`);
            if(totalRankTableBody) {
                totalRankTableBody.innerHTML = '';
                const classPlayers = appState.players
                    .map((p, index) => ({ ...p, originalIndex: index })) // 元のインデックスを保持
                    .filter(p => p.playerClass === playerClass)
                    .sort((a, b) => b.total - a.total);

                let rank = 1;
                classPlayers.forEach((player, i) => {
                    // 同順位のロジック: 前の選手より点数が低い場合のみ順位を更新
                    if (i > 0 && player.total < classPlayers[i - 1].total) {
                        rank = i + 1;
                    }
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

            // 種目別ランキング
            EVENTS.forEach(event => {
                const eventRankTableBody = document.querySelector(`#eventRankContent_${playerClass}_${event} tbody`);
                if(eventRankTableBody) {
                    eventRankTableBody.innerHTML = '';
                    const eventPlayers = appState.players
                        .filter(p => p.playerClass === playerClass)
                        .sort((a, b) => b[event] - a[event]);

                let rank = 1;
                let lastScore = -1;
                eventPlayers.forEach((player, i) => {
                    const currentScore = player[event] || 0;
                    if (currentScore < lastScore) {
                        rank = i + 1;
                    }
                    lastScore = currentScore;
                        const row = eventRankTableBody.insertRow();
                        row.innerHTML = `
                            <td>${rank}</td>
                            <td>${player.name}</td>
                        <td>${currentScore.toFixed(3)}</td>
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

        // 組セレクトボックスの更新
        const groups = [...new Set(appState.players.filter(p => p.playerClass === selectedClass).map(p => p.playerGroup))];
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

        const selectedGroup = groupSelect.value;

        // 選手入力エリアの更新
        playersArea.innerHTML = '';
        const targetPlayers = appState.players
            .map((p, index) => ({ ...p, originalIndex: index }))
            .filter(p => p.playerClass === selectedClass && p.playerGroup === selectedGroup);

        targetPlayers.forEach(player => {
            const playerRow = document.createElement('div');
            playerRow.id = `player-row-${player.originalIndex}`;
            playerRow.className = 'player-input-row';
            playerRow.dataset.playerIndex = player.originalIndex;
            let inputsHTML = '';
            EVENTS.forEach(event => {
                inputsHTML += `<label>${EVENT_NAMES[event]}: <input type="number" class="score-input" data-event="${event}" value="${player[event] || ''}" placeholder="0" step="0.001"></label>`;
            });

            playerRow.innerHTML = `
                <span class="reorder-handle">☰</span>
                <span class="player-name">${player.name}</span>
                <div class="score-inputs">${inputsHTML}</div>
            `;
            playersArea.appendChild(playerRow);
        });

        // 並び替えライブラリの初期化
        initializeSortable(playersArea);
    }

    let sortable = null;
    function initializeSortable(container) {
        if (sortable) {
            sortable.destroy();
        }
        sortable = new Sortable(container, {
            animation: 150,
            handle: '.reorder-handle', // ハンドルでドラッグ
            ghostClass: 'sortable-ghost',
            disabled: true, // 初期状態では無効
            onEnd: function (evt) {
                const { oldIndex, newIndex } = evt;
                if (oldIndex === newIndex) return;

                // 表示されている選手リストを取得
                const displayedPlayers = appState.players
                    .map((p, index) => ({ ...p, originalIndex: index }))
                    .filter(p => p.playerClass === document.getElementById('inputClassSelect').value && p.playerGroup === document.getElementById('inputGroupSelect').value);

                // ドラッグされた選手の元のインデックスを取得
                const movedPlayerOriginalIndex = displayedPlayers[oldIndex].originalIndex;
                // 移動先の位置にある選手の元のインデックスを取得
                const targetPlayerOriginalIndex = displayedPlayers[newIndex].originalIndex;

                // appState.players 配列内での実際のインデックスを探す
                const actualOldIndex = appState.players.findIndex(p => p.originalIndex === movedPlayerOriginalIndex);
                const actualTargetIndex = appState.players.findIndex(p => p.originalIndex === targetPlayerOriginalIndex);

                // 配列の要素を移動
                const [movedItem] = appState.players.splice(actualOldIndex, 1);
                appState.players.splice(actualTargetIndex, 0, movedItem);

                // UIを更新して自動保存をトリガー
                updateAllUI();
                scheduleAutoSave();
            },
        });
    }

    // --- Helper Functions ---
    function setupEnterKeyNavigation() {
        const container = document.getElementById('inputPlayersArea');
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // フォームの送信を防ぐ

                const currentInput = e.target;
                const currentEvent = currentInput.dataset.event;

                // 現在の選手行を取得
                const currentRow = currentInput.closest('.player-input-row');
                if (!currentRow) return;

                // 全ての選手行を取得し、現在の行の次を探す
                const allRows = Array.from(container.querySelectorAll('.player-input-row'));
                const currentRowIndex = allRows.indexOf(currentRow);
                const nextRow = allRows[currentRowIndex + 1];

                if (nextRow) {
                    // 次の行から同じ種目の入力欄を探してフォーカスする
                    const nextInput = nextRow.querySelector(`.score-input[data-event="${currentEvent}"]`);
                    if (nextInput) {
                        nextInput.focus();
                    }
                }
            }
        });
    }
    // --- Event Listeners ---

    // 大会名入力
    competitionNameInput.addEventListener('input', (e) => {
        appState.competitionName = e.target.value;
        competitionNameDisplay.textContent = appState.competitionName;
    });

    // 保存ボタン
    saveButton.addEventListener('click', () => {
        saveStatus.textContent = '保存中...';
        saveStatus.style.color = 'orange';

        // サーバーに保存をリクエスト
        // --- 保存するデータをサニタイズ（浄化）する ---
        // UI用に付与した `originalIndex` などを取り除く
        const cleanPlayers = appState.players.map(p => {
            const cleanPlayer = {};
            // GAS側で定義されているヘッダーに含まれるキーのみを抽出
            ['name', 'playerClass', 'playerGroup', 'floor', 'vault', 'bars', 'beam', 'total'].forEach(key => {
                if (p.hasOwnProperty(key)) {
                    cleanPlayer[key] = p[key];
                }
            });
            return cleanPlayer;
        });

        socket.emit('saveData', { gender: GENDER, newState: { ...appState, players: cleanPlayers } }, (response) => {
            if (response.success) {
                saveStatus.textContent = `保存しました (${new Date().toLocaleTimeString()})`;
                saveStatus.style.color = 'green';
            } else {
                saveStatus.textContent = `エラー: ${response.message}`;
                saveStatus.style.color = 'red';
            }
        });
    });

    // 入力エリアのクラス/組セレクタ
    document.getElementById('inputClassSelect').addEventListener('change', updateInputArea);
    document.getElementById('inputGroupSelect').addEventListener('change', updateInputArea);

    // 点数一括登録ボタン
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

    // CSV読み込み
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
                        vault: 0,
                        bars: 0,
                        beam: 0,
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

    // 選手追加ボタン
    document.getElementById('addPlayerBtn').addEventListener('click', () => {
        const nameInput = document.getElementById('newPlayerName');
        const classSelect = document.getElementById('newPlayerClass');
        const groupInput = document.getElementById('newPlayerGroup');

        const name = nameInput.value.trim();
        const playerClass = classSelect.value;
        const playerGroup = groupInput.value.trim();

        if (!name) {
            alert('選手名を入力してください。');
            return;
        }

        const newPlayer = {
            name: name,
            playerClass: playerClass,
            playerGroup: playerGroup,
            floor: 0, vault: 0, bars: 0, beam: 0, total: 0
        };

        appState.players.push(newPlayer);
        updateAllUI();

        // 入力欄をクリア
        nameInput.value = '';
        groupInput.value = '';
        alert(`${name}さんを追加しました。`);
    });

    // 大会終了トグル
    finalizeToggle.addEventListener('change', (e) => {
        const isFinalized = e.target.checked;
        if (isFinalized) {
            if (confirm('本当に大会を終了しますか？\n現在のデータが新しいシートにバックアップされ、入力がロックされます。')) {
                // サーバーに大会終了を通知
                socket.emit('finalizeCompetition', { gender: GENDER });
                appState.isFinalized = true;
                lockUI(true);
            } else {
                e.target.checked = false; // キャンセルされたらチェックを戻す
            }
        } else {
            appState.isFinalized = false;
            lockUI(false);
        }
    });

    function lockUI(isLocked) {
        document.getElementById('finalizeStatus').textContent = isLocked ? '終了' : '進行中';
        // すべての入力フィールドとボタンをロック/解除
        const elementsToLock = document.querySelectorAll(
            '#competitionNameInput, #csvInput, #csvUploadBtn, #addPlayerBtn, #newPlayerName, #newPlayerClass, #newPlayerGroup, #inputScoreSubmitBtn, .score-input, .edit-btn, #reorderModeToggle'
        );
        elementsToLock.forEach(el => {
            el.disabled = isLocked;
        });
        // 並び替えモードも強制的にOFFにする
        if (isLocked) reorderToggle.checked = false;
    }

    // 並び替えモードのトグル
    const reorderToggle = document.getElementById('reorderModeToggle');
    reorderToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        const playersArea = document.getElementById('inputPlayersArea');
        const toggleLabel = document.querySelector('.reorder-switch span');

        sortable.option('disabled', !isEnabled); // SortableJSの有効/無効を切り替え
        playersArea.classList.toggle('reorder-mode', isEnabled);
        toggleLabel.textContent = isEnabled ? 'ON' : 'OFF';
        toggleLabel.style.color = isEnabled ? 'red' : 'black';
    });

    // タブ切り替え
    function setupTabs(tabContainerId) {
        const tabContainer = document.getElementById(tabContainerId);
        if (!tabContainer) return;
        tabContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                const playerClass = e.target.dataset.class;
                // タブのアクティブ状態を切り替え
                tabContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                // コンテンツの表示を切り替え
                const contentContainer = tabContainer.nextElementSibling.querySelector('.table-wrapper') || tabContainer.nextElementSibling;
                contentContainer.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                document.getElementById(`${contentContainer.children[0].id.split('_')[0]}_${playerClass}`).classList.add('active');
            }
        });
    }
    setupTabs('totalRankTabs');
    setupTabs('eventRankTabs');

    // 編集ボタン（モーダル）
    document.querySelector('.container').addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const playerIndex = parseInt(e.target.dataset.playerIndex, 10);
            const player = appState.players[playerIndex];
            openEditModal(player, playerIndex);
        }
    });

    function openEditModal(player, playerIndex) {
        // 古いモーダルがあれば削除
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
                    <input type="number" id="edit_${event}" value="${player[event] || ''}" placeholder="0" step="0.001">
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
            // 変更を保存するために自動保存をトリガー
            scheduleAutoSave();
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

    // CSVヘルプモーダル
    document.getElementById('csvHelpBtn').onclick = () => document.getElementById('csvHelpModal').style.display = 'block';
    document.getElementById('closeCsvHelpModal').onclick = () => document.getElementById('csvHelpModal').style.display = 'none';
    window.onclick = (event) => {
        const modal = document.getElementById('csvHelpModal');
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };

    // 印刷処理
    document.getElementById('printBtn').addEventListener('click', () => {
        const printContainer = document.getElementById('print-container');
        printContainer.innerHTML = ''; // 中身をクリア

        const classes = ['A', 'B', 'C'];
        classes.forEach(playerClass => {
            // --- 種目別順位を先に計算 ---
            const eventRanks = {};
            EVENTS.forEach(event => {
                // 各種目ごとに選手を降順でソート
                const sortedByEvent = appState.players
                    .filter(p => p.playerClass === playerClass)
                    .sort((a, b) => b[event] - a[event]);
                // 選手名と順位のマップを作成
                eventRanks[event] = new Map(sortedByEvent.map((p, i) => [p.name, i + 1]));
            });

            const classPlayers = appState.players.filter(p => p.playerClass === playerClass).sort((a, b) => b.total - a.total);
            if (classPlayers.length > 0) {
                const page = document.createElement('div');
                page.className = 'print-page';
                let tableHTML = `<h2>${appState.competitionName} - ${playerClass}クラス 総合結果</h2>`;
                tableHTML += `
                    <table border="1" style="width:100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th>順位</th><th>名前</th><th>合計</th>
                                ${EVENTS.map(e => `<th>${EVENT_NAMES[e]}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${classPlayers.map((p, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${p.name}</td>
                                    <td>${p.total.toFixed(3)}</td>
                                    ${EVENTS.map(e => `<td>${p[e].toFixed(3)} (${eventRanks[e].get(p.name)})</td>`).join('')}
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