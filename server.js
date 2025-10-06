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
    // Render環境 (本番環境) では環境変数から認証情報を取得します
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_PRIVATE_KEY_ID) {
            throw new Error('本番環境用の環境変数（GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_PRIVATE_KEY_ID）が設定されていません。');
        }
        serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            // Renderの環境変数では改行が `\\n` になってしまうため、本物の改行 `\n` に戻す
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            keyId: process.env.GOOGLE_PRIVATE_KEY_ID,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            // Node.js v18以降でOpenSSL3.0がデフォルトになったことによる互換性問題への対応
            additionalClaims: { alg: 'RS256' }
        });
    } else {
        // ローカル環境では credentials.json.json から読み込みます
        const creds = require('./credentials.json.json');
        serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            keyId: creds.private_key_id,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            // Node.js v18以降でOpenSSL3.0がデフォルトになったことによる互換性問題への対応
            additionalClaims: { alg: 'RS256' }
        });
    }

    if (!SHEET_ID || SHEET_ID === 'ここにあなたのスプレッドシートIDを貼り付けてください') {
        throw new Error('スプレッドシートIDが設定されていません。server.jsのSHEET_IDをあなたのIDに書き換えてください。');
    }

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
    if (!doc.title) {
        console.log('Sheet not loaded, skipping save.');
        return; // シートが読み込まれていない場合は何もしない
    }
    try {
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
            const rows = await playersSheet.getRows();
            const newPlayers = appState.players;

            // 既存の行を更新、または新しい行を追加
            for (let i = 0; i < newPlayers.length; i++) {
                if (i < rows.length) {
                    // 既存の行を更新
                    rows[i].assign(newPlayers[i]);
                    await rows[i].save({ raw: true });
                } else {
                    // 新しい行を追加
                    await playersSheet.addRow(newPlayers[i], { raw: true });
                }
            }

            // 新しいデータの方が少ない場合、古い余分な行を削除
            if (newPlayers.length < rows.length) {
                for (let i = newPlayers.length; i < rows.length; i++) {
                    await rows[i].delete();
                }
            }
        }
        console.log('State saved to Google Sheet.');
    } catch (error) {
        console.error('Error saving state to Google Sheet:', error);
    }
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
  socket.on('saveData', async (newState) => {
    console.log('Received manual save request. Saving to sheet...');
    if (newState && typeof newState === 'object') {
        appState.competitionName = newState.competitionName;
        appState.players = newState.players;
        await saveStateToSheet();
        socket.emit('saveSuccess', 'データが正常に保存されました。');
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Renderのようなホスティング環境が指定するポート番号を使用し、なければローカル用に3000番を使う
const PORT = process.env.PORT || 3000;

// サーバーを起動する前に、スプレッドシートから状態を読み込む
loadStateFromSheet().then(() => {
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
});
