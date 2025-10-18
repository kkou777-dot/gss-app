document.addEventListener('DOMContentLoaded', () => {
    // --- DOMの静的コンテンツを強制的に更新 ---
    // キャッシュが原因で古いHTMLが表示される問題への対策
    const headerControls = document.querySelector('.header-controls');
    if (headerControls) {
        const links = headerControls.querySelectorAll('a');
        if (links[0]) links[0].textContent = '速報(女)';
        if (links[1]) links[1].textContent = '速報(男)';
        const button = headerControls.querySelector('button');
        if (button) button.textContent = '女子用';
    }
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

    // クラスの表示順序を定義 (数値が小さいほど上位)
    const CLASS_ORDER_MAP = {
        '上級': 1,
        '中級': 2,
        '初級': 3,
        // 他のクラスは動的に追加され、このマップにない場合はアルファベット順
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
        socket.emit('requestInitialDataMen');
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

    socket.on('stateUpdateMen', (newState) => {
        console.log('サーバーから状態の更新を受け取りました。', newState);
        appState = newState;
        updateAllUI();
    });

    // --- UI Update Functions ---
    function updateAllUI() {
        console.log('updateAllUI called. Current appState:', JSON.parse(JSON.stringify(appState)));
        if (!appState) return;
        if (competitionNameDisplay) competitionNameDisplay.textContent = appState.competitionName || `体操スコアシート (男子)`;
        if (competitionNameInput) competitionNameInput.value = appState.competitionName;
        updateRankingTables();
        updateInputArea();
    }

    // 存在するユニークなクラス名を取得し、定義された順序でソートする
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

    function updateRankingTables() {
        const totalRankTabsContainer = document.getElementById('totalRankTabs');
        const eventRankTabsContainer = document.getElementById('eventRankTabs');
        const totalTableWrapper = document.getElementById('totalRankTableWrapper');
        const eventTableWrapper = document.getElementById('eventRankTableWrapper');

        if (!totalRankTabsContainer || !eventRankTabsContainer || !totalTableWrapper || !eventTableWrapper) return;
        const classes = getSortedUniqueClasses(appState.players);

        // 既存のタブとコンテンツをクリア
        totalRankTabsContainer.innerHTML = '';
        eventRankTabsContainer.innerHTML = '';
        totalTableWrapper.innerHTML = '';
        eventTableWrapper.innerHTML = '';

        if (classes.length === 0) return;

        // タブとテーブルの骨組みを生成
        classes.forEach((playerClass, index) => {
            const classId = playerClass.replace(/\s/g, ''); // HTML ID用にスペースを除去
            const isActive = index === 0 ? ' active' : '';

            // 総合ランキングのタブとコンテンツを生成
            totalRankTabsContainer.insertAdjacentHTML('beforeend', `<button type="button" data-class="${playerClass}" class="tab-btn${isActive}">${playerClass}クラス</button>`);
            totalTableWrapper.innerHTML += `
                <div id="totalRankContent_${classId}" class="tab-content${isActive}">
                    <h3>${playerClass}クラス 総合得点ランキング</h3>
                    <table id="class${classId}_playersTable">
                        <thead><tr><th>順位</th><th>名前</th><th>組</th><th>合計</th><th>操作</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>`;

            // 種目別ランキングのタブとコンテンツを生成
            eventRankTabsContainer.insertAdjacentHTML('beforeend', `<button type="button" data-class="${playerClass}" class="tab-btn${isActive}">${playerClass}クラス</button>`);
            eventTableWrapper.innerHTML += `
                <div id="eventRankContent_${classId}" class="tab-content${isActive}">
                    <h3>${playerClass}クラス 種目別ランキング</h3>
                    ${EVENTS.map(event => `
                        <div data-event="${event}">
                            <h4>${playerClass}クラス - ${EVENT_NAMES[event]}</h4>
                            <table id="eventRankContent_${classId}_${event}">
                                <thead><tr><th>順位</th><th>名前</th><th>得点</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>`).join('')}
                </div>`;
        });

        // 各テーブルのtbodyを埋める
        classes.forEach(playerClass => {
            populateTotalRankingTable(playerClass);
            populateEventRankingTables(playerClass);
        });

        // 動的に生成されたタブに対してイベントリスナーを再設定
        setupTabs('totalRankTabs');
        setupTabs('eventRankTabs');
    }

    function populateTotalRankingTable(playerClass) {
        const classId = playerClass.replace(/\s/g, '');
        const tbody = document.querySelector(`#class${classId}_playersTable tbody`);
        if (!tbody) return;

        const classPlayers = appState.players
            .filter(p => p.playerClass === playerClass)
            .sort((a, b) => b.total - a.total);

        let rank = 1;
        const rowsHtml = classPlayers.map((player, i) => {
            if (i > 0 && player.total < classPlayers[i - 1].total) {
                rank = i + 1;
            }
            return `
                <tr>
                    <td>${rank}</td>
                    <td>${player.name}</td>
                    <td>${player.playerGroup || ''}</td>
                    <td>${player.total.toFixed(3)}</td>
                    <td>
                        <button class="edit-btn" data-player-id="${player.id}">編集</button>
                        <button class="delete-btn" data-player-id="${player.id}">削除</button>
                    </td>
                </tr>`;
        }).join('');
        tbody.innerHTML = rowsHtml;
    }

    function populateEventRankingTables(playerClass) {
        const classId = playerClass.replace(/\s/g, '');
        EVENTS.forEach(event => {
            const tbody = document.querySelector(`#eventRankContent_${classId}_${event} tbody`);
            if (!tbody) return;

            const eventPlayers = appState.players
                .filter(p => p.playerClass === playerClass)
                .sort((a, b) => (b.scores?.[event] || 0) - (a.scores?.[event] || 0));

            let rank = 1;
            const rowsHtml = eventPlayers.map((player, i) => {
                const currentScore = player.scores?.[event] || 0;
                if (i > 0 && currentScore < (eventPlayers[i - 1].scores?.[event] || 0)) {
                    rank = i + 1;
                }
                return `
                    <tr>
                        <td>${rank}</td>
                        <td>${player.name}</td>
                        <td>${currentScore.toFixed(3)}</td>
                    </tr>`;
            }).join('');
            tbody.innerHTML = rowsHtml;
        });
    }

    function updateInputArea() {
        const classSelect = document.getElementById('inputClassSelect');
        if (!classSelect) return;
        const groupSelect = document.getElementById('inputGroupSelect');
        const playersArea = document.getElementById('inputPlayersArea');

        const previouslySelectedClass = classSelect.value; // 以前選択されていたクラスを保持
        // 現在選択されている組を保持
        const previouslySelectedGroup = groupSelect.value;

        // クラス選択ボックスの更新
        const classes = getSortedUniqueClasses(appState.players);
        classSelect.innerHTML = classes.map(c => `<option value="${c}">${c}クラス</option>`).join('');

        // 以前選択されていたクラスが存在すれば、それを再度選択する
        if (classes.includes(previouslySelectedClass)) {
            classSelect.value = previouslySelectedClass;
        } else if (classes.length > 0) {
            classSelect.value = classes[0]; // なければ最初のクラスを選択
        }

        const selectedClass = classSelect.value;
        const groups = [...new Set(appState.players.filter(p => p.playerClass === selectedClass).map(p => p.playerGroup))];
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

        // 以前選択されていた組が存在すれば、それを再度選択する
        if (groups.includes(previouslySelectedGroup)) {
            groupSelect.value = previouslySelectedGroup;
        } else if (groups.length > 0) {
            groupSelect.value = groups[0]; // なければ最初の組を選択
        }

        const selectedGroup = groupSelect.value;

        playersArea.innerHTML = '';
        const targetPlayers = appState.players
            .filter(p => p.playerClass === selectedClass && p.playerGroup === selectedGroup);

        if (targetPlayers.length === 0) {
            playersArea.innerHTML = '<p style="text-align: center; color: #777; padding: 1em;">この組には選手がいません。</p>';
            initializeSortable(playersArea); // Sortableを空のコンテナで初期化
            return;
        }

        targetPlayers.forEach(player => {            const playerRow = document.createElement('div');
            playerRow.id = `player-row-${player.id}`;
            playerRow.className = 'player-input-row';
            playerRow.dataset.playerId = player.id;
            let inputsHTML = '';
            EVENTS.forEach(event => {
                // サーバー側の `scores` オブジェクトを参照するように変更
                // スコアが0や未定義の場合は空文字にし、入力しやすくする
                const scoreValue = player.scores && player.scores[event] ? player.scores[event] : '';
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
                // 'input'から'change'イベントに変更し、入力中のリアルタイム更新を停止
                input.addEventListener('change', (e) => {
                    const value = parseFloat(e.target.value) || 0;
                    const event = e.target.dataset.event;
                    const targetPlayer = appState.players.find(p => p.id === player.id);
                    if (targetPlayer) {
                        // ローカルのappStateのみを更新
                        targetPlayer.scores[event] = value;
                        // 合計点も再計算
                        targetPlayer.total = EVENTS.reduce((sum, ev) => sum + (targetPlayer.scores[ev] || 0), 0);
                        console.log(`Local state updated for ${player.name}, ${event}: ${value}`);
                    }
                });
            });
        });

        // この組の点数を保存するボタンを追加
        const saveScoresBtnHTML = `
            <div class="save-scores-container">
                <button id="saveScoresBtn" class="button-primary">この組の点数を保存</button>
                <span id="saveScoresStatus" class="save-status-mini"></span>
            </div>
        `;
        playersArea.insertAdjacentHTML('beforeend', saveScoresBtnHTML);

        document.getElementById('saveScoresBtn').addEventListener('click', () => {
            const statusEl = document.getElementById('saveScoresStatus');
            statusEl.textContent = '保存中...';
            // 現在のappStateをサーバーに送信して全体を同期
            socket.emit('viewerUpdateMen', appState, () => {
                statusEl.textContent = `保存完了 (${new Date().toLocaleTimeString()})`;
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
            disabled: true, // 機能保留のため、常に無効化
            // onEnd: function (evt) {
            //     const { oldIndex, newIndex } = evt;
            //     if (oldIndex === newIndex) return;

            //     // 並び替え後のDOMの順序から、選手のIDの配列を作成
            //     const newOrderIdList = Array.from(evt.from.children).map(row => row.dataset.playerId);

            //     // 1. 並び替えられた選手リストを新しい順序で作成
            //     const reorderedPlayers = newOrderIdList.map(id => appState.players.find(p => p.id === id));
            //     // 2. 表示されていない（並び替え対象外の）選手リストを取得
            //     const otherPlayers = appState.players.filter(p => !newOrderIdList.includes(p.id));
            //     // 3. 全体の選手リストを「並び替えた選手」+「それ以外の選手」の順で再構築
            //     appState.players = [...reorderedPlayers, ...otherPlayers];
            // },
        });
    }

    // --- Helper Functions ---
    function setupEnterKeyNavigation() {
        const container = document.getElementById('inputPlayersArea');
        if (container) container.addEventListener('keydown', (e) => {
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

    if (competitionNameInput) competitionNameInput.addEventListener('change', (e) => {
        appState.competitionName = e.target.value;
        if (competitionNameDisplay) competitionNameDisplay.textContent = appState.competitionName || '体操スコアシート (男子)';
        // scheduleAutoSaveは各HTMLで定義されている
        if (typeof window.scheduleAutoSave === 'function') {
            window.scheduleAutoSave();
        }
        // 大会名の変更をサーバーに通知する
        // 選手情報などを含むappState全体を送信し、データの欠落を防ぐ
        socket.emit('viewerUpdateMen', appState);
    });

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

    if (document.getElementById('inputClassSelect')) document.getElementById('inputClassSelect').addEventListener('change', updateInputArea);
    if (document.getElementById('inputGroupSelect')) document.getElementById('inputGroupSelect').addEventListener('change', updateInputArea);

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
                // BOM (Byte Order Mark) を除去する
                const cleanText = text.startsWith('\uFEFF') ? text.substring(1) : text;

                // CSVの1行目から大会名を取得する
                const firstLine = cleanText.split(/\r?\n/)[0];
                const competitionNameFromCsv = firstLine.split(',')[0].trim();

                const rows = cleanText.split(/\r?\n/).filter(row => row.trim() !== ''); // 空行を除外
                // 1行目(大会名)と2行目(ヘッダー)をスキップするため、slice(2)を使用
                const newPlayers = rows.slice(2).map((row, index) => { // index を追加
                    const cols = row.split(',');
                    // クラス名をそのまま使用し、空の場合は「初級」をデフォルトとする
                    const playerClass = cols[0]?.trim() || '初級';

                    const player = {
                        id: `${GENDER}-${index}`, // サーバー側のID生成ロジックと統一
                        playerClass: playerClass, // CSVから読み込んだクラス名をそのまま使用
                        // B列の数字に「組」を付与する。入力がなければ'1組'に。
                        playerGroup: cols[1]?.trim() ? `${cols[1].trim().normalize('NFKC')}組` : '1組',
                        // C列は空欄なのでスキップ
                        name: cols[3]?.trim() || '名無し', // D列
                        scores: {}, // scoresオブジェクトを初期化
                        total: 0
                    };
                    EVENTS.forEach((event, i) => {
                        player.scores[event] = parseFloat(cols[i + 4]) || 0; // E列から種目データ
                    });
                    player.total = EVENTS.reduce((sum, event) => sum + (player.scores[event] || 0), 0);
                    return player;
                });

                // 読み込んだデータをアプリの状態に反映
                appState.competitionName = competitionNameFromCsv || appState.competitionName;
                appState.players = newPlayers;

                // UIを更新
                console.log('CSV parsed. newPlayers:', newPlayers);
                // サーバーに新しい状態を送信し、全クライアントを同期させる
                socket.emit('viewerUpdateMen', appState);
                // サーバーからのstateUpdateを待たずに、即時UIを更新する
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
    const addPlayerBtn = document.getElementById('addPlayerBtn');
    if (addPlayerBtn) addPlayerBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('newPlayerName');
        const classSelect = document.getElementById('newPlayerClass');
        const groupInput = document.getElementById('newPlayerGroup');

        const name = nameInput.value.trim();
        const playerClass = classSelect.value; // 選択されたクラス名をそのまま使用
        const playerGroup = groupInput.value.trim() ? `${groupInput.value.trim().normalize('NFKC')}組` : '1組';

        if (!name) {
            alert('選手名を入力してください。');
            return;
        }

        const newPlayer = {
            id: `new-${Date.now()}`, // 新規追加選手にもユニークIDを付与
            name: name,
            playerClass: playerClass,
            playerGroup: playerGroup,
            scores: { floor: 0, pommel: 0, rings: 0, vault: 0, pbars: 0, hbar: 0 },
            total: 0
        };

        appState.players.push(newPlayer);
        // サーバーに更新を通知し、UIを同期させる
        socket.emit('viewerUpdateMen', appState);

        // 入力欄をクリア
        nameInput.value = '';
        groupInput.value = '';
        alert(`${name}さんを追加しました。`);
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

    function setupTabs(tabContainerId) {
        const tabContainer = document.getElementById(tabContainerId);
        if (!tabContainer) return;
        tabContainer.addEventListener('click', (e) => {
            if (e.target.matches('button.tab-btn')) {
                const playerClass = e.target.dataset.class;
                const classId = playerClass.replace(/\s/g, '');
                tabContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                // コンテンツの表示を切り替え
                const tableWrapper = tabContainer.nextElementSibling; // totalRankTableWrapper or eventRankTableWrapper
                if (tableWrapper) {
                    tableWrapper.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                    const targetContent = document.getElementById(`${tabContainerId.includes('total') ? 'totalRankContent' : 'eventRankContent'}_${classId}`);
                    if (targetContent) targetContent.classList.add('active');
                }
            }
        });
    }

    // 編集ボタンのクリックイベントを .container に委譲
    document.querySelector('.container')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-btn')) {
            const playerId = e.target.dataset.playerId;
            const player = appState.players.find(p => p.id === playerId);
            if (player) {
                window.open(`input_men.html?class=${player.playerClass}&group=${encodeURIComponent(player.playerGroup)}`, '_blank');
            }
        } else if (e.target.classList.contains('delete-btn')) {
            const playerId = e.target.dataset.playerId;
            const player = appState.players.find(p => p.id === playerId);
            if (player) {
                if (confirm(`本当に「${player.name}」さんを削除しますか？`)) {
                    // 1. 選手リストから該当選手を削除
                    appState.players = appState.players.filter(p => p.id !== playerId);
                    // 2. サーバーに更新を通知
                    socket.emit('viewerUpdateMen', appState); // これにより他のクライアントも更新される
                    e.target.closest('tr').remove(); // 画面から行を直接削除し、UI全体再描画を避ける
                    alert(`「${player.name}」さんを削除しました。`);
                }
            }
        }
    });

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

    // アプリ説明書モーダル
    const manualBtn = document.getElementById('manualBtn');
    if (manualBtn) {
        manualBtn.onclick = () => document.getElementById('manualModal').style.display = 'block';
        document.getElementById('closeManualModal').onclick = () => document.getElementById('manualModal').style.display = 'none';
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('manualModal');
            if (event.target == modal) {
                modal.style.display = "none";
            }
        });
    }

    // 大会当日の注意点モーダル
    const operationGuideBtn = document.getElementById('operationGuideBtn');
    if (operationGuideBtn) {
        operationGuideBtn.onclick = () => document.getElementById('operationGuideModal').style.display = 'block';
        document.getElementById('closeOperationGuideModal').onclick = () => document.getElementById('operationGuideModal').style.display = 'none';
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('operationGuideModal');
            if (event.target == modal) {
                modal.style.display = "none";
            }
        });
    }

    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', () => {
        const printContainer = document.getElementById('print-container');
        printContainer.innerHTML = '';

        const classes = getSortedUniqueClasses(appState.players); // 動的なクラスリストを使用
        classes.forEach(playerClass => {
            // --- 種目別順位を先に計算 ---
            const eventRanks = {};
            EVENTS.forEach(event => { // 'floor', 'pommel', ...
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
                        <tbody>${(() => {
                                let printRank = 1;
                                return classPlayers.map((p, index) => {
                                    if (index > 0 && p.total < classPlayers[index - 1].total) {
                                        printRank = index + 1;
                                    }
                                    return `
                                <tr>
                                    <td class="rank">${printRank}</td>
                                    <td>${p.name}</td>
                                    <td>${(p.total || 0).toFixed(3)}</td>
                                    ${EVENTS.map(e => `<td>${(p.scores?.[e] || 0).toFixed(3)} (${eventRanks[e].get(p.id) || '-'})</td>`).join('')}
                                </tr>
                            `}).join('');
                            })()}
                        </tbody>
                    </table>`;                page.innerHTML = tableHTML;
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
        setTimeout(() => { if (groupSelect) groupSelect.value = targetGroup; updateInputArea(); }, 100);
    }
});
