const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Google Sheets 設定 ---
const SHEET_ID = process.env.SHEET_ID || '1Xlt4hSx7CGgVFW_6b0zVyCTy-c26X1Ffe-oWeljGtmU';

let serviceAccountAuth;
try {
    let creds;
    // RENDER 環境変数が 'true' なら本番環境と判断
    if (process.env.RENDER === 'true') {
        creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else {
        // なければローカルの ./credentials.json.json を参照
        creds = require('./credentials.json.json');
    }

    // 取得した認証情報を使ってJWTを初期化
    serviceAccountAuth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('\n\n\x1b[31m[設定エラー]\x1b[0m `credentials.json.json` が見つかりません。ローカル環境で実行する場合は、Google Cloudからダウンロードした認証情報ファイルの名前を `credentials.json.json` に変更して、`server.js` と同じフォルダに配置してください。\n\n');
    } else {
        console.error('\n\n\x1b[31m[設定エラー]\x1b[0m ' + error.message);
    }
    process.exit(1); // エラーでプログラムを終了
}
const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);

// アプリケーションの状態をサーバー側で保持
let appState = {
    competitionName: '',
    players: [],
};
// 男子用の状態もサーバー側で保持
let appStateMen = {
    competitionName: '',
    players: [],
};

// --- Google Sheets 連携関数 ---

/**
 * スプレッドシートから最新の状態を読み込み、appStateを更新する
 */
async function loadStateFromSheet(gender = 'women') {
    try {
        await doc.loadInfo(); // スプレッドシートの情報を読み込み
        console.log(`Loaded Google Sheet: ${doc.title}`);

        // 大会名の読み込み (configシートから)
        let configSheet = doc.sheetsByTitle['config'];
        if (!configSheet) {
            configSheet = await doc.addSheet({ title: 'config', headerValues: ['key', 'value'] });
        }
        const configRows = await configSheet.getRows();
        const competitionNameRow = configRows.find(row => row.get('key') === (gender === 'men' ? 'competitionNameMen' : 'competitionName'));
        const competitionName = competitionNameRow ? competitionNameRow.get('value') : '';

        // 選手データの読み込み (playersシートから)
        const sheetName = gender === 'men' ? 'players_men' : 'players';
        let playersSheet = doc.sheetsByTitle[sheetName];
        if (!playersSheet) {
            const headers = gender === 'men'
                ? ['name', 'playerClass', 'playerGroup', 'floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar', 'total']
                : ['name', 'playerClass', 'playerGroup', 'floor', 'vault', 'bars', 'beam', 'total'];
            playersSheet = await doc.addSheet({ title: sheetName, headerValues: headers });
        }
        const playerRows = await playersSheet.getRows();
        const players = playerRows.map(row => {
            const playerData = {
                name: row.get('name') || '',
                playerClass: row.get('playerClass') || '',
                playerGroup: row.get('playerGroup') || '',
                total: parseFloat(row.get('total')) || 0,
            };
            const events = gender === 'men' ? ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'] : ['floor', 'vault', 'bars', 'beam'];
            events.forEach(event => {
                playerData[event] = parseFloat(row.get(event)) || 0;
            });
            return playerData;
        });

        if (gender === 'men') {
            appStateMen.competitionName = competitionName;
            appStateMen.players = players;
            console.log(`Loaded ${appStateMen.players.length} men players and competition name from sheet.`);
        } else {
            appState.competitionName = competitionName;
            appState.players = players;
            console.log(`Loaded ${appState.players.length} women players and competition name from sheet.`);
        }
    } catch (error) {
        console.error('Error loading state from Google Sheet:', error);
    }
}

/**
 * 現在のappStateをスプレッドシートに保存する
 */
async function saveStateToSheet(gender = 'women') {
    // この関数は呼び出し元でエラーを捕捉できるように、try-catchを外してエラーをスローするように変更します。
    if (!doc.title) {
        console.log('Sheet not loaded, skipping save.');
        return; // シートが読み込まれていない場合は何もしない
    }

    const state = gender === 'men' ? appStateMen : appState;
    const sheetName = gender === 'men' ? 'players_men' : 'players';
    const competitionNameKey = gender === 'men' ? 'competitionNameMen' : 'competitionName';

    const configSheet = doc.sheetsByTitle['config'];
    if (configSheet) {
        const configRows = await configSheet.getRows();
        let competitionNameRow = configRows.find(row => row.get('key') === competitionNameKey);
        if (competitionNameRow) {
            competitionNameRow.set('value', state.competitionName);
            await competitionNameRow.save();
        } else {
            await configSheet.addRow({ key: competitionNameKey, value: state.competitionName });
        }
    }

    const playersSheet = doc.sheetsByTitle[sheetName];
    if (playersSheet) {
        // 既存の行をすべてクリア（ヘッダーは残る）
        await playersSheet.clearRows();
        // 最新の選手データを一括で追加
        if (state.players && state.players.length > 0) {
            // ヘッダーにないプロパティを削除してから保存
            const playersToSave = state.players.map(({ originalIndex, ...rest }) => rest);
            await playersSheet.addRows(playersToSave, { raw: true });
        }
    }
    console.log('State saved to Google Sheet.');
}

// 静的ファイルを提供 (html, js, cssなど)
app.use(express.static(path.join(__dirname)));

// 保護者用ページへのルーティングを追加
app.get('/viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer.html'));
});

app.get('/viewer_men', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer_men.html'));
});

// (オプション) /men でも男子ページにアクセスできるようにする
app.get('/men', (req, res) => {
  res.sendFile(path.join(__dirname, 'index_men.html'));
});

io.on('connection', async (socket) => {
  console.log('a user connected');

  // クライアントからの初期データ要求に応じて、現在の状態を送信する
  socket.on('requestInitialData', () => {
    socket.emit('stateUpdate', appState);
  });
  // 男子用データの要求
  socket.on('requestInitialDataMen', () => {
    socket.emit('stateUpdateMen', appStateMen);
  });

  // 運営者からの状態更新を受け取る (閲覧者向け)
  socket.on('viewerUpdate', (newState) => {
    // サーバー側の状態を更新 (より安全な方法)
    // 新しい状態を直接代入するのではなく、プロパティごとに更新する
    if (newState && typeof newState === 'object') {
        appState.competitionName = newState.competitionName;
        appState.players = newState.players;
        // 全員に新しい状態をブロードキャスト
        io.emit('stateUpdate', appState);
    }
  });

  // 運営者からの手動保存要求を受け取る
  socket.on('saveData', async (newState, callback) => {
    console.log('クライアントからsaveDataリクエストを受信');
    if (!newState || typeof newState !== 'object') {
        if (typeof callback === 'function') callback({ success: false, message: '無効なデータです。' });
        return;
    }

    // サーバー側の状態を更新
    appState.competitionName = newState.competitionName;
    appState.players = newState.players;

    try {
        await saveStateToSheet('women'); // スプレッドシートへの保存を試みる
        io.emit('stateUpdate', appState); // 保存成功後、全クライアントに最新情報を送信
        console.log('保存成功。全クライアントにstateUpdateを送信しました。');
        if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) {
        console.error('スプレッドシートへの保存中にエラーが発生しました:', error);
        // 保存に失敗したことをリクエスト元のクライアントに通知
        if (typeof callback === 'function') callback({ success: false, message: 'エラー: 保存に失敗しました。' });
    }
  });

  // 男子用の手動保存要求を受け取る
  socket.on('saveDataMen', async (newState, callback) => {
    console.log('クライアントからsaveDataMenリクエストを受信');
    if (!newState || typeof newState !== 'object') {
        if (typeof callback === 'function') callback({ success: false, message: '無効なデータです。' });
        return;
    }
    appStateMen.competitionName = newState.competitionName;
    appStateMen.players = newState.players;
    try {
        await saveStateToSheet('men'); // 男子用として保存
        io.emit('stateUpdateMen', appStateMen); // 男子クライアントに最新情報を送信
        console.log('男子データの保存成功。全クライアントにstateUpdateMenを送信しました。');
        if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) {
        console.error('男子データの保存中にエラーが発生しました:', error);
        if (typeof callback === 'function') callback({ success: false, message: 'エラー: 保存に失敗しました。' });
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Renderのようなホスティング環境が指定するポート番号を使用し、なければローカル用に3000番を使う
const PORT = process.env.PORT || 3000;

// サーバーを起動する前に、スプレッドシートから状態を読み込む
Promise.all([
    loadStateFromSheet('women'),
    loadStateFromSheet('men')
]).catch(err => {
    console.error("サーバー起動時のシート読み込みに失敗しました。", err);
}).finally(() => {
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
});
