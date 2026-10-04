# 教科別 学習ミニテスト：公開ガイド

生徒がブラウザでログインして、小テストを解くサイトです。
- 公開：**GitHub Pages**（無料）
- ログインとパスワード：**Firebase Authentication**（無料。パスワードはGoogle側でハッシュ化されて保管）
- 生徒の登録・リセット・問題の作成：**管理画面（Google Apps Script）**。手順は、ZIPの `管理画面/セットアップ手順.md`

```
生徒のブラウザ ──開く──▶ GitHub Pages（このフォルダ：誰でも読める）
       └─ログイン──▶ Firebase（Auth：IDとパスワード／Firestore：学年・学科・問題セット）
あなた ──管理画面（自分のみ）──▶ Firebase（登録・リセット・問題の作成）
```

このフォルダ（`CBTtestsite`）は**公開されます**。鍵やパスワードを入れないでください。

```
CBTtestsite/
├─ index.html           サイト本体
├─ firebase-config.js   Firebaseの設定値（公開してよい値）
├─ firestore.rules      Firestoreのルール（Firebaseの画面に貼る）
├─ school/              学年・学科の一覧
└─ .gitignore
```

## 1. Firebaseの設定（1回だけ）
1. https://console.firebase.google.com でプロジェクトを作成（無料のSparkプランのまま。Googleアナリティクスはオフ）。
2. 構築 → **Authentication** →「始める」→ ログイン方法で「**メール／パスワード**」を有効にする（メールリンクはオフ）。
3. Authentication →「設定」→「承認済みドメイン」→ `あなたのGitHubユーザー名.github.io` を追加。
4. 構築 → **Firestore Database** → 作成（Standard／`asia-northeast1`／**本番環境モード**）→「ルール」に `firestore.rules` を貼って「公開」。
5. プロジェクトの設定 → マイアプリ → ウェブ（`</>`）を登録 → 表示された `apiKey` `authDomain` `projectId` `appId` を `firebase-config.js` に書く。

> ユーザーIDは、内部で `1-KANKYO-01` → `1-kankyo-01@quiz.example.com` というメール形式に変換しています（実際にメールは送られません）。`index.html` の `ID_DOMAIN` と、管理画面の `Code.gs` の `ID_DOMAIN` は同じ値にします。

## 2. GitHubで公開する（VS Codeのターミナル）
Macは、Gitが未インストールだと `git --version` で案内が出ます（「インストール」を押すだけ）。Windowsは https://git-scm.com から入れます。

1. `subject/` フォルダは使いません（教科の問題は、管理画面の「教科ファイルの取り込み」で登録します）。`firebase-config.js` の `ADMIN_PAGE_URL` に、管理画面（Apps Script）のURLを入れると、管理者の「管理画面」ボタンが使えます。
2. GitHubで、空のリポジトリ `CBTtestsite` を作る（**Public**。READMEなどは追加しない）。
3. VS Codeで `CBTtestsite` を開き、ターミナルで：
   ```
   git config --global user.name "あなたの名前"
   git config --global user.email "GitHubに登録したメールアドレス"
   git init
   git branch -M main
   git add .
   git status
   ```
   一覧に、鍵のJSONなど**秘密のファイルが出ていない**ことを確認してから：
   ```
   git commit -m "最初の版"
   git remote add origin https://github.com/ユーザー名/CBTtestsite.git
   git push -u origin main
   ```
4. リポジトリの Settings → Pages → Branch：`main` / `(root)` → Save。1〜3分後に出る `https://ユーザー名.github.io/CBTtestsite/` を生徒に配る。

## 3. 生徒を登録する
**`管理画面/セットアップ手順.md` に進んでください。**（鍵の作成、Apps Scriptの設定、600人の登録、問題の作成まで書いてあります）

## 4. 日々の更新
```
git add .
git status
git commit -m "変更のメモ"
git push
```
2台目のパソコンでは `git init` をせず、`git clone https://github.com/ユーザー名/CBTtestsite.git` で取り込みます。作業の前に `git pull`、後に `git add . / commit / push`。

## 5. 困ったとき
| 症状 | 対処 |
|---|---|
| 「firebase-config.js に Firebase の設定を入力してください」 | `firebase-config.js` が初期値のまま、またはプッシュされていない |
| `auth/unauthorized-domain` | 手順1-3のドメイン追加が未実施 |
| `auth/operation-not-allowed` | 手順1-2の「メール／パスワード」が無効 |
| 正しいのに「IDまたはパスワードが違います」 | 登録が未実施／IDの打ち間違い／パスワード変更済み（変更後のものを入れる） |
| 「アカウント情報が見つかりません」 | Firestoreに生徒情報が無い。管理画面で「再発行」で登録し直す |
| 問題が表示されない | Firestoreのルールを公開したか／`index.html` をプッシュしたか／生徒が入り直したか |
| 先生画面で、テンプレートや教科の選択肢が空 | 管理画面で、テンプレートを作る／教科ファイルを取り込む。Firestoreのルールを公開し直す |
| 記録が先生画面に出ない | Firestoreのルール（`results`）を公開したか。生徒が解き終えた直後に「記録を先生に送りました」と出たか |
| URLが404 | 反映待ち（数分）。`index.html` がリポジトリの一番上にあるか |
| `git push` で認証を求められる | ブラウザのサインインを許可する。ユーザー名とパスワードを聞かれたら、アクセストークンが必要（画面の文章を確認） |

## 6. 安全のために
- パスワードは**1人ずつ違うランダムな値**で、本人が最初に変更します。サイトのファイルには、パスワードは入っていません。
- Firebaseの設定値（`firebase-config.js`）は公開前提の値です。守っているのは、Authのログインと `firestore.rules` です。
- 鍵（サービスアカウントのJSON）は、管理画面のApps Scriptの中だけに置きます。このフォルダ・チャット・メールには出さない。
- GoogleアカウントとGitHubアカウントに二段階認証を設定する。
