// Firebaseコンソール → プロジェクトの設定 → 「マイアプリ」(ウェブ) に表示される値です。
// この値は公開されても問題ありません（守っているのはFirestoreルールとAuthです）。
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDQ-Idk-by-2POhMssNvJ7paYCOtgveZEQ',
  authDomain: 'cbttestsite-6f241.firebaseapp.com',
  projectId: 'cbttestsite-6f241',
  appId: '1:335243256294:web:8ee13b50e683612be5f627',
};

// 管理者（役割が「admin」のアカウント）がログインしたときの「管理画面」ボタンの行き先です。
// Apps Script で「デプロイ」したウェブアプリのURL（https://script.google.com/macros/s/…/exec）を入れてください。
// このURLが漏れても、Googleにログインした本人（自分のみ公開）以外は開けません。
window.ADMIN_PAGE_URL = 'https://script.google.com/macros/s/AKfycby9A588Huw-silZ9LMhCz3nRm157_lR1sJZl_P9Mld6A41H9otvLOUHMngzZdrP4BKG/exec';
