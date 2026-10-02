// 使い方: node reset-password.js ユーザーID
// パスワードを初期値に戻し、次回ログイン時に変更画面を出す（忘れた人の救済用）
const { auth, db } = require('./admin-init');
const DOMAIN = 'quiz.example.com';
const INITIAL = { student: 'student123', teacher: 'teacher123' };

(async () => {
  const userId = (process.argv[2] || '').trim();
  if (!userId) { console.error('使い方: node reset-password.js ユーザーID'); process.exit(1); }
  const user = await auth.getUserByEmail(`${userId.toLowerCase()}@${DOMAIN}`);
  const role = (user.customClaims || {}).role === 'teacher' ? 'teacher' : 'student';
  await auth.updateUser(user.uid, { password: INITIAL[role] });
  await auth.revokeRefreshTokens(user.uid);
  await db.doc(`users/${user.uid}`).update({ mustChange: true });
  console.log(`${userId} をリセットしました。初期パスワードでログインすると変更画面が出ます。`);
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
