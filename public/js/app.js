/* ================= 视图切换 / 启动 ================= */
function showLogin() {
  clearInterval(workerTimer);
  document.getElementById('view-login').style.display = '';
  document.getElementById('view-admin').style.display = 'none';
  document.getElementById('view-worker').style.display = 'none';
  switchLogin(loginRole || 'admin');
}
function showAdmin() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-admin').style.display = '';
  document.getElementById('view-worker').style.display = 'none';
  goto('dashboard');
}

(async function init() {
  if (Store.token) {
    // 用各自的 me 接口校验 token 是否仍有效；admin 用 settings 校验
    try {
      if (Store.role === 'worker') {
        await api('GET', '/api/worker/me');
        showWorker();
        return;
      } else {
        await api('GET', '/api/settings');
        showAdmin();
        return;
      }
    } catch {
      Store.clear();
    }
  }
  showLogin();
})();
