document.addEventListener('DOMContentLoaded', () => {
    // --- DOMの静的コンテンツを強制的に更新 ---
    // キャッシュが原因で古いHTMLが表示される問題への対策
    const headerControls = document.querySelector('.header-controls');
    if (headerControls) {
        const links = headerControls.querySelectorAll('a');
        if (links[0]) links[0].textContent = '速報(女)';
        if (links[1]) links[1].textContent = '速報(男)';
        const button = headerControls.querySelector('button');
        if (button) button.textContent = '男子用';
    }
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
    let statusContainer = null; // 後で生成するコンテナを格納
    let autoSaveToggle = null; // 後で生成するトグルスイッチを格納

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('サーバーに接続しました。');
        connectionStatus.textContent = 'サーバーに接続済み';
        connectionStatus.style.backgroundColor = '#e8f5e9';
        connectionStatus.style.borderColor = '#a5d6a7';
        // UIの準備ができてからデータを要求
        setupDynamicUI();
        // サーバーから最新データを要求
        socket.emit('requestInitialData');
    });

    socket.on('disconnect', () => {
        console.log('サーバーから切断されました。');
        connectionStatus.textContent = 'サーバーから切断されました。再接続を試みています...';
        connectionStatus.style.backgroundColor = '#ffebee';
        connectionStatus.style.borderColor = '#ef9a9a';
        // statusContainerが存在する場合のみ操作する
        if (statusContainer) {
            statusContainer.prepend(connectionStatus); // 再接続時に表示を戻す
        }
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
        if (competitionNameDisplay) competitionNameDisplay.textContent = appState.competitionName || `体操スコアシート (女子)`;
        if (competitionNameInput) competitionNameInput.value = appState.competitionName;

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
                        <td><button class="edit-btn" data-player-id="${player.id}">編集</button></td>
                    `;
                });
            }

            // 種目別ランキング
            if (document.getElementById(`eventRankContent_${playerClass}_${EVENTS[0]}`)) { // 種目別ランキングテーブルが存在するかチェック
                EVENTS.forEach(event => {
                const eventRankTableBody = document.querySelector(`#eventRankContent_${playerClass}_${event} tbody`);
                if(eventRankTableBody) {
                    eventRankTableBody.innerHTML = '';
                    const eventPlayers = appState.players
                        .filter(p => p.playerClass === playerClass)
                    .sort((a, b) => (b.scores?.[event] || 0) - (a.scores?.[event] || 0));

                let rank = 1;
                eventPlayers.forEach((player, i) => {
                    const currentScore = player.scores?.[event] || 0;
                    // 同順位ロジック: 前の選手がいて、そのスコアより低い場合に順位を下げる
                    if (i > 0 && currentScore < (eventPlayers[i - 1].scores?.[event] || 0)) {
                        rank = i + 1;
                    }
                    const row = eventRankTableBody.insertRow();
                        row.innerHTML = `
                            <td>${rank}</td>
                            <td>${player.name}</td>
                        <td>${currentScore.toFixed(3)}</td>
                        `;
                    });
                }
                });
            }
        });
    }

    function updateInputArea() {
        const classSelect = document.getElementById('inputClassSelect');
        if (!classSelect) return; // 点数入力ページでなければ処理を中断
        const groupSelect = document.getElementById('inputGroupSelect');
        const playersArea = document.getElementById('inputPlayersArea');

        const selectedClass = classSelect.value;

        // 現在選択されている組を保持
        const previouslySelectedGroup = groupSelect.value;

        // 組セレクトボックスの更新
        const groups = [...new Set(appState.players.filter(p => p.playerClass === selectedClass).map(p => p.playerGroup))];
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

        // 以前選択されていた組が存在すれば、それを再度選択する
        if (groups.includes(previouslySelectedGroup)) {
            groupSelect.value = previouslySelectedGroup;
        }

        const selectedGroup = groupSelect.value;

        // 選手入力エリアの更新
        playersArea.innerHTML = '';
        const targetPlayers = appState.players
            .filter(p => p.playerClass === selectedClass && p.playerGroup === selectedGroup);

        targetPlayers.forEach(player => {
            const playerRow = document.createElement('div');
            playerRow.id = `player-row-${player.id}`;
            playerRow.className = 'player-input-row';
            playerRow.dataset.playerId = player.id;
            let inputsHTML = '';
            EVENTS.forEach(event => {
                const scoreValue = player.scores && player.scores[event] !== undefined ? player.scores[event] : '';
                inputsHTML += `<label>${EVENT_NAMES[event]}: <input type="number" class="score-input" data-event="${event}" value="${scoreValue}" placeholder="0" step="0.001"></label>`;
            });

            playerRow.innerHTML = `
                <span class="reorder-handle">☰</span>
                <span class="player-name">${player.name}</span>
                <div class="score-inputs">${inputsHTML}</div>
            `;
            playersArea.appendChild(playerRow);

            // 各入力欄にイベントリスナーを追加
            playerRow.querySelectorAll('.score-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    socket.emit('updatePlayerScore', { gender: GENDER, playerId: player.id, scoreType: e.target.dataset.event, value: e.target.value });
                });
            });
        });

        // 並び替えライブラリの初期化
        initializeSortable(playersArea);
    }

    function setupDynamicUI() {
        // 既存のコンテナがあれば何もしない
        if (document.getElementById('statusContainer')) return;

        // 接続ステータスと自動保存トグルのコンテナを作成
        statusContainer = document.createElement('div'); // グローバル変数に代入
        statusContainer.id = 'statusContainer';
        statusContainer.className = 'status-container';

        // 自動保存トグルのHTMLを作成
        const autoSaveSwitchHTML = `
            <div class="autosave-switch">
                <label for="autoSaveToggle">自動保存:</label>
                <label class="switch">
                    <input type="checkbox" id="autoSaveToggle">
                    <span class="slider round"></span>
                </label>
            </div>
        `;

        // コンテナに接続ステータスとトグルを追加
        statusContainer.appendChild(connectionStatus);
        statusContainer.insertAdjacentHTML('beforeend', autoSaveSwitchHTML);

        // ヘッダーの先頭にコンテナを挿入
        const header = document.querySelector('header');
        if (header) {
            // ヘッダーがあればその先頭に、なければbodyの先頭に追加する
            header.insertBefore(statusContainer, header.firstChild);
        } else {
            document.body.insertBefore(statusContainer, document.body.firstChild);
        }

        // トグルスイッチの参照を保存
        autoSaveToggle = document.getElementById('autoSaveToggle');
    }


    let sortable = null;
    function initializeSortable(container) {
        if (sortable) {
            sortable.destroy();
        }
        // 現在の並び替えモードのトグルスイッチの状態を確実に取得
        const reorderToggle = document.getElementById('reorderModeToggle');
        const isReorderEnabled = reorderToggle ? reorderToggle.checked : false;

        // SortableJSインスタンスを再作成
        sortable = new Sortable(container, {
            animation: 150,
            handle: '.reorder-handle', // ハンドルでドラッグ
            ghostClass: 'sortable-ghost',
            disabled: !isReorderEnabled, // トグルスイッチの現在の状態に合わせて有効/無効を決定
            onEnd: function (evt) {
                const { oldIndex, newIndex } = evt;
                if (oldIndex === newIndex) return;

                // 並び替え後のDOMの順序から、選手のIDの配列を作成
                const newOrderIdList = Array.from(evt.from.children).map(row => row.dataset.playerId);

                // 1. 並び替えられた選手リストを新しい順序で作成
                const reorderedPlayers = newOrderIdList.map(id => appState.players.find(p => p.id === id));
                // 2. 表示されていない（並び替え対象外の）選手リストを取得
                const otherPlayers = appState.players.filter(p => !newOrderIdList.includes(p.id));
                // 3. 全体の選手リストを「並び替えた選手」+「それ以外の選手」の順で再構築
                appState.players = [...reorderedPlayers, ...otherPlayers];
            },
        });
    }

    // --- Helper Functions ---
    function setupEnterKeyNavigation() {
        const container = document.getElementById('inputPlayersArea');
        if (!container) return;
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
    if (competitionNameInput) competitionNameInput.addEventListener('input', (e) => {
        appState.competitionName = e.target.value;
        if (competitionNameDisplay) competitionNameDisplay.textContent = appState.competitionName || '体操スコアシート (女子)';
        // scheduleAutoSaveは各HTMLで定義されている
        if (typeof window.scheduleAutoSave === 'function') {
            window.scheduleAutoSave();
        }
    });

    // 保存ボタン
    if (saveButton) saveButton.addEventListener('click', () => {
        saveStatus.textContent = '保存中...';
        saveStatus.style.color = 'orange';
        
        // サーバーに保存を依頼する (newStateは送らない)
        socket.emit('saveData', { gender: GENDER }, (response) => {
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
    if (document.getElementById('inputClassSelect')) document.getElementById('inputClassSelect').addEventListener('change', updateInputArea);
    if (document.getElementById('inputGroupSelect')) document.getElementById('inputGroupSelect').addEventListener('change', updateInputArea);

    // 点数一括登録ボタン
    // const inputScoreSubmitBtn = document.getElementById('inputScoreSubmitBtn');
    // if (inputScoreSubmitBtn) {
    //     inputScoreSubmitBtn.addEventListener('click', () => {
    //         const playerRows = document.querySelectorAll('#inputPlayersArea .player-input-row');
    //         playerRows.forEach(row => {
    //             const playerId = row.dataset.playerId;
    //             const player = appState.players.find(p => p.id === playerId);
    //             if (!player) return;
    //             let total = 0;
    //             row.querySelectorAll('.score-input').forEach(input => {
    //                 const event = input.dataset.event;
    //                 const score = parseFloat(input.value) || 0;
    //                 player[event] = score;
    //                 total += score;
    //             });
    //             player.total = total;
    //         });
    //         updateAllUI(); // UIを更新
    //         if (saveButton) saveButton.click(); // 即座に保存処理を実行
    //     });
    // }

    // 選手追加ボタン
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener('click', () => {
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
            id: `new-${Date.now()}`, // 新規追加選手にもユニークIDを付与
            name: name,
            playerClass: playerClass,
            playerGroup: playerGroup,
            scores: { floor: 0, vault: 0, bars: 0, beam: 0 },
            total: 0
        };

        appState.players.push(newPlayer);
        updateAllUI();

        // 入力欄をクリア
        nameInput.value = '';
        groupInput.value = '';
        alert(`${name}さんを追加しました。`);
    });

    // CSV読み込み
    const csvUploadBtn = document.getElementById('csvUploadBtn');
    if (csvUploadBtn) csvUploadBtn.addEventListener('click', () => {
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
                        id: `csv-${Date.now()}-${Math.random()}`, // ユニークIDを付与
                        playerClass: cols[0]?.trim() || 'C',
                        playerGroup: cols[1]?.trim() || '1組',
                        name: cols[3]?.trim() || '名無し',
                        scores: {}, // scoresオブジェクトを初期化
                        total: 0
                    };
                    EVENTS.forEach((event, i) => {
                        player.scores[event] = parseFloat(cols[i + 4]) || 0;
                    });
                    player.total = EVENTS.reduce((sum, event) => sum + (player.scores[event] || 0), 0);
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

    // 大会終了トグル
    if (finalizeToggle) finalizeToggle.addEventListener('change', (e) => {
        const isFinalized = e.target.checked;
        if (isFinalized) {
            if (confirm('本当に大会を終了しますか？\n現在のデータが新しいシートにバックアップされ、入力がロックされます。')) {
                // サーバーに大会終了を通知し、コールバックで結果を受け取る
                socket.emit('finalizeCompetition', { gender: GENDER }, (response) => {
                    if (response.success) {
                        alert(response.message); // 成功メッセージを表示
                        appState.isFinalized = true;
                        lockUI(true);
                    } else {
                        alert(response.message); // 失敗メッセージを表示
                        e.target.checked = false; // 失敗したのでチェックを戻す
                    }
                });
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
    if (reorderToggle) reorderToggle.addEventListener('change', (e) => {
        // --- 機能保留のための無効化 ---
        e.preventDefault();
        e.target.checked = false;
        alert('この機能は現在準備中です。');
        return;
        // --------------------------

        const isEnabled = e.target.checked;
        const playersArea = document.getElementById('inputPlayersArea');
        const toggleLabel = document.querySelector('.reorder-switch span');

        sortable.option('disabled', !isEnabled); // SortableJSの有効/無効を切り替え
        playersArea.classList.toggle('reorder-mode', isEnabled);
        toggleLabel.textContent = isEnabled ? 'ON' : 'OFF';
        toggleLabel.style.color = isEnabled ? 'red' : 'black';
    });
    // --- 機能保留のための初期設定 ---
    if (reorderToggle) {
        reorderToggle.disabled = true; // チェックボックスを無効化
        const label = reorderToggle.previousElementSibling;
        if (label && label.tagName === 'LABEL') {
            label.textContent += '（準備中）';
        }
    }

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
                const contentIdPrefix = contentContainer.querySelector('.tab-content')?.id.split('_')[0];
                if (!contentIdPrefix) return; // プレフィックスが取れなければ中断
                contentContainer.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                document.getElementById(`${contentIdPrefix}_${playerClass}`).classList.add('active');
            }
        });
    }
    setupTabs('totalRankTabs');
    setupTabs('eventRankTabs');

    // 編集ボタン（モーダル）
    const container = document.querySelector('.container');
    if (container) container.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const playerId = e.target.dataset.playerId;
            const player = appState.players.find(p => p.id === playerId);
            if (player) {
                // 編集対象のクラスと組をURLパラメータとして渡す
                window.open(`input.html?class=${player.playerClass}&group=${encodeURIComponent(player.playerGroup)}`, '_blank');
            }
        }
    });

    // CSVヘルプモーダル
    const csvHelpBtn = document.getElementById('csvHelpBtn');
    if (csvHelpBtn) {
        csvHelpBtn.onclick = () => document.getElementById('csvHelpModal').style.display = 'block';
        document.getElementById('closeCsvHelpModal').onclick = () => document.getElementById('csvHelpModal').style.display = 'none';
        window.onclick = (event) => {
            const modal = document.getElementById('csvHelpModal');
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    }

    // 印刷処理
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', () => {
        const printContainer = document.getElementById('print-container');
        printContainer.innerHTML = ''; // 中身をクリア

        const classes = ['A', 'B', 'C'];
        classes.forEach(playerClass => {
            // --- 種目別順位を先に計算 ---
            const eventRanks = {};
            EVENTS.forEach(event => { // 'floor', 'vault', ...
                const sortedPlayers = [...appState.players]
                    .filter(p => p.playerClass === playerClass)
                    .sort((a, b) => (b.scores?.[event] || 0) - (a.scores?.[event] || 0));

                eventRanks[event] = new Map();
                let rank = 1;
                sortedPlayers.forEach((player, i) => {
                    // 前の選手がいて、そのスコアより低い場合に順位を下げる（同順位を考慮）
                    if (i > 0 && (player.scores?.[event] || 0) < (sortedPlayers[i - 1].scores?.[event] || 0)) {
                        rank = i + 1;
                    }
                    eventRanks[event].set(player.id, rank); // IDをキーにして順位を保存
                });
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
                                    <td>${(p.total || 0).toFixed(3)}</td>
                                    ${EVENTS.map(e => `<td>${(p.scores?.[e] || 0).toFixed(3)} (${eventRanks[e].get(p.id) || '-'})</td>`).join('')}
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

    // URLパラメータをチェックして、特定のクラス/組を表示
    const urlParams = new URLSearchParams(window.location.search);
    const targetClass = urlParams.get('class');
    const targetGroup = urlParams.get('group');
    if (targetClass && targetGroup) {
        const classSelect = document.getElementById('inputClassSelect');
        const groupSelect = document.getElementById('inputGroupSelect');
        if (classSelect) classSelect.value = targetClass;
        // updateInputAreaが呼ばれるのを待ってから組を設定
        setTimeout(() => { if (groupSelect) groupSelect.value = targetGroup; updateInputArea(); }, 100);
    }
});
