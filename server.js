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

// GASとの通信が競合しないようにするためのロックフラグ
let isGasCommunicationLocked = false;

/**
 * GAS経由で現在のappStateをスプレッドシートに保存する
 */
async function saveStateToSheet(gender) {
    // ロックがかかっている場合は、少し待ってから再試行する
    while (isGasCommunicationLocked) {
        console.log('GAS communication is locked, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5秒待機
    }

    isGasCommunicationLocked = true; // 通信開始前にロック
    try {
    const state = appStates[gender];
    // GASに渡すためのデータ形式に変換する
    const events = gender === 'men' 
        ? ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar'] 
        : ['floor', 'vault', 'bars', 'beam'];
    const eventNames = gender === 'men'
        ? ['床', 'あん馬', 'つり輪', '跳馬', '平行棒', '鉄棒']
        : ['床', '跳馬', '段違い平行棒', '平均台'];

    // 1. ヘッダー行を定義
    const headers = ['クラス', '組', '', '名前', ...eventNames, '合計'];
    
    // 2. 選手データを「配列の配列」形式に変換
    const playersForSheet = state.players.map(p => {
        const scores = events.map(e => p.scores[e] || 0);
        const total = p.total || 0;
        return [p.playerClass, p.playerGroup, '', p.name, ...scores, total];
    });

    // 3. GASに送信するデータを作成
    const payload = {
        gender: gender,
        action: 'save',
        competitionName: state.competitionName,
        players: playersForSheet, // 変換後の選手データ（配列の配列）を渡す
        headers: headers // ヘッダー情報も渡す
    };
    const response = await axios.post(GAS_WEB_APP_URL, payload, { headers: { 'Content-Type': 'application/json' } });

        const result = response.data;
        console.log(`State for ${gender} saved to Sheet via GAS. Response:`, result?.message || 'No message received');
        return result; // 成功した結果を返す
    } catch (error) {
        console.error(`Error in saveStateToSheet for ${gender}:`, error.message);
        // エラーが発生した場合でも、他の処理が続行できるようにエラーを再スローする
        throw error;
    } finally {
        // 処理が成功しても失敗しても、必ずロックを解除する
        isGasCommunicationLocked = false;
        console.log('GAS communication lock released.');
    }
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

  // 運営者からの状態更新を受け取る (女子用)
  socket.on('viewerUpdateWomen', (newState) => {
    if (newState && typeof newState === 'object') {
        // ★★★ 抜本的修正: 受け取った更新を、男女両方の状態に適用する ★★★
        appStates.women = { ...appStates.women, ...newState };
        appStates.men = { ...appStates.men, ...newState }; // 男子データも更新
        // 全クライアントにそれぞれの新しい状態をブロードキャスト
        io.emit('stateUpdate', appStates.women);
        io.emit('stateUpdateMen', appStates.men);
        console.log('Received viewerUpdateWomen, broadcasting new state to ALL clients.');
    } else {
        console.warn('Invalid viewerUpdateWomen received:', newState);
    }
  });

  // 運営者からの状態更新を受け取る (男子用)
  socket.on('viewerUpdateMen', (newState) => {
    if (newState && typeof newState === 'object') {
        // ★★★ 抜本的修正: 受け取った更新を、男女両方の状態に適用する ★★★
        appStates.women = { ...appStates.women, ...newState }; // 女子データも更新
        appStates.men = { ...appStates.men, ...newState };
        // 全クライアントにそれぞれの新しい状態をブロードキャスト
        io.emit('stateUpdate', appStates.women);
        io.emit('stateUpdateMen', appStates.men);
        console.log('Received viewerUpdateMen, broadcasting new state to ALL clients.');
    } else {
        console.warn('Invalid viewerUpdateMen received:', newState);
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
      // ★★★ 修正点: genderに応じて正しいイベント名を指定し、io.emitで全クライアントに送信する ★★★
      const eventName = gender === 'men' ? 'stateUpdateMen' : 'stateUpdate';
      io.emit(eventName, appStates[gender]);
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

    try {
      // 1. 現在のサーバーの状態をスプレッドシートに保存する
      await saveStateToSheet(gender);

      // 2. 保存が成功したことをリクエスト元のクライアントにコールバックで通知
      if (typeof callback === 'function') callback({ success: true, message: 'スプレッドシートに保存しました' });
    } catch (error) { // saveStateToSheetからスローされたエラーをキャッチ
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
    console.log(`Server listening on port ${PORT}.`);
    console.log("サーバーはクリーンな状態で起動しました。");
    console.log("スプレッドシートからの自動データ読み込みは行われません。");
});
