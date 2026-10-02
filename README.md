# 教科別 学習ミニテスト：公開・運用ガイド

このガイドは「ゼロから公開して、生徒がログインできる状態にする」までを、順番にたどれるように書いています。
画面の表記はFirebase・GitHubの更新で少し変わることがあります。名前が近いものを探してください。

所要時間の目安：初回は1〜2時間（待ち時間を含む）。

---

## 0. 全体の仕組み

```
生徒のブラウザ ──開く──▶ GitHub Pages（index.html・問題ファイル：誰でも読める公開場所）
       │
       └─ログイン──▶ Firebase Authentication（IDとパスワードの照合。パスワードはハッシュ化して保管）
                          │
                          └▶ Firestore（学年・学科・出席番号・教員かどうか・初回変更フラグ）
```

- **GitHub** は「ページを置く場所」だけを担当します。パスワードは置きません。
- **Firebase** が「誰がログインしてよいか」を担当します。パスワードは Google 側でハッシュ化されて保管され、私たちも見られません。
- **秘密鍵（サービスアカウントのJSON）** は、アカウントの一括作成とリセットだけに使う「合鍵」です。GitHubの公開ファイルには絶対に入れません。

ユーザーIDは、内部で `1-KANKYO-01` → `1-kankyo-01@quiz.example.com` というメール形式に変換しています（Firebaseがメール形式を必要とするため）。実際にメールは送られません。

---

## 1. 事前に用意するもの

| もの | 内容 |
|---|---|
| Googleアカウント | **個人のGoogleアカウント**を推奨。学校のアカウントは管理者設定で秘密鍵の作成が禁止されていることがあります（→ 手順2-5・トラブルシューティング） |
| Git | https://git-scm.com からインストール（`git` コマンドに必須。手順3-0） |
| GitHubアカウント | https://github.com で無料登録 |
| このフォルダ一式 | `index.html`、`school/`、`tools/` など。元から持っている `subject/` フォルダも同じ階層に置く |
| `accounts.csv` | 600件のアカウント一覧（**GitHubには上げない**） |

フォルダの形はこうなります。

```
CBTtestsite/
├─ index.html
├─ firebase-config.js      ← 手順2-4で書き換える
├─ firestore.rules
├─ README.md
├─ .gitignore
├─ .github/workflows/ (reset-password.yml, create-users.yml)
├─ school/  (schools.js, main.js)
├─ subject/ (joho_shori.js など8ファイル。お手元のもの)
├─ tools/   (create-users.js, reset-password.js, admin-init.js, package.json)
├─ secret/                 ← 秘密鍵を置く（GitHubには上がらない）
└─ accounts.csv            ← 自分のPCにだけ置く（GitHubには上がらない）
```

---

## 2. Firebase の設定

https://console.firebase.google.com を開き、Googleアカウントでログインします。

### 2-1. プロジェクトを作る
1. 「プロジェクトを作成」をクリック。
2. 名前を入力（例：`CBTtestsite`）。
3. Googleアナリティクスは**オフ**でかまいません。
4. 「プロジェクトを作成」→ 完了を待って「続行」。

料金プランは最初から無料の **Spark プラン**です。このまま変更しないでください（カードの登録は不要です）。

### 2-2. ログイン方法を有効にする
1. 左メニューの「構築」→「Authentication」→「始める」。
2. 「ログイン方法（Sign-in method）」タブ →「メール／パスワード」をクリック。
3. 一番上の「有効にする」をオン。**「メールリンク（パスワードなしでログイン）」はオフのまま**にして「保存」。

### 2-3. 公開先のドメインを許可する
1. Authentication →「設定」タブ →「承認済みドメイン」→「ドメインを追加」。
2. `あなたのGitHubユーザー名.github.io` を入力して追加。
   - 例：ユーザー名が `taro` なら `taro.github.io`
   - リポジトリ名や `https://` は付けません。
   - `localhost` は最初から入っています。

これを忘れると、公開後のログインで `auth/unauthorized-domain` というエラーになります。

### 2-4. データベース（Firestore）を作る
1. 左メニュー「構築」→「Firestore Database」→「データベースを作成」。
2. エディションを選ぶ画面が出たら **Standard**。
3. ロケーションは **asia-northeast1（東京）**。※後から変更できません。
4. 「**本番環境モードで開始**」を選んで作成。
5. 作成できたら「ルール」タブを開き、中身を**すべて消して**、`firestore.rules` の中身を貼り付け →「公開」。

このルールで「生徒は自分の情報だけ、教員は全員分を読める」「生徒が書き換えられるのは“初回変更済み”の印だけ」になります。

### 2-5. ウェブアプリを登録して設定値をもらう
1. 画面左上の歯車 →「プロジェクトの設定」→「全般」タブ。
2. 一番下の「マイアプリ」で `</>`（ウェブ）をクリック。
3. ニックネームを入力（例：`quiz-web`）。**「Firebase Hosting も設定する」はチェックしない**。「アプリを登録」。
4. `const firebaseConfig = { ... }` が表示されます。その中の次の4つを、`firebase-config.js` に貼ります。

```js
window.FIREBASE_CONFIG = {
  apiKey: 'AIza……',
  authDomain: 'cbttestsite.firebaseapp.com',
  projectId: 'cbttestsite',
  appId: '1:1234567890:web:abcdef……',
};
```

この値は公開されても問題ありません（守っているのはAuthとFirestoreのルールです）。

### 2-6. 秘密鍵（サービスアカウント）をダウンロードする
1. 「プロジェクトの設定」→「サービスアカウント」タブ。
2. 「新しい秘密鍵を生成」→「キーを生成」。JSONファイルがダウンロードされます。
3. プロジェクト内の `secret` フォルダに置きます（例：`CBTtestsite\secret\鍵のファイル名.json`）。`.gitignore` で、`secret/` ごとGitHubに上がらないようにしてあります。
4. このファイルは次の2か所以外には絶対に出さないでください：GitHubの Secrets（手順5-1）と、自分のPCの `secret` フォルダ。

---

## 3. VS Codeのターミナルで、GitHubに公開する

ここからは、**VS Codeのターミナルにコマンドを打って**進めます（`git init` から `git push` まで）。

### 3-0. 準備
1. **Gitをインストール**する（`git` のコマンドを使うために、必須です。1回だけ）。
   - https://git-scm.com からダウンロードし、設定は変えずに最後まで進める。
   - インストール後、VS Codeを**一度閉じて開き直す**。
2. **GitHubのアカウント**を用意する（https://github.com で無料登録）。
3. VS Codeで、メニュー「ファイル」→「フォルダーを開く」→ `CBTtestsite` を選ぶ。
4. メニュー「ターミナル」→「新しいターミナル」を開く。
5. 動作確認。
   ```
   git --version
   ```
   `git version 2.x.x` と出れば成功。「認識されません」と出たら、VS Codeを閉じて開き直す。
6. 名前とメールアドレスを登録する（初回だけ。自分の情報に直して）。
   ```
   git config --global user.name "あなたの名前"
   git config --global user.email "GitHubに登録したメールアドレス"
   ```
7. 教科の問題ファイル8つ（`joho_shori.js` `kokugo.js` `sugaku.js` `eigo.js` `shakai.js` `rika.js` `boki.js` `business_kiso.js`）を、`CBTtestsite/subject` に入れる（案内の `.txt` は削除してよい）。
8. 秘密鍵のJSONを `CBTtestsite/secret` に入れる（`.gitignore` で、GitHubに上がらないようにしてあります）。

### 3-1. GitHubに空のリポジトリを作る（ブラウザで1回だけ）
リポジトリの「入れ物」は、GitHubのサイトで作ります。
1. https://github.com にログイン →右上の「＋」→「New repository」。
2. Repository name：`CBTtestsite`
3. **Public** を選ぶ（無料プランのGitHub Pagesは公開リポジトリが必要）。
4. 「Add a README file」「.gitignore」「license」は、**すべて選ばない**（空のまま）。
5. 「Create repository」→ 表示されたURL（`https://github.com/ユーザー名/CBTtestsite.git`）を控える。

### 3-2. 初期化してコミットする
ターミナルで、**1行ずつ**打ってEnterを押します。

```
git init
git branch -M main
git add .
git status
```

**ここで必ず `git status` の表示を確認します。** 緑の文字（コミットされるファイル）の一覧に、次のものが**出ていない**ことを確認してください。

- [ ] `accounts.csv`
- [ ] `secret/` の中のファイル（鍵のJSON）
- [ ] `node_modules/`

さらに、次の1行でも確認できます（`.gitignore` の行が表示されれば、除外されています）。
```
git check-ignore -v accounts.csv secret/鍵のファイル名.json
```

もし出ていたら、**ここで止まって**（`commit` も `push` もしないで）、状況を知らせてください。

問題なければ、コミットします。
```
git commit -m "最初の版"
```

> `LF will be replaced by CRLF` という警告が出ても、問題ありません（改行コードの自動変換の案内です）。

### 3-3. GitHubに送る（プッシュ）
手順3-1で控えたURLを使います。`ユーザー名` は、自分のGitHubのユーザー名です。

```
git remote add origin https://github.com/ユーザー名/CBTtestsite.git
git push -u origin main
```

- 初めてのときは、ブラウザが開いて「GitHubにサインイン」を求められます。許可してください。
- 「Username」「Password」を聞かれる場合、Passwordには**GitHubのパスワードではなく**、アクセストークンが必要になることがあります。その画面が出たら知らせてください。

終わったら、https://github.com/ユーザー名/CBTtestsite を開いて確認します。

- [ ] `index.html` `firebase-config.js` `firestore.rules` `school` `subject` `tools` `.github` が見える
- [ ] **`accounts.csv` と `secret` が見えない**こと

> **`.github` について**：`git add .` は、「.」で始まるフォルダも含めて追加します。ブラウザでの手作業は不要です。

### 3-4. （おまけ）VS Codeのボタンとの対応
同じことは、画面のボタンでもできます。コマンドが不安なときは使ってください。

| コマンド | VS Codeの画面 |
|---|---|
| `git init` | ソース管理（枝分かれのアイコン）→「リポジトリを初期化する」 |
| `git add .` と `git commit` | メッセージ欄に入力 →「コミット」 |
| `git push` | 「ブランチの発行」（初回）／「変更の同期」（2回目以降） |

---

## 4. 公開（GitHub Pages）と、Firebaseのドメイン登録

### 4-1. GitHub Pages を有効にする
1. リポジトリの「Settings」→ 左の「Pages」。
2. Source：「Deploy from a branch」。Branch：`main`、フォルダ：`/ (root)` →「Save」。
3. 1〜3分待つと、ページ上部に公開URLが出る。
   `https://ユーザー名.github.io/CBTtestsite/`
4. 生徒には、このURLを配ります。

### 4-2. Firebaseに公開先のドメインを登録する（忘れると、ログインできません）
1. Firebaseコンソール → Authentication →「設定」タブ →「承認済みドメイン」→「ドメインを追加」。
2. `ユーザー名.github.io` を入力して追加。リポジトリ名や `https://` は付けません。

---

## 5. アカウント600件を登録する

登録方法は2つあります。**自分のPC（制限のないネットワーク）なら、方法Bでそのまま登録できます。** 学校のPCなどで `ENOTFOUND` と出る（Node.jsがネットワークに阻まれる）場合は、方法Aを使ってください。

### 方法A：GitHubのサーバー（Actions）で登録する
自分のPCのネットワークや、Node.jsは使いません。

**5-1. 秘密鍵をSecretsに登録する**
1. リポジトリの「Settings」→「Secrets and variables」→「Actions」→「New repository secret」。
2. Name：`FIREBASE_SERVICE_ACCOUNT`
3. Secret：鍵のJSONをメモ帳などで開き、**中身全体**（`{` から `}` まで。Ctrl+A → Ctrl+C）を貼る。
4. 「Add secret」。

**5-2. アカウント一覧をSecretsに登録する**
1. もう一度「New repository secret」。
2. Name：`ACCOUNTS_CSV`
3. Secret：`accounts.csv` をメモ帳で開き、**中身全体**を貼る（約42KBで、上限の約48KBに収まります）。
4. 「Add secret」。

**5-3. 実行する**
1. リポジトリの「Actions」タブ → 左の「アカウントの一括登録」。
   有効化のボタン（I understand my workflows, go ahead and enable them）が出たら押す。
2. 「Run workflow」→ 緑の「Run workflow」。
3. 数分待って、緑の ✓ が付けば完了。その行をクリック →「create」→ ログの最後に `作成 600 件 / 既存のためスキップ 0 件` と出れば成功。
4. 登録できたら、`ACCOUNTS_CSV` のSecretを**削除**する（以降は不要）。

### 方法B：自分のPCのNode.jsで登録する
ネットワークが制限されていないPCで使えます。

1. Node.js（https://nodejs.org の **LTS**）をインストールして、VS Codeを開き直す。
2. ターミナルで `node -v` と打ち、`v22.x.x` のような数字が出るか確認する。
3. 次を**1行ずつ**実行する（`鍵のファイル名.json` は、実際の名前に）。
   ```
   cd tools
   npm.cmd install
   $env:GOOGLE_APPLICATION_CREDENTIALS="..\secret\鍵のファイル名.json"
   node create-users.js ..\accounts.csv
   ```
   - PowerShellで `npm` が「スクリプトの実行が無効」と出るため、`npm.cmd` と打ちます。
   - `GOOGLE_APPLICATION_CREDENTIALS` の設定は、そのターミナルを閉じると消えます。
   - 最後に `作成 600 件 / 既存のためスキップ 0 件` と出れば成功。
   - `ENOTFOUND` と出たら、そのネットワークはGoogleに届いていません。方法Aを使ってください。

### 5-4. 登録できたか確認する
1. Firebaseコンソール → Authentication →「ユーザー」に、メール形式（`1-kankyo-01@quiz.example.com` など）で600件並んでいる。
2. Firestore Database → `users` コレクションに、600件ある。

途中で止まったときは、同じ操作をもう一度行ってください。登録済みの人は飛ばし、足りない分だけ補います。

---

## 6. 動作確認チェックリスト

公開URLを開いて、順に確認します。

1. [ ] ログイン画面に「ユーザーID」「パスワード」だけが表示される。
2. [ ] `1-KANKYO-01` / `student123` でログイン → **パスワード変更画面**が出る。
3. [ ] 7文字以下、確認が不一致、`student123` のまま、は拒否される。
4. [ ] 8文字以上の新パスワードを設定 → 「1年 環境システム科 1番さん」と表示される。
5. [ ] ログアウトして `student123` でログイン → **失敗**する。新しいパスワードで入れる。
6. [ ] 教員 `1-KANKYO-40` / `teacher123` でログイン → 変更画面 → 先生メニューが開く。
7. [ ] Firestoreの `users` のそのドキュメントで `mustChange` が `false` になっている。
8. [ ] （リセット確認）手順7の方法でその生徒をリセット → `student123` で入れて、変更画面が出る。

---

## 7. パスワードを忘れたとき（強制リセット）

### 方法A：GitHubの画面から（おすすめ）
1. リポジトリの「Actions」タブ → 左の「パスワードのリセット」。
2. 「Run workflow」→ ユーザーIDを入力（例：`1-KANKYO-05`）→ 緑の「Run workflow」。
3. 30秒ほどで ✓ が付けば完了。
4. 本人に「初期パスワードでログインして、新しいパスワードを決め直してください」と伝える。

### 方法B：VS Codeのターミナルから（Node.jsが使えるPC）
```
cd tools
$env:GOOGLE_APPLICATION_CREDENTIALS="..\secret\鍵のファイル名.json"
node reset-password.js 1-KANKYO-05
```

どちらも、パスワードを初期値（生徒 `student123`／教員 `teacher123`）に戻し、次回ログイン時に変更画面を出します。実行できるのは、リポジトリに書き込み権限を持つ人だけです。

**注意**：リセットしてから本人が変更するまでの間は、初期パスワードを知っている人なら誰でもそのIDで入れてしまいます。本人が見ている場でリセット→その場で変更、の流れが安全です。

---

## 8. 日々の運用（VS Code）

### ファイルを直して公開に反映する
ファイルを編集して保存したら、ターミナルで次を実行します。
```
git add .
git status
git commit -m "変更内容のメモ"
git push
```
1〜3分で、公開サイトに反映されます。**コミットの前の `git status` で、`accounts.csv` や `secret` が出ていないか、毎回確認してください。**

### 2台目のPCで続ける
1台目で**プッシュまで終わっている**ことを確認してから行います。**2台目では `git init` はしません。**
```
git clone https://github.com/ユーザー名/CBTtestsite.git
```
その後、VS Codeで `CBTtestsite` フォルダを開きます。以降はどちらのPCでも、次の流れです。

1. 作業の前に取り込む：`git pull`
2. 編集する
3. 作業の後に送る：`git add .` → `git commit -m "メモ"` → `git push`

同じファイルを2台で同時に編集すると「競合」が起きます。必ず `git pull` してから始めてください。`accounts.csv` と秘密鍵は同期されないので、必要なときだけUSBメモリなどで手でコピーします。

### その他
- **新入生・転入生を追加する**：新しい人の行だけのCSVを作り、登録（手順5）をもう一度行います。登録済みの人は飛ばされます。
- **卒業・退学の人を消す**：Firebaseの Authentication →「ユーザー」から削除し、Firestoreの `users` の同じIDのドキュメントも削除します。
- **先生を増やす**：CSVに `役割` が `teacher` の行を追加して、新しい人の追加と同じ手順で登録します。
- **成績の保存**：生徒の成績は、今はまだ各ブラウザの中に保存されています。全員分を先生が見られるようにするには、成績もFirestoreに保存する追加作業が必要です。

---

## 9. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| `git` が「認識されません」 | Gitをインストールして、VS Codeを閉じて開き直す（手順3-0） |
| `Author identity unknown` | 手順3-0の6の `git config` を実行する |
| `git status` に `accounts.csv` や `secret/` が出る | **コミットしない**。`.gitignore` が存在するか、中身に `accounts.csv` と `secret/` があるか確認する。すでにコミットしてしまったら、**プッシュする前なら** `git rm --cached accounts.csv` → `git commit --amend` で取り消せる |
| `git push` で認証を求められる／拒否される | ブラウザのサインインを許可する。ユーザー名とパスワードを聞かれる場合は、アクセストークンが必要。画面の文章を知らせてください |
| `error: remote origin already exists` | すでに `git remote add` を実行済み。`git remote -v` で確認し、URLが違えば `git remote set-url origin 正しいURL` |
| `failed to push some refs` / `rejected` | GitHubの側に、手元にない内容がある（作成時にREADMEを追加した場合など）。画面の文章を知らせてください |
| 公開URLが「404」になる | Pagesの反映待ち（数分）。または `index.html` がリポジトリの一番上にない |
| ログイン画面に「firebase-config.js に Firebase の設定を入力してください」と出る | `firebase-config.js` が初期値のまま、またはプッシュされていない |
| `auth/unauthorized-domain` | 手順4-2のドメイン追加が未実施 |
| `auth/operation-not-allowed` | 手順2-2の「メール／パスワード」が有効になっていない |
| 「ユーザーIDまたはパスワードが違います」が正しい入力でも出る | ① 手順5が未実行　② IDの打ち間違い（大文字小文字は区別されません）　③ 変更済みなのに初期パスワードを入れている |
| 「アカウント情報が見つかりません」 | Authenticationにはいるが Firestore の `users` に無い。手順5をもう一度実行 |
| 教員なのに先生メニューが出ない／権限エラー | CSVの「役割」が `teacher` か確認。ログアウトして入り直す。Firestoreのルールが公開済みかも確認（手順2-4） |
| 「失敗が続いたため一時的にロックされました」 | Firebaseの連続失敗防止。数分待つ |
| 問題が表示されない・教科が空 | `subject/` がプッシュされていない、またはファイル名の大文字小文字が違う（GitHub Pagesは区別します） |
| Actionsに「アカウントの一括登録」「パスワードのリセット」が出ない | `.github/workflows/` の2ファイルがプッシュされていない。`git status` と、GitHubのページで確認 |
| Actionsが認証エラーになる | Secret名が `FIREBASE_SERVICE_ACCOUNT` か、JSONの中身全体（`{`〜`}`）を貼ったか確認 |
| Actionsが `5 NOT_FOUND` で失敗する | Firestoreのデータベースがまだ作られていない（手順2-4） |
| `ENOTFOUND` / `getaddrinfo` と出る（Node.js） | ネットワークがGoogleのサーバーを止めている。手順5の方法A（Actions）を使う |
| `npm` が「スクリプトの実行が無効」と出る | `npm.cmd` と打つ |
| `Could not load the default credentials` | `GOOGLE_APPLICATION_CREDENTIALS` を設定した**同じターミナル**で実行する。ファイル名の打ち間違いにも注意 |
| 秘密鍵の作成ボタンが押せない／「組織のポリシー」と出る | 学校のGoogleアカウントでは禁止されていることがあります。個人のGoogleアカウントでプロジェクトを作り直す |
| ページを更新しても古いまま | 反映待ち（数分）。ブラウザを強制再読み込み（Ctrl+F5） |

---

## 10. セキュリティの考え方（なぜこれで安全か）

- パスワードは Firebase がハッシュ化して保管します。リポジトリにもFirestoreにも、パスワードは保存されません。
- ブラウザに入っているFirebase設定値は公開前提の値です。実際の防御は「Authによるログイン」と「Firestoreルール」で行っています。
- **秘密鍵だけが「全員分を操作できる」強い権限**です。`secret` フォルダ（`.gitignore` で除外）と、GitHubの Secrets にしか置きません。チャットやメールにも貼らないでください。
- もし鍵をうっかり外に出したら、Firebaseの「サービスアカウント」（Google Cloudの「キー」画面）で該当キーを削除し、新しく作り直してください。古い鍵は無効になります。
- 余裕があれば、Google Cloudコンソール → 「APIとサービス」→「認証情報」で、ウェブ用のAPIキーを「HTTPリファラー」制限（`ユーザー名.github.io/*`）にしておくと、他のサイトからの悪用を減らせます。
- 初期パスワードは公開情報です。配布後は、なるべく早く全員に変更してもらってください。
