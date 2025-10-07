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

// --- Google Sheets 連携関数 ---

/**
 * スプレッドシートから最新の状態を読み込み、appStateを更新する
 */
async function loadStateFromSheet() {
    try {
        await doc.loadInfo(); // スプレッドシートの情報を読み込み
        console.log(`Loaded Google Sheet: ${doc.title}`);

        // 大会名の読み込み (configシートから)
        let configSheet = doc.sheetsByTitle['config'];
        if (!configSheet) {
            console.log('Creating "config" sheet...');
            configSheet = await doc.addSheet({ title: 'config', headerValues: ['key', 'value'] });
        } else {
            const configRows = await configSheet.getRows();
            const competitionNameRow = configRows.find(row => row.get('key') === 'competitionName');
            appState.competitionName = competitionNameRow ? competitionNameRow.get('value') : '';
        }

        // 選手データの読み込み (playersシートから)
        let playersSheet = doc.sheetsByTitle['players'];
        if (!playersSheet) {
            console.log('Creating "players" sheet...');
            playersSheet = await doc.addSheet({ title: 'players', headerValues: ['name', 'playerClass', 'playerGroup', 'floor', 'vault', 'bars', 'beam', 'total'] });
        }
        const playerRows = await playersSheet.getRows();
        appState.players = playerRows.map(row => ({
            name: row.get('name') || '',
            playerClass: row.get('playerClass') || '',
            playerGroup: row.get('playerGroup') || '',
            floor: parseFloat(row.get('floor')) || 0,
            vault: parseFloat(row.get('vault')) || 0,
            bars: parseFloat(row.get('bars')) || 0,
            beam: parseFloat(row.get('beam')) || 0,
            total: parseFloat(row.get('total')) || 0,
        }));
        console.log(`Loaded ${appState.players.length} players and competition name from sheet.`);
    } catch (error) {
        console.error('Error loading state from Google Sheet:', error);
    }
}

/**
 * 現在のappStateをスプレッドシートに保存する
 */
async function saveStateToSheet() {
    // この関数は呼び出し元でエラーを捕捉できるように、try-catchを外してエラーをスローするように変更します。
    if (!doc.title) {
        console.log('Sheet not loaded, skipping save.');
        return; // シートが読み込まれていない場合は何もしない
    }

    const configSheet = doc.sheetsByTitle['config'];
    if (configSheet) {
        const configRows = await configSheet.getRows();
        let competitionNameRow = configRows.find(row => row.get('key') === 'competitionName');
        if (competitionNameRow) {
            competitionNameRow.set('value', appState.competitionName);
            await competitionNameRow.save();
        } else {
            await configSheet.addRow({ key: 'competitionName', value: appState.competitionName });
        }
    }

    const playersSheet = doc.sheetsByTitle['players'];
    if (playersSheet) {
        // 既存の行をすべてクリア（ヘッダーは残る）
        await playersSheet.clearRows();
        // 最新の選手データを一括で追加
        if (appState.players && appState.players.length > 0) {
            await playersSheet.addRows(appState.players, { raw: true });
        }
    }
    console.log('State saved to Google Sheet.');
}

// 静的ファイルを提供 (html, js, cssなど)
app.use(express.static(path.join(__dirname)));

// 運営者ページ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 保護者用ページ
app.get('/viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer.html'));
});

io.on('connection', async (socket) => {
  console.log('a user connected');

  // クライアントからの初期データ要求に応じて、現在の状態を送信する
  socket.on('requestInitialData', () => {
    socket.emit('stateUpdate', appState);
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
        await saveStateToSheet(); // スプレッドシートへの保存を試みる
        io.emit('stateUpdate', appState); // 保存成功後、全クライアントに最新情報を送信
        console.log('保存成功。全クライアントにstateUpdateを送信しました。');
        if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) {
        console.error('スプレッドシートへの保存中にエラーが発生しました:', error);
        // 保存に失敗したことをリクエスト元のクライアントに通知
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
loadStateFromSheet().catch(err => {
    console.error("サーバー起動時のシート読み込みに失敗しました。空の状態で起動を継続します。", err);
}).finally(() => {
  server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
  });
});
