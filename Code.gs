// このIDを、操作したいスプレッドシートのIDに置き換えてください。
// 例: https://docs.google.com/spreadsheets/d/1Xlt4hSx7CGgVFW_6b0zVyCTy-c26X1Ffe-oWeljGtmU/edit

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
  // --- 最終診断コード ---
  // このコードは、問題の原因を特定するため、受け取った情報を直接シートに書き込みます。
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const debugSheet = doc.getSheetByName('debug_log') || doc.insertSheet('debug_log');
  const timestamp = new Date();

  try {
    debugSheet.appendRow([timestamp, 'doPost started.']);

    const requestBody = JSON.parse(e.postData.contents);
    const { gender, newState } = requestBody;

    const logMessage = `Received: gender=${gender}, players=${newState && newState.players ? newState.players.length : 'N/A'}`;
    debugSheet.appendRow([timestamp, 'Data parsed.', logMessage]);

    // 本来の保存処理を呼び出す
    // saveDataToSheet(gender, newState);

    const response = { success: true, message: 'State saved successfully.' };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    debugSheet.appendRow([timestamp, 'ERROR', error.stack ? error.stack : error.toString()]);
    const response = { success: false, message: "GAS Error", error: error.stack ? error.stack : error.toString() };
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
  // スクリプトが紐づいているアクティブなスプレッドシートを取得
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const state = {};

  // 1. 大会名の読み込み (configシートから)
  const configSheet = doc.getSheetByName('config');
  if (!configSheet) throw new Error("Sheet 'config' not found.");

  const competitionNameKey = gender === 'men' ? 'competitionNameMen' : 'competitionName';
  let nameRow = null;
  // シートが空でないことを確認してから値を取得
  if (configSheet.getLastRow() > 0) {
    const configData = configSheet.getDataRange().getValues();
    // findの前に、配列が空でないことを確認する
    if (configData && configData.length > 0) {
      nameRow = configData.find(row => row && row[0] === competitionNameKey);
    }
  }
  state.competitionName = nameRow ? nameRow[1] : '';

  // 2. 選手データの読み込み
  const sheetName = gender === 'men' ? 'players_men' : 'players';
  const playersSheet = doc.getSheetByName(sheetName);
  if (!playersSheet) {
    state.players = [];
    return state;
  }

  const playerRows = playersSheet.getDataRange().getValues();
  if (!playerRows || playerRows.length < 1) {
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
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);

        const doc = SpreadsheetApp.getActiveSpreadsheet();

        // 1. 大会名の保存
        saveCompetitionName(doc, gender, state.competitionName);

        // 2. 選手データの保存
        const headers = gender === 'men'
            ? ['name', 'playerClass', 'playerGroup', 'floor', 'pommel', 'rings', 'vault', 'pbars', 'hbar', 'total']
            : ['name', 'playerClass', 'playerGroup', 'floor', 'vault', 'bars', 'beam', 'total'];
        const sheetName = gender === 'men' ? 'players_men' : 'players';
        const playersSheet = doc.getSheetByName(sheetName) || doc.insertSheet(sheetName);

        // シートにデータがなければ、ヘッダーを書き込む
        if (playersSheet.getLastRow() < 1) {
            playersSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }

        // 書き込むデータを準備 (ヘッダー + 選手データ)
        const dataToWrite = [headers];
        if (state.players && state.players.length > 0) {
            const playerRows = state.players.map(p => headers.map(h => p[h] !== undefined ? p[h] : ''));
            dataToWrite.push(...playerRows);
        }

        // シートをクリアし、データを一括で書き込む (最もシンプルで確実な方法)
        playersSheet.clearContents();
        playersSheet.getRange(1, 1, dataToWrite.length, headers.length).setValues(dataToWrite);

        console.log(`Successfully saved ${state.players.length} players for ${gender}.`);

    } finally {
        lock.releaseLock();
    }
}

/**
 * configシートに大会名を保存するヘルパー関数
 */
function saveCompetitionName(doc, gender, competitionName) {
  const configSheet = doc.getSheetByName('config') || doc.insertSheet('config');
  const competitionNameKey = gender === 'men' ? 'competitionNameMen' : 'competitionName';
  const configData = configSheet.getDataRange().getValues();
  const nameRowIndex = configData.findIndex(row => row[0] === competitionNameKey);

  if (nameRowIndex > -1) {
    configSheet.getRange(nameRowIndex + 1, 2).setValue(competitionName);
  } else {
    configSheet.appendRow([competitionNameKey, competitionName]);
  }
}