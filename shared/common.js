// 入口（ログイン）・CBT など、アプリ共通の部品：ダイアログ・読み込み表示・ログイン情報の受け渡し
const $ = (id) => document.getElementById(id);
const PERSIST_KEY = 'app_login_persistence';   // ログイン状態の保存方法（local＝この端末に保存／none＝このタブだけ）
const PROFILE_KEY = 'app_profile';             // このタブで読み込んだ自分の情報（アプリを行き来するとき、読み直さないため）
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let auth = null;
let db = null;
let persistenceReady = Promise.resolve();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function showAppDialog(title, message, options = {}) {
    return new Promise((resolve) => {
        const modal = $('appDialog');
        const cancel = $('appDialogCancel');
        const ok = $('appDialogOk');
        $('appDialogTitle').textContent = title || '確認';
        $('appDialogMessage').textContent = message || '';
        cancel.classList.toggle('hidden', !options.cancel);
        cancel.textContent = options.cancelText || 'キャンセル';
        ok.textContent = options.okText || 'OK';
        const finish = (value) => {
            modal.classList.add('hidden');
            ok.onclick = null; cancel.onclick = null;
            resolve(value);
        };
        ok.onclick = () => finish(true);
        cancel.onclick = () => finish(false);
        modal.classList.remove('hidden');
        ok.focus();
    });
}
const showAlert = (message, title = 'お知らせ') => showAppDialog(title, message);
const showConfirm = (message, title = '確認', options = {}) => showAppDialog(title, message, { cancel: true, cancelText: options.cancelText || 'キャンセル', okText: options.okText || 'OK' });

// 読み込み表示：一瞬で終わるときは出さず、0.3秒以上かかるときだけ出す。immediate=true なら、すぐ出す
let loadingTimer = null;
function showLoading(message = '読み込み中…', immediate = false) {
    $('loadingText').textContent = message;
    clearTimeout(loadingTimer);
    const show = () => $('loadingOverlay').classList.remove('hidden');
    if (immediate) show(); else loadingTimer = setTimeout(show, 300);
}
function hideLoading() { clearTimeout(loadingTimer); $('loadingOverlay').classList.add('hidden'); }
window.addEventListener('pageshow', (e) => { if (e.persisted) hideLoading(); });   // ブラウザの「戻る」で戻ったとき、読み込み表示が残らないように
function setInlineLoading(el, message = '読み込み中…') { el.innerHTML = `<span class="loading-inline"><span class="loading-spinner"></span><span>${escapeHtml(message)}</span></span>`; }

// 「1年 情報ビジネス科 5番さん」の形で表示する（ユーザーIDは表示しない）
function nameLabel(p) {
    const n = Number(p.attendanceNumber);
    return [p.grade, p.className, `${Number.isNaN(n) || p.attendanceNumber === '' ? (p.attendanceNumber || '') : n}番さん`].filter(Boolean).join(' ');
}
const tsMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);

// users/{uid} の内容から、アプリで使う「自分の情報」を作る
function accountFrom(profile, user) {
    return {
        userId: profile.userId, role: profile.role, name: profile.name || '',
        attendanceNumber: profile.attendanceNumber || '',
        grade: profile.grade || '', className: profile.className || '',
        email: user && user.email ? user.email : (profile.email || ''),
        pwChangedAt: tsMs(profile.pwChangedAt),
    };
}
function cacheAccount(uid, account) {
    try { sessionStorage.setItem(PROFILE_KEY, JSON.stringify({ uid, profile: account })); } catch (e) { /* なくてよい */ }
}
function cachedAccount(uid) {
    try { const c = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null'); return c && c.uid === uid && c.profile ? c.profile : null; } catch (e) { return null; }
}
function clearCachedAccount() { try { sessionStorage.removeItem(PROFILE_KEY); } catch (e) { /* なくてよい */ } }

// Firebase を準備する（設定が入っていなければ false）
function startFirebase() {
    const cfg = window.FIREBASE_CONFIG;
    if (typeof firebase === 'undefined' || !cfg || String(cfg.apiKey).startsWith('YOUR_')) return false;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    // 保存設定はログイン情報そのものではなく、保存方法だけをlocalStorageに保持する。
    const pref = localStorage.getItem(PERSIST_KEY);
    persistenceReady = auth.setPersistence(pref === 'local' ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION).catch(() => {});
    return true;
}

// あとから作られる入力欄も含め、すべて autocomplete をオフにする
function disableAutocomplete() {
    const off = (root) => root.querySelectorAll('input,select,textarea').forEach((el) => el.setAttribute('autocomplete', 'off'));
    off(document);
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) n.setAttribute('autocomplete', 'off'); off(n); } })))
        .observe(document.body, { childList: true, subtree: true });
}

// 数字だけの入力欄：入力した瞬間に、半角数字に直し、min〜max の範囲に収める（max は関数で渡す＝あとから変わってもよい）
// 入力欄から外れたとき、空や範囲外なら、最初の値（なければ下限）→上限・下限の順に自動で直す
function limitNumberInput(input, getMax, min = 1) {
    const clean = () => input.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
    const clamp = (n) => Math.min(getMax(), Math.max(min, n));
    const fix = () => {
        let v = clean();
        if (v !== '') v = getMax() < min ? '' : String(clamp(Number(v)));
        if (input.value !== v) input.value = v;
    };
    const fixOnBlur = () => {
        const v = clean();
        if (getMax() < min) { input.value = ''; return; }
        const fallback = Number(input.defaultValue) || min;
        input.value = String(clamp(v === '' ? fallback : Number(v)));
    };
    input.addEventListener('input', (e) => { if (!e.isComposing) fix(); });
    input.addEventListener('compositionend', fix);
    input.addEventListener('blur', fixOnBlur);
    return fix;
}
