// .envファイルから環境変数を読み込む
// server.jsと同じ階層にある .env ファイルを探します
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// favicon.icoのリクエストに対して204 No Contentを返し、404エラーを防ぐ
app.get('/favicon.ico', (req, res) => res.status(204).send());

// --- Google Apps Script ウェブアプリ設定 ---
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
if (!GAS_WEB_APP_URL) {
    console.error('\n\n\x1b[31m[設定エラー]\x1b[0m 環境変数 `GAS_WEB_APP_URL` が設定されていません。Google Apps ScriptでデプロイしたウェブアプリのURLを設定してください。\n\n');
    // process.exit(1); // デプロイを安定させるため、エラーでも終了しないように変更
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

            // GASから返されるデータが期待する形式か確認する
            // GASからのデータ形式をより柔軟に解釈する
            if (result.data && Array.isArray(result.data.players)) {
                const players = result.data.players.map((p, index) => {
                    // 各選手データに不足しているプロパティがあれば、デフォルト値を補う
                    const scores = p.scores || {};
                    let total = 0;
                    // GASからtotalが送られてこない場合も考慮して再計算
                    if (p.total !== undefined) {
                        total = p.total;
                    } else {
                        total = Object.values(scores).reduce((sum, score) => sum + (parseFloat(score) || 0), 0);
                    }
                    
                    // IDが毎回変わらないように、シートの行の順序に基づいて安定したIDを付与
                    return {
                        id: `${gender}-${index}`,
                        name: p.name || '名無し',
                        playerClass: p.playerClass || '初級',
                        playerGroup: p.playerGroup || '1組',
                        scores: scores,
                        total: total,
                    };
                });
                appStates[gender] = {
                    competitionName: result.data.competitionName || '',
                    players: players
                };
            } else {
                throw new Error(`Received invalid data structure from GAS for ${gender}.`);
            }            console.log(`Loaded ${appStates[gender].players.length} ${gender} players and competition name via GAS.`);
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
    // GASに渡すためのデータ形式に変換する
    const events = gender === 'men' 
        ? ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'] 
        : ['floor', 'vault', 'bars', 'beam'];
    
    const playersForSheet = state.players.map(p => {
        const scores = events.map(e => p.scores[e] || 0);
        // 合計点はGAS側で再計算されるため、送信データからは除外する
        // CSVテンプレートの形式 [クラス, 組, (空), 名前, ...各種目得点] の順序で配列を作成
        return [p.playerClass, p.playerGroup, '', p.name, ...scores];
    });

    const dataForGas = {
        competitionName: state.competitionName,
        players: playersForSheet
    };
    // axios.postの第2引数にオブジェクトを渡すだけで、自動的にJSONに変換して送信します
    // GAS側は e.postData.contents を JSON.parse して { gender, action, newState: { competitionName, players } } という構造を期待している
    const payload = {
        gender: gender,
        action: 'save',
        newState: dataForGas
    };
    const response = await axios.post(GAS_WEB_APP_URL, payload);

    const result = response.data;
    // axiosはステータスコードが2xxでない場合、自動的にエラーをスローするため、
    // ここに到達した時点でHTTP通信は成功している。
    // GAS内部での処理失敗(success: false)も、GAS側で500エラーを返す設計なので、ここでは考慮不要。
    console.log(`State for ${gender} saved to Sheet via GAS.`);
}

async function archiveSheetOnGAS(gender) {
    // GASからのレスポンスを待って返すように変更
    const response = await axios.post(GAS_WEB_APP_URL, { gender, action: 'archive' });
    console.log(`Archive request for ${gender} sent to GAS.`);
    // GASからのレスポンスデータを返す
    return response.data;
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

// 点数入力ページへのルーティングを追加
app.get('/input', (req, res) => {
  res.sendFile(path.join(__dirname, 'input.html'));
});

app.get('/input_men', (req, res) => {
  res.sendFile(path.join(__dirname, 'input_men.html'));
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
  socket.on('viewerUpdate', ({ gender, newState }) => {
    if (newState && typeof newState === 'object' && ['women', 'men'].includes(gender)) {
        // サーバー側の状態を、現在の状態と新しい状態をマージして更新する
        appStates[gender] = { ...appStates[gender], ...newState };

        // 対応するイベント名で、全員に新しい状態をブロードキャスト
        const eventName = gender === 'men' ? 'stateUpdateMen' : 'stateUpdate';
        io.emit(eventName, appStates[gender]);
    } else {
        console.warn('Invalid viewerUpdate received:', { gender, newState });
    }
  });

  // 新しいイベント: 選手一人の点数更新を受け取る
  socket.on('updatePlayerScore', ({ gender, playerId, scoreType, value }) => {
    if (!['women', 'men'].includes(gender) || !playerId || !scoreType) {
      console.warn('Invalid updatePlayerScore event received:', { gender, playerId, scoreType, value });
      return;
    }

    const targetPlayer = appStates[gender]?.players.find(p => p.id === playerId);

    if (targetPlayer) {
      // 該当選手のスコアをピンポイントで更新
      // scoresオブジェクトがなければ初期化
      if (!targetPlayer.scores) {
        targetPlayer.scores = {};
      }
      // 文字列で送られてくる値を数値に変換
      targetPlayer.scores[scoreType] = parseFloat(value) || 0;
      console.log(`Updated score for player ${playerId}: ${scoreType} = ${targetPlayer.scores[scoreType]}`);

      // ★★★ サーバー側で合計点を再計算 ★★★
      const events = gender === 'men' 
          ? ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'] 
          : ['floor', 'vault', 'bars', 'beam'];
      
      let newTotal = 0;
      for (const event of events) {
          newTotal += targetPlayer.scores[event] || 0;
      }
      targetPlayer.total = newTotal;

      // 更新後の状態を、入力者以外の全クライアントにブロードキャスト
      const eventName = gender === 'men' ? 'stateUpdateMen' : 'stateUpdate';
      // socket.broadcast.emit を使うことで、イベントを発生させた本人を除く全員に送信する
      socket.broadcast.emit(eventName, appStates[gender]);
    } else {
      console.warn(`Player with id ${playerId} not found for gender ${gender}.`);
    }
  });

  // 運営者からの手動保存要求を受け取る (男女共通)
  // このイベントは、主にスプレッドシートへの保存トリガーとして利用する
  socket.on('saveData', async ({ gender }, callback) => {
    console.log(`クライアントからsaveDataリクエストを受信 (gender: ${gender})`);
    if (!['women', 'men'].includes(gender)) {
      if (typeof callback === 'function') callback({ success: false, message: '無効な性別です。' });
      return;
    }

    // UIの即時反映は'updatePlayerScore'で行うため、ここではブロードキャストは不要

    const eventName = gender === 'men' ? 'stateUpdateMen' : 'stateUpdate';

    try {
      // 1. 現在のサーバーの状態をスプレッドシートに保存する
      await saveStateToSheet(gender);

      // 2. 保存が成功したことをリクエスト元のクライアントにコールバックで通知
      if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) {
      // エラー処理は変更なし
      // ... (既存のエラー処理コード)
      console.error(`GAS経由での${gender}データ保存中にエラーが発生しました:`, error.message);
      if (typeof callback === 'function') callback({ success: false, message: 'エラー: 保存に失敗しました。' });
    }
  });

  // 大会終了リクエスト
  socket.on('finalizeCompetition', async ({ gender }, callback) => {
      try {
          const result = await archiveSheetOnGAS(gender);
          console.log(`Competition for ${gender} finalized successfully.`);
          if (typeof callback === 'function') {
              // GASからの成功メッセージをクライアントに返す
              callback({ success: true, message: result.message || '大会データが正常にアーカイブされました。' });
          }
      } catch (error) {
          console.error(`Error finalizing competition for ${gender}:`, error.message);
          if (typeof callback === 'function') {
              callback({ success: false, message: 'エラー: アーカイブに失敗しました。' });
          }
      }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Renderのようなホスティング環境が指定するポート番号を使用し、なければローカル用に3000番を使う
const PORT = process.env.PORT || 3000;

// 1. 最初にサーバーを起動させる
server.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    
    // 2. サーバー起動後に、バックグラウンドで初期データを読み込む
    // デプロイを安定させるため、少し待ってから実行する
    console.log("サーバーが起動しました。3秒後に初期データの読み込みを開始します...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 起動時のデータ読み込みを一つずつ実行する
    // API制限を避けるため、間にウェイトを入れる
    console.log("初期データの読み込みを開始します...");
    await loadStateFromSheet('women').catch(err => {
        console.error("\n\n[警告] 女子データの初期読み込みに失敗しました。", err.message, "\n");
    });
    // API制限を避けるため、1秒待機
    await new Promise(resolve => setTimeout(resolve, 1000));
    await loadStateFromSheet('men').catch(err => {
        console.error("\n\n[警告] 男子データの初期読み込みに失敗しました。", err.message, "\n");
    });
    console.log("初期データの読み込み処理が完了しました。");
});
