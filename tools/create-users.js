// 使い方: node create-users.js accounts.csv   （自分のPCで1回だけ実行。CSVはGitHubに上げない）
const fs = require('fs');
const { auth, db } = require('./admin-init');
const DOMAIN = 'quiz.example.com';                      // index.html の ID_DOMAIN と同じ値

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; if (row.length > 1) rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.length > 1) rows.push(row); }
  return rows;
}

(async () => {
  const text = fs.readFileSync(process.argv[2] || 'accounts.csv', 'utf8').replace(/^\uFEFF/, '');
  const [header, ...rows] = parseCsv(text);
  const col = (name) => header.indexOf(name);
  const [iGrade, iDept, iNum, iRole, iId, iPw] = ['学年', '学科', '出席番号', '役割', 'ユーザーID', 'パスワード'].map(col);
  if ([iGrade, iDept, iNum, iRole, iId, iPw].includes(-1)) throw new Error('CSVの見出しが違います（学年,学科,出席番号,役割,ユーザーID,パスワード）');
  let created = 0, skipped = 0;
  for (const row of rows) {
    const [grade, dept, number, role, userId, password] = [iGrade, iDept, iNum, iRole, iId, iPw].map((i) => row[i]);
    const email = `${userId.toLowerCase()}@${DOMAIN}`;
    let user;
    try { user = await auth.createUser({ email, password, displayName: userId }); }
    catch (e) {
      if (e.code !== 'auth/email-already-exists') throw e;
      user = await auth.getUserByEmail(email);
      // 登録済み（パスワード変更済みの人を含む）は触らない。途中で止まって情報が欠けた人だけ補う
      if ((await db.doc(`users/${user.uid}`).get()).exists) { skipped++; continue; }
    }
    await auth.setCustomUserClaims(user.uid, { role });
    await db.doc(`users/${user.uid}`).set({
      userId, role, schoolId: 'main', grade, className: dept,
      attendanceNumber: number, mustChange: true,
    });
    created++;
  }
  console.log(`作成 ${created} 件 / 既存のためスキップ ${skipped} 件`);
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
