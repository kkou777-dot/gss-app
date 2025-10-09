const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Google Apps Script ウェブアプリ設定 ---
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
if (!GAS_WEB_APP_URL) {
    console.error('\n\n\x1b[31m[設定エラー]\x1b[0m 環境変数 `GAS_WEB_APP_URL` が設定されていません。Google Apps ScriptでデプロイしたウェブアプリのURLを設定してください。\n\n');
    process.exit(1); // エラーでプログラムを終了
}

// アプリケーションの状態を男女別にサーバー側で保持
const appStates = {
    women: {
        competitionName: '',
        players: [],
    },
    men: {
        competitionName: '',
        players: [],
    }
};

/**
 * GAS経由でスプレッドシートから最新の状態を読み込み、appStatesを更新する
 */
async function loadStateFromSheet(gender = 'women', maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 2回目以降のリトライの場合、少し待機する (1秒, 2秒, 4秒...)
            if (attempt > 1) {
                const delay = Math.pow(2, attempt - 2) * 1000;
                console.log(`[Attempt ${attempt}/${maxRetries}] Retrying to load ${gender} data via GAS in ${delay / 1000}s...`);
                await new Promise(res => setTimeout(res, delay));
            }

            const response = await axios.get(`${GAS_WEB_APP_URL}?gender=${gender}`, {
                timeout: 15000 // 15秒でタイムアウト
            });
            const result = response.data; // axiosは自動でJSONをパースし、.dataに格納します
            if (!result.success) {
                throw new Error(`GAS returned an error: ${result.message}`);
            }

            appStates[gender] = result.data;
            console.log(`Loaded ${result.data.players.length} ${gender} players and competition name via GAS.`);
            return; // 成功したので関数を抜ける
        } catch (error) {
            // axiosのエラーはより詳細な情報を持つため、それを活用します
            const errorMessage = error.response ? `status ${error.response.status}` : error.message;
            console.error(`[Attempt ${attempt}/${maxRetries}] Error loading state via GAS for ${gender}:`, errorMessage);
            if (attempt === maxRetries) {
                console.error(`Failed to load ${gender} data via GAS after ${maxRetries} attempts.`);
                throw error; // 最終的に失敗した場合はエラーをスローする
            }
        }
    }
}

/**
 * GAS経由で現在のappStateをスプレッドシートに保存する
 */
async function saveStateToSheet(gender) {
    const state = appStates[gender];
    // axios.postの第2引数にオブジェクトを渡すだけで、自動的にJSONに変換して送信します
    const response = await axios.post(GAS_WEB_APP_URL, { gender, newState: state });

    const result = response.data;
    // axiosはステータスコードが2xxでない場合、自動的にエラーをスローするため、
    // ここに到達した時点でHTTP通信は成功している。
    // GAS内部での処理失敗(success: false)も、GAS側で500エラーを返す設計なので、ここでは考慮不要。
    console.log(`State for ${gender} saved to Sheet via GAS.`);
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
    socket.emit('stateUpdate', appStates.women);
  });
  // 男子用データの要求
  socket.on('requestInitialDataMen', () => {
    socket.emit('stateUpdateMen', appStates.men);
  });

  // 運営者からの状態更新を受け取る (閲覧者向け)
  socket.on('viewerUpdate', (newState) => {
    if (newState && typeof newState === 'object') {
        appStates.women = newState;
        // 全員に新しい状態をブロードキャスト
        io.emit('stateUpdate', appStates.women);
    }
  });

  // 運営者からの手動保存要求を受け取る (男女共通)
  socket.on('saveData', async ({ gender, newState }, callback) => {
    console.log(`クライアントからsaveDataリクエストを受信 (gender: ${gender})`);
    if (!newState || typeof newState !== 'object' || !['women', 'men'].includes(gender)) {
        if (typeof callback === 'function') callback({ success: false, message: '無効なデータです。' });
        return;
    }

    // サーバー側の状態を更新
    appStates[gender] = newState;

    try {
        // ★★★ 最終診断：GASに送信するデータを一時的に固定のダミーデータに置き換える ★★★
        const dummyState = {
            competitionName: "診断テスト",
            players: [{ name: "テスト選手1", playerClass: "A", playerGroup: "1", floor: 1.0, vault: 1.0, bars: 1.0, beam: 1.0, total: 4.0 }]
        };
        await axios.post(GAS_WEB_APP_URL, { gender, newState: dummyState });

        const eventName = gender === 'men' ? 'stateUpdateMen' : 'stateUpdate';
        io.emit(eventName, appStates[gender]); // 対応するクライアントに最新情報を送信
        if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) {
        let detailedErrorMessage;
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // GASサーバーがエラーレスポンスを返した場合 (例: 500 Internal Server Error)
                const gasError = error.response.data?.error || JSON.stringify(error.response.data);
                detailedErrorMessage = `GAS Error (Status: ${error.response.status}): ${gasError}`;
            } else if (error.request) {
                // リクエストは送信されたが、レスポンスがなかった場合
                detailedErrorMessage = `No response from GAS. Request failed.`;
            }
        } else {
            // axios以外の予期せぬエラー
            detailedErrorMessage = error.message;
        }

        console.error(`GAS経由での${gender}データ保存中にエラーが発生しました:`, detailedErrorMessage);
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
Promise.all([
    loadStateFromSheet('women'),
    loadStateFromSheet('men')
]).catch(err => {
    console.error("\n\n[警告] サーバー起動時のデータ読み込みに失敗しました。空の状態で起動します。");
    console.error(err.message);
    console.error("\n");
});
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
