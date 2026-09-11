/* ================= 管理端 ================= */
let currentPage = 'dashboard';
let cache = { workers: [], styles: [], dashboardDate: todayStr(), entryDate: todayStr(), subMonth: thisMonth() };

function goto(page) {
  currentPage = page;
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  render();
}

async function render() {
  const el = document.getElementById('admin-main');
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    if (currentPage === 'dashboard') await renderDashboard();
    else if (currentPage === 'entry') await renderEntry();
    else if (currentPage === 'styles') await renderStyles();
    else if (currentPage === 'workers') await renderWorkers();
    else if (currentPage === 'subsidy') await renderSubsidy();
    else if (currentPage === 'export') await renderExport();
    else if (currentPage === 'settings') await renderSettings();
  } catch (e) {
    el.innerHTML = `<div class="card inline-msg err">加载失败：${esc(e.message)}</div>`;
  }
}

async function loadBase() {
  const [w, s] = await Promise.all([api('GET', '/api/workers'), api('GET', '/api/styles')]);
  cache.workers = w;
  cache.styles = s;
}
function workerName(id) { const w = cache.workers.find((x) => x.id === id); return w ? w.name : '?'; }
function workerCode(id) { const w = cache.workers.find((x) => x.id === id); return w ? w.code : '?'; }

/* ---------- 今日看板 ---------- */
async function renderDashboard() {
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head">
      <div><h2>今日生产看板</h2><div class="sub">按返工 / 缺料 / 质检不过分类统计产量与工资</div></div>
      <div class="flex">
        <input type="date" id="dash-date" value="${cache.dashboardDate}" style="width:160px">
        <button class="btn" onclick="loadDashboard()">刷新</button>
      </div>
    </div>
    <div id="dash-body"><div class="empty">加载中…</div></div>`;
  document.getElementById('dash-date').onchange = (e) => { cache.dashboardDate = e.target.value; loadDashboard(); };
  await loadDashboard();
}
async function loadDashboard() {
  const body = document.getElementById('dash-body');
  const d = await api('GET', '/api/dashboard?date=' + cache.dashboardDate);
  const t = d.totals;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat ok"><div class="label">合格产量（件）</div><div class="value">${t.ok}</div></div>
      <div class="stat rework"><div class="label">返工（件）</div><div class="value">${t.rework}</div></div>
      <div class="stat shortage"><div class="label">缺料（件）</div><div class="value">${t.shortage}</div></div>
      <div class="stat qcfail"><div class="label">质检不过（件）</div><div class="value">${t.qcfail}</div></div>
      <div class="stat piece"><div class="label">当日计件工资</div><div class="value">${money(t.piece)}<span class="unit"> 元</span></div></div>
      <div class="stat shortage"><div class="label">当日补贴合计</div><div class="value">${money(t.shSub + t.manualSub)}<span class="unit"> 元</span></div></div>
    </div>
    <div class="card">
      <h3>🏆 工人产量排行（当日）</h3>
      <div class="table-wrap">
      <table>
        <thead><tr><th>排名</th><th>工号</th><th>姓名</th><th class="num">合格</th><th class="num">返工</th><th class="num">缺料</th><th class="num">质检不过</th><th class="num">计件工资</th><th class="num">缺料补贴</th></tr></thead>
        <tbody>
        ${d.workers.length === 0 ? '<tr><td colspan="9" class="empty">当天暂无录入</td></tr>' :
          d.workers.map((w, i) => `<tr>
            <td>${i + 1}</td><td>${esc(w.workerCode)}</td><td><b>${esc(w.workerName)}</b></td>
            <td class="num" style="color:var(--green);font-weight:600">${w.ok}</td>
            <td class="num" style="color:var(--orange)">${w.rework}</td>
            <td class="num" style="color:var(--purple)">${w.shortage}</td>
            <td class="num" style="color:var(--red)">${w.qcfail}</td>
            <td class="num"><b>${money(w.piece)}</b></td>
            <td class="num" style="color:var(--purple)">${money(w.shSub)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>
    <div class="card">
      <h3>🧵 工序产量分布</h3>
      <div class="table-wrap">
      <table>
        <thead><tr><th>款号</th><th>工序</th><th class="num">合格</th><th class="num">返工</th><th class="num">缺料</th><th class="num">质检不过</th></tr></thead>
        <tbody>
        ${d.styles.length === 0 ? '<tr><td colspan="6" class="empty">当天暂无录入</td></tr>' :
          d.styles.map((s) => `<tr>
            <td><b>${esc(s.styleNo)}</b></td><td>${esc(s.process)}</td>
            <td class="num" style="color:var(--green);font-weight:600">${s.ok}</td>
            <td class="num" style="color:var(--orange)">${s.rework}</td>
            <td class="num" style="color:var(--purple)">${s.shortage}</td>
            <td class="num" style="color:var(--red)">${s.qcfail}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

/* ---------- 产量录入 ---------- */
async function renderEntry() {
  await loadBase();
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head">
      <div><h2>产量录入</h2><div class="sub">选择工人、款号工序，录入完成数；同一组合重复录入将覆盖更新</div></div>
      <input type="date" id="entry-date" value="${cache.entryDate}" style="width:160px"
             onchange="cache.entryDate=this.value;loadEntryTable()">
    </div>
    <div class="card">
      <h3>➕ 新增 / 修改一条产量</h3>
      <div class="form-grid">
        <div><label>工人</label><select id="f-worker">${cache.workers.map((w) => `<option value="${w.id}">${esc(w.code)} ${esc(w.name)}</option>`).join('')}</select></div>
        <div class="span-2"><label>款号 / 工序（工价 / 缺料补贴单价）</label>
          <select id="f-style">${cache.styles.filter((s) => s.active).map((s) =>
            `<option value="${s.id}">${esc(s.styleNo)} · ${esc(s.process)}　计件 ¥${money(s.price)}　缺料补贴 ¥${money(s.shortageRate)}/件</option>`).join('')}</select>
        </div>
        <div><label>合格数（计工资）</label><input id="f-ok" type="number" min="0" step="1" placeholder="0"></div>
        <div><label>返工数（不计件）</label><input id="f-rework" type="number" min="0" step="1" placeholder="0"></div>
        <div><label>缺料数（计补贴）</label><input id="f-shortage" type="number" min="0" step="1" placeholder="0"></div>
        <div><label>质检不过（不计件）</label><input id="f-qcfail" type="number" min="0" step="1" placeholder="0"></div>
      </div>
      <div class="flex">
        <button class="btn btn-primary" onclick="submitRecord()">保存录入</button>
        <span id="entry-msg" class="inline-msg"></span>
      </div>
    </div>
    <div class="card">
      <h3>📄 当天录入明细 <span class="muted" style="font-weight:400;font-size:12px">（工资按记录时工价快照计算）</span></h3>
      <div class="table-wrap"><div id="entry-table">加载中…</div></div>
    </div>`;
  await loadEntryTable();
}
async function loadEntryTable() {
  const box = document.getElementById('entry-table');
  if (!box) return;
  const recs = await api('GET', '/api/records?date=' + cache.entryDate);
  box.innerHTML = `<table>
    <thead><tr><th>工号</th><th>姓名</th><th>款号</th><th>工序</th><th class="num">工价</th>
      <th class="num">合格</th><th class="num">返工</th><th class="num">缺料</th><th class="num">质检不过</th>
      <th class="num">计件工资</th><th class="num">缺料补贴</th><th>操作</th></tr></thead>
    <tbody>
    ${recs.length === 0 ? '<tr><td colspan="12" class="empty">当天暂无记录</td></tr>' : recs.map((r) => `<tr>
      <td>${esc(r.workerCode)}</td><td>${esc(r.workerName)}</td>
      <td><b>${esc(r.styleNo)}</b></td><td>${esc(r.process)}</td>
      <td class="num">¥${money(r.priceSnapshot)}${r.priceNow !== null && Number(r.priceNow) !== Number(r.priceSnapshot) ? ' <span class="tag tag-gray">现价¥'+money(r.priceNow)+'</span>' : ''}</td>
      <td class="num" style="color:var(--green);font-weight:600">${r.ok}</td>
      <td class="num" style="color:var(--orange)">${r.rework}</td>
      <td class="num" style="color:var(--purple)">${r.shortage}</td>
      <td class="num" style="color:var(--red)">${r.qcfail}</td>
      <td class="num"><b>${money(r.pieceWage)}</b></td>
      <td class="num" style="color:var(--purple)">${money(r.shortageSubsidy)}</td>
      <td>
        <button class="btn btn-sm" onclick='editRecord(${attrJson(r)})'>编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delRecord('${r.id}')">删除</button>
      </td></tr>`).join('')}
    </tbody></table>`;
}
function setEntryMsg(msg, ok2) {
  const m = document.getElementById('entry-msg');
  m.textContent = msg; m.className = 'inline-msg ' + (ok2 ? 'ok' : 'err');
  setTimeout(() => { m.textContent = ''; m.className = 'inline-msg'; }, 3000);
}
async function submitRecord() {
  try {
    const body = {
      date: cache.entryDate,
      workerId: document.getElementById('f-worker').value,
      styleId: document.getElementById('f-style').value,
      ok: document.getElementById('f-ok').value || 0,
      rework: document.getElementById('f-rework').value || 0,
      shortage: document.getElementById('f-shortage').value || 0,
      qcfail: document.getElementById('f-qcfail').value || 0,
    };
    await api('POST', '/api/records', body);
    ['f-ok', 'f-rework', 'f-shortage', 'f-qcfail'].forEach((id) => document.getElementById(id).value = '');
    setEntryMsg('保存成功', true);
    await loadEntryTable();
  } catch (e) { setEntryMsg(e.message, false); }
}
function editRecord(r) {
  document.getElementById('f-worker').value = r.workerId;
  document.getElementById('f-style').value = r.styleId;
  document.getElementById('f-ok').value = r.ok;
  document.getElementById('f-rework').value = r.rework;
  document.getElementById('f-shortage').value = r.shortage;
  document.getElementById('f-qcfail').value = r.qcfail;
  toast('已载入该记录，修改后点击“保存录入”即可覆盖');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function delRecord(id) {
  if (!confirm('确定删除这条产量记录？对应工资预估会同步变化。')) return;
  try { await api('DELETE', '/api/records/' + id); toast('已删除'); await loadEntryTable(); }
  catch (e) { toast(e.message, true); }
}

/* ---------- 款号工序工价 ---------- */
async function renderStyles() {
  await loadBase();
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head"><div><h2>款号 · 工序 · 工价</h2><div class="sub">工价修改只影响之后的录入，历史记录保留当时工价</div></div></div>
    <div class="card">
      <h3>➕ 新增款号工序</h3>
      <div class="form-grid">
        <div><label>款号</label><input id="s-styleNo" placeholder="如 K-8801"></div>
        <div><label>工序</label><input id="s-process" placeholder="如 前片拼缝"></div>
        <div><label>计件工价（元/件合格）</label><input id="s-price" type="number" min="0" step="0.01" placeholder="0.85"></div>
        <div><label>缺料补贴单价（元/件缺料）</label><input id="s-rate" type="number" min="0" step="0.01" placeholder="0.10"></div>
      </div>
      <div class="flex"><button class="btn btn-primary" onclick="addStyle()">新增</button><span id="s-msg" class="inline-msg"></span></div>
    </div>
    <div class="card"><div class="table-wrap">
      <table>
        <thead><tr><th>款号</th><th>工序</th><th class="num">计件工价</th><th class="num">缺料补贴单价</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${cache.styles.map((s) => `<tr>
          <td><b>${esc(s.styleNo)}</b></td><td>${esc(s.process)}</td>
          <td class="num">¥${money(s.price)}</td><td class="num" style="color:var(--purple)">¥${money(s.shortageRate)}</td>
          <td>${s.active ? '<span class="tag tag-green">启用中</span>' : '<span class="tag tag-gray">已停用</span>'}</td>
          <td>
            <button class="btn btn-sm" onclick='openStyleModal(${attrJson(s)})'>编辑</button>
            <button class="btn btn-sm ${s.active ? 'btn-danger' : ''}" onclick="toggleStyle('${s.id}', ${!s.active})">${s.active ? '停用' : '启用'}</button>
          </td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}
function setSMsg(msg, isErr) {
  const m = document.getElementById('s-msg');
  m.textContent = msg; m.className = 'inline-msg ' + (isErr ? 'err' : 'ok');
  setTimeout(() => { m.textContent = ''; }, 3000);
}
async function addStyle() {
  try {
    await api('POST', '/api/styles', {
      styleNo: document.getElementById('s-styleNo').value,
      process: document.getElementById('s-process').value,
      price: document.getElementById('s-price').value,
      shortageRate: document.getElementById('s-rate').value || 0,
    });
    toast('新增成功'); render();
  } catch (e) { setSMsg(e.message, true); }
}
async function toggleStyle(id, active) {
  try { await api('PUT', '/api/styles/' + id, { active }); render(); }
  catch (e) { toast(e.message, true); }
}
function openStyleModal(s) {
  showModal(`编辑款号工序`, `
    <div class="form-group"><label>款号</label><input id="m-styleNo" value="${esc(s.styleNo)}"></div>
    <div class="form-group"><label>工序</label><input id="m-process" value="${esc(s.process)}"></div>
    <div class="form-group"><label>计件工价（元）</label><input id="m-price" type="number" min="0" step="0.01" value="${s.price}"></div>
    <div class="form-group"><label>缺料补贴单价（元）</label><input id="m-rate" type="number" min="0" step="0.01" value="${s.shortageRate}"></div>
    <div class="actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveStyle('${s.id}')">保存</button>
    </div>`);
}
async function saveStyle(id) {
  try {
    await api('PUT', '/api/styles/' + id, {
      styleNo: document.getElementById('m-styleNo').value,
      process: document.getElementById('m-process').value,
      price: document.getElementById('m-price').value,
      shortageRate: document.getElementById('m-rate').value,
    });
    closeModal(); toast('已保存'); render();
  } catch (e) { toast(e.message, true); }
}

/* ---------- 工人管理 ---------- */
async function renderWorkers() {
  await loadBase();
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head"><div><h2>工人管理</h2><div class="sub">工人用工号 + 密码登录手机端，仅能查看本人工资</div></div></div>
    <div class="card">
      <h3>➕ 新增工人</h3>
      <div class="form-grid">
        <div><label>工号</label><input id="w-code" placeholder="如 A006"></div>
        <div><label>姓名</label><input id="w-name" placeholder="姓名"></div>
        <div><label>初始密码</label><input id="w-pin" placeholder="默认 1234"></div>
      </div>
      <div class="flex"><button class="btn btn-primary" onclick="addWorker()">新增</button><span id="w-msg" class="inline-msg"></span></div>
    </div>
    <div class="card"><div class="table-wrap">
      <table>
        <thead><tr><th>工号</th><th>姓名</th><th>操作</th></tr></thead>
        <tbody>${cache.workers.map((w) => `<tr>
          <td><b>${esc(w.code)}</b></td><td>${esc(w.name)}</td>
          <td>
            <button class="btn btn-sm" onclick='openWorkerModal(${attrJson(w)})'>编辑 / 改密码</button>
            <button class="btn btn-sm btn-danger" onclick="delWorker('${w.id}')">删除</button>
          </td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}
function setWMsg(msg, isErr) {
  const m = document.getElementById('w-msg');
  m.textContent = msg; m.className = 'inline-msg ' + (isErr ? 'err' : 'ok');
  setTimeout(() => { m.textContent = ''; }, 3000);
}
async function addWorker() {
  try {
    await api('POST', '/api/workers', {
      code: document.getElementById('w-code').value,
      name: document.getElementById('w-name').value,
      pin: document.getElementById('w-pin').value || '1234',
    });
    toast('新增成功'); render();
  } catch (e) { setWMsg(e.message, true); }
}
function openWorkerModal(w) {
  showModal('编辑工人', `
    <div class="form-group"><label>工号</label><input id="mw-code" value="${esc(w.code)}"></div>
    <div class="form-group"><label>姓名</label><input id="mw-name" value="${esc(w.name)}"></div>
    <div class="form-group"><label>新密码（不改请留空）</label><input id="mw-pin" placeholder="留空保持不变"></div>
    <div class="actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveWorker('${w.id}')">保存</button>
    </div>`);
}
async function saveWorker(id) {
  try {
    const body = {
      code: document.getElementById('mw-code').value,
      name: document.getElementById('mw-name').value,
    };
    const pin = document.getElementById('mw-pin').value;
    if (pin) body.pin = pin;
    await api('PUT', '/api/workers/' + id, body);
    closeModal(); toast('已保存'); render();
  } catch (e) { toast(e.message, true); }
}
async function delWorker(id) {
  if (!confirm('确定删除该工人？有历史记录的工人无法删除。')) return;
  try { await api('DELETE', '/api/workers/' + id); toast('已删除'); render(); }
  catch (e) { toast(e.message, true); }
}

/* ---------- 补贴登记 ---------- */
async function renderSubsidy() {
  await loadBase();
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head">
      <div><h2>补贴登记</h2><div class="sub">全勤奖、加班补贴、餐补等手工补贴；缺料补贴由产量自动计算</div></div>
      <input type="month" id="sub-month" value="${cache.subMonth}" style="width:170px"
             onchange="cache.subMonth=this.value;loadSubTable()">
    </div>
    <div class="card">
      <h3>➕ 新增手工补贴</h3>
      <div class="form-grid">
        <div><label>日期</label><input id="b-date" type="date" value="${todayStr()}"></div>
        <div><label>工人</label><select id="b-worker">${cache.workers.map((w) => `<option value="${w.id}">${esc(w.code)} ${esc(w.name)}</option>`).join('')}</select></div>
        <div><label>补贴类型</label>
          <select id="b-type">
            <option>全勤奖</option><option>加班补贴</option><option>餐补</option>
            <option>交通补贴</option><option>岗位补贴</option><option>其他补贴</option>
          </select></div>
        <div><label>金额（元）</label><input id="b-amount" type="number" min="0" step="0.01" placeholder="0.00"></div>
        <div class="span-2"><label>说明</label><input id="b-reason" placeholder="选填，如 8月全勤"></div>
      </div>
      <div class="flex"><button class="btn btn-primary" onclick="addSubsidy()">登记补贴</button><span id="b-msg" class="inline-msg"></span></div>
    </div>
    <div class="card"><h3>📄 ${cache.subMonth} 手工补贴列表</h3>
      <div class="table-wrap"><div id="sub-table">加载中…</div></div>
    </div>`;
  await loadSubTable();
}
async function loadSubTable() {
  const box = document.getElementById('sub-table');
  const items = await api('GET', '/api/subsidies?month=' + cache.subMonth);
  const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
  box.innerHTML = `
    <table>
      <thead><tr><th>日期</th><th>工号</th><th>姓名</th><th>类型</th><th>说明</th><th class="num">金额</th><th>操作</th></tr></thead>
      <tbody>
      ${items.length === 0 ? '<tr><td colspan="7" class="empty">本月暂无手工补贴</td></tr>' : items.map((x) => `<tr>
        <td>${x.date}</td><td>${esc(x.workerCode)}</td><td>${esc(x.workerName)}</td>
        <td><span class="tag tag-purple">${esc(x.type)}</span></td><td class="muted">${esc(x.reason)}</td>
        <td class="num"><b>${money(x.amount)}</b></td>
        <td><button class="btn btn-sm btn-danger" onclick="delSubsidy('${x.id}')">删除</button></td>
      </tr>`).join('')}
      </tbody>
      ${items.length ? `<tfoot><tr><td colspan="5" class="right"><b>合计</b></td><td class="num"><b>${money(total)} 元</b></td><td></td></tr></tfoot>` : ''}
    </table>`;
}
function setBMsg(msg, isErr) {
  const m = document.getElementById('b-msg');
  m.textContent = msg; m.className = 'inline-msg ' + (isErr ? 'err' : 'ok');
  setTimeout(() => { m.textContent = ''; }, 3000);
}
async function addSubsidy() {
  try {
    await api('POST', '/api/subsidies', {
      date: document.getElementById('b-date').value,
      workerId: document.getElementById('b-worker').value,
      type: document.getElementById('b-type').value,
      amount: document.getElementById('b-amount').value,
      reason: document.getElementById('b-reason').value,
    });
    document.getElementById('b-amount').value = '';
    document.getElementById('b-reason').value = '';
    setBMsg('登记成功', false);
    await loadSubTable();
  } catch (e) { setBMsg(e.message, true); }
}
async function delSubsidy(id) {
  if (!confirm('确定删除该补贴？')) return;
  try { await api('DELETE', '/api/subsidies/' + id); toast('已删除'); loadSubTable(); }
  catch (e) { toast(e.message, true); }
}

/* ---------- 月底导出 ---------- */
let expMonth = thisMonth();
async function renderExport() {
  // 预统计
  const [pieceRes, subRes] = await Promise.all([
    fetch('/api/export/piece.csv?month=' + expMonth, { headers: { Authorization: 'Bearer ' + Store.token } }),
    fetch('/api/export/subsidy.csv?month=' + expMonth, { headers: { Authorization: 'Bearer ' + Store.token } }),
  ]);
  const pieceText = pieceRes.ok ? await pieceRes.text() : '';
  const subText = subRes.ok ? await subRes.text() : '';
  const countLines = (t) => t ? t.trim().split(/\r?\n/).length - 1 : 0;

  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head"><div><h2>月底导出</h2><div class="sub">普通计件与补贴分开导出，便于核对与存档</div></div></div>
    <div class="card">
      <div class="flex" style="margin-bottom:16px">
        <label style="margin:0">工资月份</label>
        <input type="month" id="exp-month" value="${expMonth}" style="width:170px"
               onchange="expMonth=this.value;renderExport()">
      </div>
      <div class="stat-grid">
        <div class="stat piece"><div class="label">计件记录条数</div><div class="value">${dbRecordsCount(pieceText)}</div></div>
        <div class="stat shortage"><div class="label">补贴记录条数</div><div class="value">${dbRecordsCount(subText)}</div></div>
      </div>
    </div>
    <div class="card">
      <h3>📥 下载（推荐分开下载）</h3>
      <p class="muted" style="margin-bottom:14px;font-size:13px">
        ① 普通计件明细 CSV：日期/工号/姓名/款号/工序/工价/合格数/返工/缺料/质检不过/计件工资，末尾附工人汇总<br>
        ② 补贴明细 CSV：缺料补贴（按缺料数×单价自动生成）与手工补贴分开列明，末尾附工人汇总
      </p>
      <div class="flex">
        <button class="btn btn-primary" onclick="doExport('piece.csv')">① 导出普通计件（CSV）</button>
        <button class="btn btn-primary" style="background:var(--purple);border-color:var(--purple)" onclick="doExport('subsidy.csv')">② 导出补贴（CSV）</button>
      </div>
    </div>
    <div class="card">
      <h3>📘 合并工作簿（备选）</h3>
      <p class="muted" style="margin-bottom:14px;font-size:13px">
        一个 .xls 文件内含「普通计件」「补贴」两个工作表，可用 Excel / WPS 直接打开。
      </p>
      <button class="btn" onclick="doExport('payroll.xls')">导出双工作表 Excel（.xls）</button>
    </div>
    <div class="card">
      <h3>👁 预览（前 8 行）</h3>
      <div class="flex" style="align-items:flex-start;gap:16px">
        <div style="flex:1;min-width:260px">
          <b style="font-size:13px">普通计件</b>
          <pre style="white-space:pre-wrap;background:#f7f9fc;border-radius:8px;padding:10px;font-size:12px;margin-top:6px;max-height:240px;overflow:auto">${esc(previewLines(pieceText, 8))}</pre>
        </div>
        <div style="flex:1;min-width:260px">
          <b style="font-size:13px">补贴</b>
          <pre style="white-space:pre-wrap;background:#f7f9fc;border-radius:8px;padding:10px;font-size:12px;margin-top:6px;max-height:240px;overflow:auto">${esc(previewLines(subText, 8))}</pre>
        </div>
      </div>
    </div>`;
}
function dbRecordsCount(csvText) {
  // 统计到第一个空行为止的数据行数
  if (!csvText) return 0;
  const lines = csvText.replace(/^﻿/, '').trim().split(/\r?\n/);
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') break;
    n++;
  }
  return n;
}
function previewLines(text, n) {
  if (!text) return '（无数据）';
  return text.replace(/^﻿/, '').split(/\r?\n/).slice(0, n).join('\n');
}
async function doExport(kind) {
  try {
    await downloadUrl('/api/export/' + kind + '?month=' + expMonth);
    toast('已开始下载');
  } catch (e) { toast(e.message, true); }
}

/* ---------- 设置 ---------- */
async function renderSettings() {
  const s = await api('GET', '/api/settings');
  const el = document.getElementById('admin-main');
  el.innerHTML = `
    <div class="page-head"><div><h2>系统设置</h2></div></div>
    <div class="card" style="max-width:560px">
      <h3>💰 工资规则</h3>
      <div class="form-group">
        <label>缺料补贴</label>
        <div class="flex">
          <select id="set-sh" style="width:160px">
            <option value="1" ${s.shortageSubsidyEnabled ? 'selected' : ''}>开启（缺料数×单价计补贴）</option>
            <option value="0" ${!s.shortageSubsidyEnabled ? 'selected' : ''}>关闭</option>
          </select>
        </div>
      </div>
      <div class="form-grid">
        <div><label>返工每件单价（元，默认0=不计工资）</label><input id="set-rw" type="number" min="0" step="0.01" value="${s.reworkPay}"></div>
        <div><label>质检不过每件单价（元，默认0=不计工资）</label><input id="set-qc" type="number" min="0" step="0.01" value="${s.qcfailPay}"></div>
      </div>
      <button class="btn btn-primary" onclick="saveRules()">保存工资规则</button>
      <span id="set-msg1" class="inline-msg"></span>
      <p class="muted" style="font-size:12px;margin-top:10px">
        规则说明：合格产量 × 工序工价 = 计件工资；返工、质检不过默认不产生工资（仍统计数量）；
        缺料不计件，按工序缺料补贴单价计入“补贴”。历史记录保存工价/补贴单价快照，改价不改旧账。
      </p>
    </div>
    <div class="card" style="max-width:560px">
      <h3>🔑 修改管理员密码</h3>
      <div class="form-group" style="max-width:300px"><label>新密码（至少4位）</label><input id="set-pwd" type="password"></div>
      <button class="btn btn-primary" onclick="savePassword()">修改密码</button>
      <span id="set-msg2" class="inline-msg"></span>
    </div>`;
}
function setMsg(id, msg, isErr) {
  const m = document.getElementById(id);
  m.textContent = msg; m.className = 'inline-msg ' + (isErr ? 'err' : 'ok');
  setTimeout(() => { m.textContent = ''; }, 3000);
}
async function saveRules() {
  try {
    await api('PUT', '/api/settings', {
      shortageSubsidyEnabled: document.getElementById('set-sh').value === '1',
      reworkPay: document.getElementById('set-rw').value,
      qcfailPay: document.getElementById('set-qc').value,
    });
    setMsg('set-msg1', '已保存', false);
  } catch (e) { setMsg('set-msg1', e.message, true); }
}
async function savePassword() {
  const p = document.getElementById('set-pwd').value;
  if (!p) return setMsg('set-msg2', '请输入新密码', true);
  try {
    await api('PUT', '/api/settings', { adminPassword: p });
    document.getElementById('set-pwd').value = '';
    setMsg('set-msg2', '密码已修改', false);
  } catch (e) { setMsg('set-msg2', e.message, true); }
}

/* ---------- 通用弹窗 ---------- */
function showModal(title, inner) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-mask show" onclick="if(event.target===this)closeModal()">
      <div class="modal"><h3>${esc(title)}</h3>${inner}</div>
    </div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
