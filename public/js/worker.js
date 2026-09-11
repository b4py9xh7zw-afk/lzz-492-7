/* ================= 工人手机端 ================= */
let workerTimer = null;

async function showWorker() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-admin').style.display = 'none';
  document.getElementById('view-worker').style.display = '';
  await loadWorkerData();
  clearInterval(workerTimer);
  workerTimer = setInterval(loadWorkerData, 60000); // 每分钟自动刷新
}

async function loadWorkerData() {
  try {
    const d = await api('GET', '/api/worker/me');
    document.getElementById('w-name').textContent = d.worker.name + '（' + d.worker.code + '）';
    document.getElementById('w-date').textContent = d.date + ' · 今日工资预估';

    document.getElementById('w-total').textContent = money(d.todayWage.total);
    document.getElementById('w-piece').textContent = money(d.todayWage.piece);
    document.getElementById('w-shsub').textContent = money(d.todayWage.shortageSubsidy);
    document.getElementById('w-manual').textContent = money(d.todayWage.manualSubsidy);

    document.getElementById('m-piece').textContent = money(d.monthWage.piece) + ' 元';
    document.getElementById('m-shsub').textContent = money(d.monthWage.shortageSubsidy) + ' 元';
    document.getElementById('m-manual').textContent = money(d.monthWage.manualSubsidy) + ' 元';
    document.getElementById('m-total').textContent = money(d.monthWage.total) + ' 元';

    const box = document.getElementById('w-records');
    if (!d.records.length) {
      box.innerHTML = '<div class="empty">今天还没有产量记录<br>请找组长确认录入情况</div>';
    } else {
      box.innerHTML = d.records.map((r) => `
        <div class="rec-card">
          <div class="r-top">
            <div>
              <div class="r-style">${esc(r.styleNo)}</div>
              <div class="r-process">${esc(r.process)}</div>
            </div>
            <div class="r-wage">${money(r.pieceWage)} 元</div>
          </div>
          <div class="r-tags">
            <span class="tag tag-green">合格 ${r.ok} 件</span>
            ${r.rework ? `<span class="tag tag-orange">返工 ${r.rework}</span>` : ''}
            ${r.shortage ? `<span class="tag tag-purple">缺料 ${r.shortage}</span>` : ''}
            ${r.qcfail ? `<span class="tag tag-red">质检不过 ${r.qcfail}</span>` : ''}
          </div>
          <div class="r-meta">
            工价 ¥${money(r.priceSnapshot)}/件
            ${r.shortageSubsidy > 0 ? `· 缺料补贴 ${money(r.shortageSubsidy)} 元` : ''}
          </div>
        </div>`).join('');
    }

    const subTitle = document.getElementById('w-subs-title');
    const subBox = document.getElementById('w-subs');
    if (d.subsidies && d.subsidies.length) {
      subTitle.style.display = '';
      subBox.innerHTML = d.subsidies.map((x) => `
        <div class="rec-card" style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="r-style" style="font-size:14px">${esc(x.type)}</div>
          <div class="r-process">${esc(x.reason || '')}</div></div>
          <div class="r-wage" style="color:var(--purple)">${money(x.amount)} 元</div>
        </div>`).join('');
    } else {
      subTitle.style.display = 'none';
      subBox.innerHTML = '';
    }
  } catch (e) {
    if (Store.token) toast(e.message, true);
  }
}
