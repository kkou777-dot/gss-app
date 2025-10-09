// このIDを、操作したいスプレッドシートのIDに置き換えてください。
// 例: https://docs.google.com/spreadsheets/d/1Xlt4hSx7CGgVFW_6b0zVyCTy-c26X1Ffe-oWeljGtmU/edit
const SHEET_ID = '1Xlt4hSx7CGgVFW_6b0zVyCTy-c26X1Ffe-oWeljGtmU';

/**
 * ウェブアプリへのGETリクエストを処理するエントリーポイント関数。
 * URLパラメータ `gender` に応じて、指定されたシートのデータをJSONで返す。
 * 例: /exec?gender=women
 * @param {Object} e - Apps Scriptが提供するイベントオブジェクト
 * @returns {ContentService.TextOutput} - JSON形式のレスポンス
 */
function doGet(e) {
  try {
    const gender = e.parameter.gender || 'women';
    if (gender !== 'women' && gender !== 'men') {
      throw new Error("Invalid 'gender' parameter. Must be 'women' or 'men'.");
    }

    const data = loadDataFromSheet(gender);
    const response = { success: true, data: data };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error(error.stack);
    const response = { success: false, message: error.message };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(500);
  }
}

/**
 * ウェブアプリへのPOSTリクエストを処理するエントリーポイント関数。
 * リクエストボディのJSONデータを使ってスプレッドシートを更新する。
 * @param {Object} e - Apps Scriptが提供するイベントオブジェクト
 * @returns {ContentService.TextOutput} - JSON形式のレスポンス
 */
function doPost(e) {
  try {
    // リクエストボディのJSONデータをパース
    const requestBody = JSON.parse(e.postData.contents);
    const { gender, newState } = requestBody;

    // 受け取ったデータを文字列としてログに記録する（デバッグ用）
    console.log(`Received data for ${gender}: ${JSON.stringify(newState)}`);

    // 必須パラメータのチェック
    if (!gender || !newState || !newState.players || !newState.hasOwnProperty('competitionName')) {
      throw new Error('Invalid request body. "gender" and "newState" (with "competitionName" and "players") are required.');
    }

    // スプレッドシートにデータを保存
    saveDataToSheet(gender, newState);

    // 成功メッセージを返す
    const response = { success: true, message: 'State saved successfully.' };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error(error.stack);
    const response = { success: false, message: error.message };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
      .setStatusCode(500);
  }
}


// --- スプレッドシート操作のヘルパー関数 ---


/**
 * 指定された性別（シート）の大会名と選手データをスプレッドシートから読み込む。
 * @param {string} gender - 'women' または 'men'
 * @returns {Object} - { competitionName: string, players: Object[] } 形式のオブジェクト
 */
function loadDataFromSheet(gender) {
  const doc = SpreadsheetApp.openById(SHEET_ID);
  const state = {};

  // 1. 大会名の読み込み (configシートから)
  const configSheet = doc.getSheetByName('config');
  if (!configSheet) throw new Error("Sheet 'config' not found.");

  const competitionNameKey = gender === 'men' ? 'competitionNameMen' : 'competitionName';
  const configData = configSheet.getDataRange().getValues();
  const nameRow = configData.find(row => row[0] === competitionNameKey);
  state.competitionName = nameRow ? nameRow[1] : '';

  // 2. 選手データの読み込み
  const sheetName = gender === 'men' ? 'players_men' : 'players';
  const playersSheet = doc.getSheetByName(sheetName);
  if (!playersSheet) {
    state.players = [];
    return state;
  }

  const playerRows = playersSheet.getDataRange().getValues();
  if (playerRows.length < 1) {
    state.players = [];
    return state;
  }

  const headers = playerRows.shift();
  const events = gender === 'men'
    ? ['floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar']
    : ['floor', 'vault', 'bars', 'beam'];
  const numericHeaders = ['total', ...events];

  state.players = playerRows.map((row) => {
    const playerData = {};
    headers.forEach((header, i) => {
      if (!header) return;
      const value = row[i];
      if (numericHeaders.includes(header)) {
        playerData[header] = parseFloat(value) || 0;
      } else {
        playerData[header] = value !== null && value !== undefined ? String(value) : '';
      }
    });
    return playerData;
  });

  console.log(`Successfully loaded ${state.players.length} players for ${gender}.`);
  return state;
}

/**
 * 指定された性別（シート）に、指定された状態（大会名と選手データ）を保存する。
 * @param {string} gender - 'women' または 'men'
 * @param {Object} state - { competitionName: string, players: Object[] } 形式のオブジェクト
 */
function saveDataToSheet(gender, state) {
  // 同時書き込みによるエラーを防ぐため、ロックを取得する
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // 最大15秒待機

    const doc = SpreadsheetApp.openById(SHEET_ID);

    // --- 1. 大会名の保存 ---
    try {
      const configSheet = doc.getSheetByName('config');
      if (!configSheet) throw new Error("Sheet 'config' not found.");
      const competitionNameKey = gender === 'men' ? 'competitionNameMen' : 'competitionName';
      const configData = configSheet.getDataRange().getValues();
      const nameRowIndex = configData.findIndex(row => row[0] === competitionNameKey);

      if (nameRowIndex > -1) {
        configSheet.getRange(nameRowIndex + 1, 2).setValue(state.competitionName);
      } else {
        configSheet.appendRow([competitionNameKey, state.competitionName]);
      }
    } catch (e) {
      throw new Error(`Error saving competition name: ${e.message}`);
    }

    // --- 2. 選手データの保存 ---
    try {
      const sheetName = gender === 'men' ? 'players_men' : 'players';
      const playersSheet = doc.getSheetByName(sheetName);
      if (!playersSheet) throw new Error(`Sheet '${sheetName}' not found.`);

      const headers = gender === 'men'
        ? ['name', 'playerClass', 'playerGroup', 'floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar', 'total']
        : ['name', 'playerClass', 'playerGroup', 'floor', 'vault', 'bars', 'beam', 'total'];

      // ヘッダー行(1行目)は残し、データ部分(2行目以降)のみをクリアする
      if (playersSheet.getLastRow() > 1) {
        playersSheet.getRange(2, 1, playersSheet.getLastRow() - 1, playersSheet.getMaxColumns()).clearContent();
      }
      // ヘッダーを再設定して、列の順序を保証する
      playersSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

      if (state.players && state.players.length > 0) {
        const playersToSave = state.players.map(p => headers.map(h => p[h] !== undefined ? p[h] : ''));
        if (playersToSave.length > 0) {
          playersSheet.getRange(2, 1, playersToSave.length, headers.length).setValues(playersToSave);
        }
      }
    } catch (e) {
      throw new Error(`Error saving player data: ${e.message}`);
    }

    console.log(`Successfully saved ${state.players.length} players for ${gender}.`);
  } finally {
    lock.releaseLock();
  }
}