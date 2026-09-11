let loginRole = 'admin';

function switchLogin(role) {
  loginRole = role;
  document.getElementById('tab-admin').classList.toggle('active', role === 'admin');
  document.getElementById('tab-worker').classList.toggle('active', role === 'worker');
  document.getElementById('field-code').style.display = role === 'worker' ? '' : 'none';
  document.getElementById('login-pwd-label').textContent = role === 'worker' ? '密码' : '管理员密码';
  document.getElementById('login-pin').placeholder = role === 'worker' ? '默认 1234' : '默认 123456';
  document.getElementById('login-msg').style.display = 'none';
}

async function doLogin(e) {
  e.preventDefault();
  const msgEl = document.getElementById('login-msg');
  msgEl.style.display = 'none';
  try {
    if (loginRole === 'admin') {
      const r = await api('POST', '/api/admin/login', { password: document.getElementById('login-pin').value });
      Store.token = r.token; Store.role = 'admin';
      showAdmin();
    } else {
      const r = await api('POST', '/api/worker/login', {
        code: document.getElementById('login-code').value.trim(),
        pin: document.getElementById('login-pin').value.trim(),
      });
      Store.token = r.token; Store.role = 'worker';
      showWorker();
    }
    document.getElementById('login-form').reset();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.style.display = '';
  }
  return false;
}

async function logout() {
  try { await api('POST', '/api/logout'); } catch {}
  Store.clear();
  showLogin();
}
