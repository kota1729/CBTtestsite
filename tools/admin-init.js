const admin = require('firebase-admin');
// GitHub Actions では SERVICE_ACCOUNT_JSON、自分のPCでは GOOGLE_APPLICATION_CREDENTIALS（鍵ファイルのパス）を使う
const json = process.env.SERVICE_ACCOUNT_JSON;
admin.initializeApp({
  credential: json ? admin.credential.cert(JSON.parse(json)) : admin.credential.applicationDefault(),
});
module.exports = { auth: admin.auth(), db: admin.firestore() };
