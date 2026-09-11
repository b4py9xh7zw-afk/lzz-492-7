/* API 封装与本地会话 */
const Store = {
  get token() { return localStorage.getItem('pw_token') || ''; },
  set token(v) { v ? localStorage.setItem('pw_token', v) : localStorage.removeItem('pw_token'); },
  get role() { return localStorage.getItem('pw_role') || ''; },
  set role(v) { v ? localStorage.setItem('pw_role', v) : localStorage.removeItem('pw_role'); },
  clear() { localStorage.removeItem('pw_token'); localStorage.removeItem('pw_role'); },
};

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  if (Store.token) opt.headers['Authorization'] = 'Bearer ' + Store.token;
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON（文件下载） */ }
  if (!res.ok) {
    if (res.status === 401) { Store.clear(); showLogin(); }
    throw new Error((data && data.error) || '请求失败 (' + res.status + ')');
  }
  return data ? data.data : null;
}

/* 带认证的文件下载（用 fetch 拿 blob，兼容 token header） */
async function downloadUrl(url, fallbackName) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + Store.token } });
  if (!res.ok) {
    let msg = '下载失败';
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  let name = fallbackName;
  const m = disp.match(/filename\*=UTF-8''([^;]+)/);
  if (m) name = decodeURIComponent(m[1]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

let toastTimer = null;
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function money(n) { return (Number(n) || 0).toFixed(2); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function thisMonth() { return todayStr().slice(0, 7); }

/* 把对象安全嵌入单引号 HTML 属性的 onclick 中 */
function attrJson(obj) {
  return JSON.stringify(obj).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
}
