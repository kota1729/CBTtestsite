// I1テスト対策：CBTテストと同じログイン（Firebase）を使う。
// ログインは親フォルダの index.html で行い、このページはログイン済みの状態で開く。
// ★とメモは Firestore の i1Data/{uid} に保存する。

let auth = null;
let db = null;

// --- 処理中オーバーレイ / トースト通知 ---
let loadingDepth = 0;
let loadingStuckTimer = null;
const LOADING_STUCK_HINT_MS = 7000;

function showLoading(text = '処理中...') {
    loadingDepth++;
    document.getElementById('loading-overlay-text').innerText = text;
    document.getElementById('loading-overlay').classList.add('active');
    armLoadingStuckTimer();
}
function hideLoading() {
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth === 0) {
        document.getElementById('loading-overlay').classList.remove('active');
        disarmLoadingStuckTimer();
    }
}
function armLoadingStuckTimer() {
    disarmLoadingStuckTimer();
    loadingStuckTimer = setTimeout(() => {
        const hintEl = document.getElementById('loading-overlay-hint');
        if (hintEl) hintEl.classList.add('show');
    }, LOADING_STUCK_HINT_MS);
}
function disarmLoadingStuckTimer() {
    if (loadingStuckTimer) {
        clearTimeout(loadingStuckTimer);
        loadingStuckTimer = null;
    }
    const hintEl = document.getElementById('loading-overlay-hint');
    if (hintEl) hintEl.classList.remove('show');
}

function notifySyncError(what) {
    const wrap = document.getElementById('sync-toast-wrap');
    if (!wrap) return;
    const toast = document.createElement('div');
    toast.className = 'sync-toast error';
    toast.innerText = `⚠ ${what}の保存に失敗しました。通信環境をご確認ください。`;
    wrap.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function withTimeout(promise, ms, timeoutMessage) {
    let timerId;
    const timeout = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(timeoutMessage || `処理がタイムアウトしました（${ms / 1000}秒）`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// --- ログイン中の人 ---
let currentUser = null;      // Firebase AuthのUID
let currentUsername = null;  // 画面に出す名前（「1年 情報ビジネス科 5番さん」）
let currentProfile = null;   // users/{uid} の内容
let isManager = false;       // 先生または管理者
let isAdminSession = false;  // 管理者（全学年・全学科）
let currentSubject = null;
let currentMode = 1;
let activeQuestions = [];
let currentIndex = 0;

function nameLabel(p) {
    const n = Number(p.attendanceNumber);
    const num = (Number.isNaN(n) || p.attendanceNumber === '' || p.attendanceNumber == null) ? (p.attendanceNumber || '') : n;
    return [p.grade, p.className, `${num}番さん`].filter(Boolean).join(' ');
}

function goLogin() { location.replace('../'); }
function backToSiteMenu() { location.href = '../#menu'; }

async function startApp() {
    const cfg = window.FIREBASE_CONFIG;
    if (typeof firebase === 'undefined' || !cfg || String(cfg.apiKey).startsWith('YOUR_')) {
        goLogin();
        return;
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    try { await auth.setPersistence(localStorage.getItem('cbt_login_persistence') === 'local' ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION); } catch (e) { /* そのまま続ける */ }

    let started = false;
    auth.onAuthStateChanged(async (user) => {
        if (!user) { goLogin(); return; }
        if (started) return;
        started = true;
        try {
            const snap = await withTimeout(db.collection('users').doc(user.uid).get(), 10000, 'タイムアウト');
            if (!snap.exists || snap.data().mustChange) { goLogin(); return; }
            currentProfile = snap.data();
            currentUser = user.uid;
            currentUsername = nameLabel(currentProfile);
            isManager = currentProfile.role === 'teacher' || currentProfile.role === 'admin';
            isAdminSession = currentProfile.role === 'admin';
            resetSessionCache();
            await withTimeout(loadSessionData(), 10000, 'データの読み込みがタイムアウトしました。通信環境をご確認ください。');
            hideLoading();
            showSubjectScreen();
        } catch (error) {
            console.error(error);
            hideLoading();
            await showCustomAlert('読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。', '通信エラー');
        }
    });
}

function getSubjectList() {
    return Object.values(window.QUIZ_SUBJECTS || {}).sort((a, b) => (a.order || 0) - (b.order || 0));
}
function getSubjectName(subjectId) {
    const subj = (window.QUIZ_SUBJECTS || {})[subjectId];
    return subj ? subj.name : subjectId;
}
function getActiveSubjectQuestions() {
    const subj = (window.QUIZ_SUBJECTS || {})[currentSubject];
    if (!subj) return [];
    // ★・メモは「元の配列での位置」で区別する（同じ問題文が複数あっても混ざらない）
    subj.questions.forEach((q, idx) => {
        if (q._origIdx === undefined) q._origIdx = idx;
    });
    return subj.questions;
}

function showCustomAlert(message, title = '通知') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;
        const btnContainer = document.getElementById('modal-btns');
        btnContainer.innerHTML = '';
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-main';
        okBtn.style.padding = '10px 20px';
        okBtn.innerText = 'OK';
        okBtn.onclick = () => { modal.classList.remove('active'); resolve(true); };
        btnContainer.appendChild(okBtn);
        modal.classList.add('active');
    });
}

function showCustomConfirm(message, title = '確認') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;
        const btnContainer = document.getElementById('modal-btns');
        btnContainer.innerHTML = '';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sub';
        cancelBtn.style.padding = '10px 20px';
        cancelBtn.innerText = 'キャンセル';
        cancelBtn.onclick = () => { modal.classList.remove('active'); resolve(false); };
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-danger';
        confirmBtn.style.padding = '10px 20px';
        confirmBtn.innerText = '実行する';
        confirmBtn.onclick = () => { modal.classList.remove('active'); resolve(true); };
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        modal.classList.add('active');
    });
}

// --- ★とメモ（ログイン時に1回だけ読み込み、あとはメモリ上で扱い、保存は裏で行う） ---
let sessionStars = {};   // { subjectId: [idx, ...] }
let sessionMemos = {};   // { subjectId: { idx: text } }
let sessionDataReady = false;

const dataRef = (uid) => db.collection('i1Data').doc(uid);
function sessionDocRef() { return dataRef(currentUser); }

async function loadSessionData(forceRefresh = false) {
    if (sessionDataReady && !forceRefresh) return;
    const doc = await sessionDocRef().get();
    const data = doc.exists ? doc.data() : {};
    const starField = data.starred;
    sessionStars = (starField && typeof starField === 'object' && !Array.isArray(starField)) ? starField : {};
    const memoField = data.memos;
    sessionMemos = (memoField && typeof memoField === 'object') ? memoField : {};
    sessionDataReady = true;
}

function resetSessionCache() {
    sessionStars = {};
    sessionMemos = {};
    sessionDataReady = false;
}

function getSessionStars(subjectId) { return (sessionStars[subjectId] || []).slice(); }
function getSessionMemos(subjectId) { return sessionMemos[subjectId] || {}; }

function setSessionStars(subjectId, starsArray) {
    sessionStars[subjectId] = starsArray;
    sessionDocRef().set({ starred: { [subjectId]: starsArray } }, { merge: true })
        .catch(err => { console.error(err); notifySyncError('★'); });
}

async function setSessionMemo(subjectId, idx, text) {
    sessionMemos[subjectId] = sessionMemos[subjectId] || {};
    sessionMemos[subjectId][idx] = text;
    try {
        await sessionDocRef().set({ memos: { [subjectId]: { [idx]: text } } }, { merge: true });
    } catch (err) {
        console.error(err);
        notifySyncError('メモ');
    }
}

const memoSaveTimers = {};
function scheduleMemoSave(key, saveFn, statusElId) {
    const statusEl = document.getElementById(statusElId);
    if (statusEl) {
        statusEl.textContent = '入力中…';
        statusEl.classList.remove('saved');
    }
    if (memoSaveTimers[key]) clearTimeout(memoSaveTimers[key]);
    memoSaveTimers[key] = setTimeout(async () => {
        await saveFn();
        if (statusEl) {
            statusEl.textContent = '✓ 保存しました';
            statusEl.classList.add('saved');
        }
    }, 700);
}

// --- パスワード変更 ---
function toggleChangePasswordVisibility(btn, inputId) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '隠す';
    } else {
        input.type = 'password';
        btn.innerText = '表示';
    }
}

function showChangePasswordScreen() {
    document.querySelectorAll('.window').forEach(el => el.style.display = 'none');
    document.getElementById('change-password-screen').style.display = 'block';
    document.getElementById('change-current-password').value = '';
    document.getElementById('change-new-password').value = '';
}

async function handleChangeOwnPassword() {
    const currentPw = document.getElementById('change-current-password').value;
    const newPw = document.getElementById('change-new-password').value;

    if (!currentPw || !newPw) {
        await showCustomAlert('現在のパスワードと新しいパスワードの両方を入力してください。', '入力エラー');
        return;
    }
    if (newPw.length < 8) {
        await showCustomAlert('パスワードは8文字以上にしてください。', 'パスワードエラー');
        return;
    }
    if (newPw === currentPw) {
        await showCustomAlert('今のパスワードとは別のパスワードにしてください。', 'パスワードエラー');
        return;
    }
    if (currentProfile && String(currentProfile.userId || '').toLowerCase() === newPw.toLowerCase()) {
        await showCustomAlert('パスワードにユーザーIDと同じ文字列は使用できません。', 'パスワードエラー');
        return;
    }

    const confirmed = await showCustomConfirm('パスワードを変更します。よろしいですか？\n変更後は、自動的に一度ログアウトされます。', '確認');
    if (!confirmed) return;

    showLoading('変更中...');
    try {
        const user = auth.currentUser;
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPw);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPw);
        hideLoading();
        await showCustomAlert('パスワードを更新しました。再度ログインしてください。', '変更完了');
        handleLogout();
    } catch (error) {
        hideLoading();
        console.error(error);
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            await showCustomAlert('現在のパスワードが正しくありません。', '変更エラー');
        } else if (error.code === 'auth/requires-recent-login') {
            await showCustomAlert('セキュリティのため、一度ログアウトしてから再度ログインし、もう一度お試しください。', '確認が必要です');
        } else {
            await showCustomAlert('変更に失敗しました。', 'エラー');
        }
    }
}

async function handleLogout() {
    try { await auth.signOut(); } catch (e) { /* そのままログイン画面へ */ }
    currentUser = null;
    currentUsername = null;
    currentProfile = null;
    isManager = false;
    isAdminSession = false;
    currentSubject = null;
    resetSessionCache();
    goLogin();
}

async function resetMyStars() {
    const subjectName = getSubjectName(currentSubject);
    const confirmed = await showCustomConfirm(`あなたが「${subjectName}」で登録した★（わからない問題）のマークをすべて解除してリセットします。他の教科の★には影響しません。よろしいですか？`, '★のリセット');
    if (confirmed) {
        setSessionStars(currentSubject, []);
        await showCustomAlert('この教科の★データをリセットしました。', 'リセット完了');
        await showMainMenu();
    }
}

async function clearMyMemos() {
    const subjectName = getSubjectName(currentSubject);
    const confirmed = await showCustomConfirm(`あなたが「${subjectName}」で書いたメモを、すべてまとめて消去します。他の教科のメモには影響しません。この操作は取り消せません。よろしいですか？`, 'メモの全消去');
    if (confirmed) {
        showLoading('消去中...');
        try {
            await dataRef(currentUser).set({ memos: { [currentSubject]: {} } }, { merge: true });
            sessionMemos[currentSubject] = {};
            hideLoading();
            await showCustomAlert('この教科のメモをすべて消去しました。', '消去完了');
            await showMainMenu();
        } catch (error) {
            hideLoading();
            console.error(error);
            await showCustomAlert('消去に失敗しました。', 'エラー');
        }
    }
}

function showSubjectScreen() {
    document.querySelectorAll('.window').forEach(el => el.style.display = 'none');
    document.getElementById('subject-screen').style.display = 'block';
    document.getElementById('display-username-subject').innerText = currentUsername;

    const list = document.getElementById('subject-list');
    list.innerHTML = '';

    const subjects = getSubjectList();
    if (subjects.length === 0) {
        list.innerHTML = `
            <div style="text-align:left; background:#fff3f3; border:1px solid #e74c3c; border-radius:8px; padding:15px; font-size:13px; line-height:1.7; color:#555;">
                <strong style="color:var(--accent);">⚠️ 教科データを読み込めませんでした。</strong><br>
                <code>i1/subjects</code> フォルダの中に、<code>joho_shori.js</code> などの教科ファイルが入っているか確認してください。
            </div>`;
        return;
    }

    subjects.forEach(subj => {
        const btn = document.createElement('button');
        btn.className = 'menu-btn';
        btn.innerHTML = `<span>教科</span> ${escapeHtml(subj.name)}（全${subj.questions.length}問）`;
        btn.onclick = () => selectSubject(subj.id);
        list.appendChild(btn);
    });
}

async function selectSubject(subjectId) {
    currentSubject = subjectId;
    await showMainMenu();
}

async function showMainMenu() {
    document.querySelectorAll('.window').forEach(el => el.style.display = 'none');
    document.getElementById('menu-screen').style.display = 'block';
    document.getElementById('display-username').innerText = currentUsername;
    document.getElementById('menu-subject-name').innerText = getSubjectName(currentSubject);

    document.getElementById('admin-panel-btn').style.display = isManager ? 'block' : 'none';

    const starModeBtn = document.getElementById('menu-star-btn');
    const starCount = getSessionStars(currentSubject).length;
    starModeBtn.innerText = `★ 限定モード (現在 ${starCount} 問)`;
    starModeBtn.disabled = starCount === 0;
}

async function toMainMenu() {
    await showMainMenu();
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function startMode(modeNum) {
    currentMode = modeNum;
    currentIndex = 0;

    document.querySelectorAll('.window').forEach(el => el.style.display = 'none');

    const questions = getActiveSubjectQuestions();
    const subjectName = getSubjectName(currentSubject);
    const myStars = getSessionStars(currentSubject);

    if (modeNum === 1) {
        activeQuestions = [...questions];
        document.getElementById('quiz-title').innerText = `${subjectName} - 1問ずつ挑戦（標準順）`;
        await setupQuizScreen();
    } else if (modeNum === 2) {
        document.getElementById('list-title').innerText = `${subjectName} - 全問一気見リスト`;
        await setupListScreen();
    } else if (modeNum === 3) {
        activeQuestions = shuffle(questions);
        document.getElementById('quiz-title').innerText = `${subjectName} - ランダム実力テスト`;
        await setupQuizScreen();
    } else if (modeNum === 4) {
        activeQuestions = questions.filter((_, idx) => myStars.includes(idx));
        document.getElementById('quiz-title').innerText = `${subjectName} - ★ わからない問題 復習テスト`;
        await setupQuizScreen();
    }
}

async function setupQuizScreen() {
    document.getElementById('quiz-screen').style.display = 'block';
    await showQuestion();
}

async function showQuestion() {
    if (currentIndex >= activeQuestions.length) {
        document.querySelectorAll('.window').forEach(el => el.style.display = 'none');
        document.getElementById('result-screen').style.display = 'block';
        return;
    }

    const current = activeQuestions[currentIndex];
    const container = document.getElementById('quiz-a-container');
    container.classList.remove('revealed');

    document.getElementById('quiz-question').innerText = current.q;
    document.getElementById('quiz-answer').innerText = current.a;

    const imgEl = document.getElementById('quiz-question-img');
    if (current.img) {
        imgEl.src = current.img;
        imgEl.style.display = 'block';
    } else {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
    }

    const starBtn = document.getElementById('quiz-star');
    getActiveSubjectQuestions();
    const originalIdx = current._origIdx;
    const myStars = getSessionStars(currentSubject);
    const myMemos = getSessionMemos(currentSubject);

    starBtn.classList.toggle('active', myStars.includes(originalIdx));

    const memoEl = document.getElementById('quiz-memo');
    memoEl.value = myMemos[originalIdx] || '';
    memoEl.dataset.idx = originalIdx;
    const memoStatusEl = document.getElementById('quiz-memo-status');
    if (memoStatusEl) {
        memoStatusEl.textContent = '';
        memoStatusEl.classList.remove('saved');
    }
    document.getElementById('memo-content').style.display = 'none';
    document.getElementById('memo-toggle-label').textContent = 'タップして表示';

    const total = activeQuestions.length;
    document.getElementById('quiz-count').innerText = `第 ${currentIndex + 1} 問 / ${total} 問`;
    document.getElementById('quiz-progress').style.width = `${(currentIndex / total) * 100}%`;
    document.getElementById('prev-btn').disabled = (currentIndex === 0);
}

function toggleMemoVisibility() {
    const content = document.getElementById('memo-content');
    const label = document.getElementById('memo-toggle-label');
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    label.textContent = isHidden ? 'タップして隠す' : 'タップして表示';
}

function onQuizMemoInput() {
    const memoEl = document.getElementById('quiz-memo');
    const idx = Number(memoEl.dataset.idx);
    scheduleMemoSave('quiz', () => saveMemoValue(idx, memoEl.value), 'quiz-memo-status');
}

async function saveQuizMemoNow() {
    const memoEl = document.getElementById('quiz-memo');
    const idx = Number(memoEl.dataset.idx);
    if (memoSaveTimers['quiz']) clearTimeout(memoSaveTimers['quiz']);
    await saveMemoValue(idx, memoEl.value);
    const statusEl = document.getElementById('quiz-memo-status');
    if (statusEl) {
        statusEl.textContent = '✓ 保存しました';
        statusEl.classList.add('saved');
    }
}

async function saveMemoValue(idx, text) {
    if (isNaN(idx)) return;
    await setSessionMemo(currentSubject, idx, text);
}

function toggleStarCurrent() {
    const current = activeQuestions[currentIndex];
    getActiveSubjectQuestions();
    const originalIdx = current._origIdx;
    const starBtn = document.getElementById('quiz-star');

    const myStars = getSessionStars(currentSubject);
    const foundIdx = myStars.indexOf(originalIdx);
    if (foundIdx > -1) {
        myStars.splice(foundIdx, 1);
        starBtn.classList.remove('active');
    } else {
        myStars.push(originalIdx);
        starBtn.classList.add('active');
    }
    setSessionStars(currentSubject, myStars);
}

function toggleAnswer(containerEl) {
    containerEl.classList.toggle('revealed');
    if (containerEl.closest('#list-container')) updateBulkToggleBtnLabel();
}

function toggleAllAnswers() {
    const containers = document.querySelectorAll('#list-container .a-container');
    if (containers.length === 0) return;
    const revealedCount = document.querySelectorAll('#list-container .a-container.revealed').length;
    const shouldReveal = revealedCount < containers.length / 2;
    containers.forEach(el => el.classList.toggle('revealed', shouldReveal));
    updateBulkToggleBtnLabel();
}

function updateBulkToggleBtnLabel() {
    const btn = document.getElementById('bulk-toggle-btn');
    if (!btn) return;
    const containers = document.querySelectorAll('#list-container .a-container');
    const revealedCount = document.querySelectorAll('#list-container .a-container.revealed').length;
    btn.innerText = (containers.length > 0 && revealedCount === containers.length)
        ? '🙈 付箋をまとめて閉じる'
        : '👆 付箋をまとめてめくって答えを見る';
}

async function nextQuestion() {
    currentIndex++;
    await showQuestion();
}

async function prevQuestion() {
    if (currentIndex > 0) {
        currentIndex--;
        await showQuestion();
    }
}

async function setupListScreen() {
    document.getElementById('list-screen').style.display = 'block';
    const container = document.getElementById('list-container');
    const questions = getActiveSubjectQuestions();
    const myStars = getSessionStars(currentSubject);
    const myMemos = getSessionMemos(currentSubject);

    const htmlParts = questions.map((item, idx) => {
        const isStarred = myStars.includes(idx);
        const memoText = escapeHtml(myMemos[idx] || '');
        return `
            <div class="qa-card">
                <div class="card-header">
                    <div class="q-text">問 ${idx + 1}: ${escapeHtml(item.q)}</div>
                    <button class="star-btn ${isStarred ? 'active' : ''}" onclick="toggleStarList(${idx}, this)">★</button>
                </div>
                ${item.img ? `<img src="${escapeHtml(item.img)}" class="q-image" alt="問題の画像">` : ''}
                <div class="a-container" onclick="toggleAnswer(this)">
                    <div class="a-text">${escapeHtml(item.a)}</div>
                    <div class="fusen">
                        <span class="fusen-icon">👆</span>
                        <span class="fusen-main">付箋をタップして答えを見る</span>
                    </div>
                </div>
                <div class="memo-box">
                    <div class="memo-header">
                        <span class="memo-header-icon">✎</span>
                        <span class="memo-header-text">メモ</span>
                        <span class="memo-status" id="list-memo-status-${idx}"></span>
                    </div>
                    <textarea class="memo-textarea" autocomplete="off" id="list-memo-${idx}" placeholder="気づいたこと・覚え方のコツなどを書いておこう" oninput="onListMemoInput(${idx})" onblur="saveListMemoNow(${idx})">${memoText}</textarea>
                </div>
            </div>`;
    });

    container.innerHTML = htmlParts.join('');
    updateBulkToggleBtnLabel();
}

function onListMemoInput(idx) {
    const memoEl = document.getElementById('list-memo-' + idx);
    scheduleMemoSave('list-' + idx, () => saveMemoValue(idx, memoEl.value), 'list-memo-status-' + idx);
}

async function saveListMemoNow(idx) {
    const memoEl = document.getElementById('list-memo-' + idx);
    const key = 'list-' + idx;
    if (memoSaveTimers[key]) clearTimeout(memoSaveTimers[key]);
    await saveMemoValue(idx, memoEl.value);
    const statusEl = document.getElementById('list-memo-status-' + idx);
    if (statusEl) {
        statusEl.textContent = '✓ 保存しました';
        statusEl.classList.add('saved');
    }
}

function toggleStarList(originalIdx, btnEl) {
    const myStars = getSessionStars(currentSubject);
    const foundIdx = myStars.indexOf(originalIdx);
    if (foundIdx > -1) {
        myStars.splice(foundIdx, 1);
        btnEl.classList.remove('active');
    } else {
        myStars.push(originalIdx);
        btnEl.classList.add('active');
    }
    setSessionStars(currentSubject, myStars);
}

// --- 先生・管理者：生徒の★・メモの管理 ---
// 管理者は全員分、先生は自分の学年・学科の生徒だけ（Firestoreのルールでも同じ範囲に制限されている）
const DEPT_ORDER = ['環境システム科', '機械科', '電子情報技術科', '情報ビジネス科', '総合ビジネス科'];
const deptRank = (n) => { const i = DEPT_ORDER.indexOf(n); return i < 0 ? DEPT_ORDER.length : i; };

async function loadScopeStudents() {
    const q = isAdminSession
        ? db.collection('users')
        : db.collection('users').where('grade', '==', currentProfile.grade).where('className', '==', currentProfile.className);
    const snap = await q.get();
    const list = [];
    snap.forEach(doc => {
        const d = doc.data();
        if (d.role === 'student') list.push({ uid: doc.id, ...d });
    });
    list.sort((a, b) =>
        String(a.grade || '').localeCompare(String(b.grade || ''), 'ja') ||
        (deptRank(a.className) - deptRank(b.className)) ||
        String(a.className || '').localeCompare(String(b.className || ''), 'ja') ||
        (Number(a.attendanceNumber) || 0) - (Number(b.attendanceNumber) || 0));
    return list;
}

async function showAdminScreen() {
    if (!isManager) return;
    document.querySelectorAll('.window').forEach(el => el.style.display = 'none');
    document.getElementById('admin-screen').style.display = 'block';
    document.getElementById('admin-subject-name').innerText = getSubjectName(currentSubject);
    document.getElementById('admin-scope').innerText = isAdminSession ? '全学年・全学科' : `${currentProfile.grade} ${currentProfile.className}`;
    document.getElementById('admin-th-who').innerText = isAdminSession ? '学年・学科・出席番号' : '出席番号';

    const tbody = document.getElementById('admin-user-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#aaa;">読み込み中...</td></tr>';

    try {
        const students = await loadScopeStudents();
        if (students.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#aaa;">登録されている生徒はいません。</td></tr>';
            return;
        }
        const datas = [];
        for (let i = 0; i < students.length; i += 20) {
            const part = await Promise.all(students.slice(i, i + 20).map(s => dataRef(s.uid).get()));
            part.forEach(d => datas.push(d.exists ? d.data() : {}));
        }
        tbody.innerHTML = '';
        students.forEach((s, i) => {
            const d = datas[i] || {};
            const stars = (d.starred && d.starred[currentSubject]) || [];
            const memos = (d.memos && d.memos[currentSubject]) || {};
            const memoCount = Object.values(memos).filter(t => String(t || '').trim()).length;
            const num = `${Number(s.attendanceNumber) || s.attendanceNumber || '--'}番`;
            const who = isAdminSession ? `${escapeHtml(s.grade || '')} ${escapeHtml(s.className || '')} ${num}` : num;
            const label = escapeHtml(nameLabel(s));
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${who}</td>
                <td>${stars.length} 問</td>
                <td>${memoCount} 件</td>
                <td>
                    <button class="btn btn-sub" style="padding:5px 8px; font-size:11px; margin-bottom:4px;" data-act="stars" data-uid="${escapeHtml(s.uid)}" data-label="${label}">★リセット</button>
                    <button class="btn btn-sub" style="padding:5px 8px; font-size:11px;" data-act="memos" data-uid="${escapeHtml(s.uid)}" data-label="${label}">メモ消去</button>
                </td>`;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#aaa;">読み込みに失敗しました（Firestoreのルールが更新されているか確認してください）。</td></tr>';
    }
}

document.getElementById('admin-user-list').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'stars') adminResetUserStars(btn.dataset.uid, btn.dataset.label);
    else adminClearUserMemos(btn.dataset.uid, btn.dataset.label);
});

async function adminResetUserStars(uid, label) {
    if (!isManager) return;
    const subjectName = getSubjectName(currentSubject);
    const confirmed = await showCustomConfirm(`「${label}」の教科「${subjectName}」の★データだけをリセットします。他の教科・他の人には影響しません。よろしいですか？`, '★リセット');
    if (!confirmed) return;
    showLoading('リセット中...');
    try {
        await dataRef(uid).set({ starred: { [currentSubject]: [] } }, { merge: true });
        if (uid === currentUser) sessionStars[currentSubject] = [];
        hideLoading();
        await showCustomAlert(`「${label}」の★データ（${subjectName}）をリセットしました。`, 'リセット完了');
        await showAdminScreen();
    } catch (error) {
        hideLoading();
        console.error(error);
        await showCustomAlert('リセットに失敗しました。', 'エラー');
    }
}

async function adminClearUserMemos(uid, label) {
    if (!isManager) return;
    const subjectName = getSubjectName(currentSubject);
    const confirmed = await showCustomConfirm(`「${label}」の教科「${subjectName}」のメモを、すべてまとめて消去します。この操作は取り消せません。よろしいですか？`, 'メモ全消去');
    if (!confirmed) return;
    showLoading('消去中...');
    try {
        await dataRef(uid).set({ memos: { [currentSubject]: {} } }, { merge: true });
        if (uid === currentUser) sessionMemos[currentSubject] = {};
        hideLoading();
        await showCustomAlert(`「${label}」のメモ（${subjectName}）をすべて消去しました。`, '消去完了');
        await showAdminScreen();
    } catch (error) {
        hideLoading();
        console.error(error);
        await showCustomAlert('消去に失敗しました。', 'エラー');
    }
}

async function adminResetAllUsersStars() {
    if (!isManager) return;
    const subjectName = getSubjectName(currentSubject);
    const scope = isAdminSession ? '全学年・全学科' : `${currentProfile.grade} ${currentProfile.className}`;
    const confirmed = await showCustomConfirm(`【警告】現在の教科「${subjectName}」について、${scope}の生徒の★データをすべてリセットします。他の教科の★には影響しません。本当によろしいですか？`, '★の一括リセット');
    if (!confirmed) return;
    showLoading('リセット中...');
    try {
        const students = await loadScopeStudents();
        for (let i = 0; i < students.length; i += 20) {
            await Promise.all(students.slice(i, i + 20).map(s =>
                dataRef(s.uid).set({ starred: { [currentSubject]: [] } }, { merge: true })));
        }
        hideLoading();
        await showCustomAlert(`${students.length}人の★データ（${subjectName}）をリセットしました。`, '一括リセット完了');
        await showAdminScreen();
    } catch (error) {
        hideLoading();
        console.error(error);
        await showCustomAlert('一括リセットに失敗しました。', 'エラー');
    }
}

// --- キーボード操作（クイズ画面：→次、←前、Enterで答え） ---
document.addEventListener('keydown', function (e) {
    const tag = e.target.tagName;
    const quizScreen = document.getElementById('quiz-screen');
    if (quizScreen && quizScreen.style.display === 'block' && (currentMode === 1 || currentMode === 3)) {
        if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            document.getElementById('next-btn').click();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (!document.getElementById('prev-btn').disabled) document.getElementById('prev-btn').click();
        } else if (e.key === 'Enter' && tag !== 'BUTTON') {
            e.preventDefault();
            document.getElementById('quiz-a-container').click();
        }
    }
});

startApp();
