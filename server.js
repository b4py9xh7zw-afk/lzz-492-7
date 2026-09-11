'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const store = require('./db');
const db = store.load();

const PORT = process.env.PORT || 3000;

/* ---------------- 工具 ---------------- */
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function ok(res, data) { send(res, 200, { ok: true, data }); }
function fail(res, status, msg) { send(res, status, { ok: false, error: msg }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      raw += c;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function todayStr() { return store.fmtDate(new Date()); }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function nonNegInt(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`${field}必须是不小于0的整数`);
  }
  return n;
}
function nonNegNum(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field}必须是不小于0的数字`);
  return n;
}
function str(v, field, max = 50) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new Error(`${field}不能为空`);
  if (s.length > max) throw new Error(`${field}过长`);
  return s;
}

/* ---------------- 工资计算 ----------------
 * 计件工资 = 合格数×工价 + 返工数×返工单价 + 质检不过数×质检不过单价
 *   默认返工/质检不过单价为 0（不产生收入，但仍计入产量统计）
 * 缺料补贴 = 缺料数 × 缺料补贴单价（在设置里可关闭），属于“补贴”
 * 手工补贴: subs 表
 * -------------------------------------------------- */
function pieceWage(rec, settings) {
  return round2(
    rec.ok * rec.priceSnapshot
    + rec.rework * (Number(settings.reworkPay) || 0)
    + rec.qcfail * (Number(settings.qcfailPay) || 0)
  );
}
function shortageSubsidy(rec, settings) {
  if (!settings.shortageSubsidyEnabled) return 0;
  return round2(rec.shortage * (Number(rec.shortageRateSnapshot) || 0));
}

function workerById(id) { return db.workers.find((w) => w.id === id); }
function styleById(id) { return db.styles.find((s) => s.id === id); }

function recordView(rec, settings) {
  const w = workerById(rec.workerId);
  const s = styleById(rec.styleId);
  return {
    ...rec,
    workerName: w ? w.name : '(已删除)',
    workerCode: w ? w.code : '-',
    styleNo: s ? s.styleNo : '(已删除)',
    process: s ? s.process : '-',
    priceNow: s ? s.price : null,
    pieceWage: pieceWage(rec, settings),
    shortageSubsidy: shortageSubsidy(rec, settings),
  };
}

/* ---------------- 鉴权 ---------------- */
function auth(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const sess = db.sessions[m[1]];
  if (!sess) return null;
  if (sess.expiresAt < Date.now()) {
    delete db.sessions[m[1]];
    store.save();
    return null;
  }
  return { token: m[1], ...sess };
}
function requireAuth(req, res, role) {
  const a = auth(req);
  if (!a) { fail(res, 401, '未登录或登录已过期'); return null; }
  if (role && a.role !== role) { fail(res, 403, '无权限'); return null; }
  return a;
}
function createSession(role, workerId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = {
    role,
    workerId: workerId || null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 86400000,
  };
  store.save();
  return token;
}

/* ---------------- CSV / Excel 导出 ---------------- */
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
function download(res, filename, content, type) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
  });
  res.end(content, 'utf8');
}

// 月度计件明细行（不含缺料补贴）
function monthPieceRows(records, settings) {
  const rows = [['日期', '工号', '姓名', '款号', '工序', '工价', '合格数', '返工数', '缺料数', '质检不过数', '计件工资(元)']];
  const sorted = [...records].sort((a, b) =>
    (a.date + a.workerId + a.styleId).localeCompare(b.date + b.workerId + b.styleId));
  for (const r of sorted) {
    const w = workerById(r.workerId), s = styleById(r.styleId);
    rows.push([
      r.date, w ? w.code : '-', w ? w.name : '(已删除)',
      s ? s.styleNo : '-', s ? s.process : '-',
      r.priceSnapshot.toFixed(2), r.ok, r.rework, r.shortage, r.qcfail,
      pieceWage(r, settings).toFixed(2),
    ]);
  }
  // 工人汇总
  rows.push([]);
  rows.push(['工人计件汇总']);
  rows.push(['工号', '姓名', '合格数', '返工数', '缺料数', '质检不过数', '计件工资(元)']);
  const map = new Map();
  for (const r of records) {
    const cur = map.get(r.workerId) || { ok: 0, rework: 0, shortage: 0, qcfail: 0, wage: 0 };
    cur.ok += r.ok; cur.rework += r.rework; cur.shortage += r.shortage; cur.qcfail += r.qcfail;
    cur.wage = round2(cur.wage + pieceWage(r, settings));
    map.set(r.workerId, cur);
  }
  for (const [wid, v] of map) {
    const w = workerById(wid);
    rows.push([w ? w.code : '-', w ? w.name : '(已删除)', v.ok, v.rework, v.shortage, v.qcfail, v.wage.toFixed(2)]);
  }
  return rows;
}

// 月度补贴行：缺料补贴（按产量记录）+ 手工补贴
function monthSubsidyRows(records, subs, settings) {
  const rows = [['日期', '工号', '姓名', '补贴类型', '说明', '金额(元)']];
  const items = [];
  for (const r of records) {
    const amt = shortageSubsidy(r, settings);
    if (amt > 0) {
      const w = workerById(r.workerId), s = styleById(r.styleId);
      items.push({
        date: r.date, code: w ? w.code : '-', name: w ? w.name : '(已删除)',
        type: '缺料补贴',
        reason: `${s ? s.styleNo : '-'} ${s ? s.process : '-'} 缺料${r.shortage}件 × ${(Number(r.shortageRateSnapshot) || 0).toFixed(2)}`,
        amount: amt,
      });
    }
  }
  for (const x of subs) {
    const w = workerById(x.workerId);
    items.push({
      date: x.date, code: w ? w.code : '-', name: w ? w.name : '(已删除)',
      type: x.type || '其他补贴', reason: x.reason || '', amount: round2(x.amount),
    });
  }
  items.sort((a, b) => (a.date + a.code).localeCompare(b.date + b.code));
  for (const it of items) rows.push([it.date, it.code, it.name, it.type, it.reason, it.amount.toFixed(2)]);

  rows.push([]);
  rows.push(['工人补贴汇总']);
  rows.push(['工号', '姓名', '补贴金额(元)']);
  const map = new Map();
  for (const it of items) map.set(it.code + '|' + it.name, round2((map.get(it.code + '|' + it.name) || 0) + it.amount));
  for (const [k, v] of map) {
    const [code, name] = k.split('|');
    rows.push([code, name, v.toFixed(2)]);
  }
  return rows;
}

function monthData(params) {
  const month = params.get('month') || todayStr().slice(0, 7); // YYYY-MM
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份格式应为 YYYY-MM（如 2026-09）');
  const records = db.records.filter((r) => r.date.startsWith(month));
  const subs = db.subs.filter((r) => r.date.startsWith(month));
  return { month, records, subs };
}

/* SpreadsheetML 2003 XML：一个工作簿两个工作表（计件 / 补贴），Excel/WPS 可直接打开 */
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function sheetXml(name, rows) {
  let out = `<Worksheet ss:Name="${xmlEsc(name)}"><Table>`;
  for (const row of rows) {
    out += '<Row>';
    for (const cell of row) {
      const n = Number(cell);
      const isNum = cell !== '' && cell != null && Number.isFinite(n) && String(cell).trim() !== '';
      out += isNum
        ? `<Cell><Data ss:Type="Number">${n}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${xmlEsc(cell)}</Data></Cell>`;
    }
    out += '</Row>';
  }
  out += '</Table></Worksheet>';
  return out;
}
function toXlsXml(sheets) {
  const head = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<?mso-application progid="Excel.Sheet"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
    + 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  return '﻿' + head + sheets.map(([n, rows]) => sheetXml(n, rows)).join('') + '</Workbook>';
}

/* ---------------- 路由处理 ---------------- */
const handlers = {
  /* 管理员 */
  'POST /api/admin/login': async (req, res) => {
    const b = await readBody(req);
    if (String(b.password || '') !== db.settings.adminPassword) return fail(res, 401, '管理员密码错误');
    const token = createSession('admin');
    ok(res, { token });
  },
  'POST /api/logout': async (req, res) => {
    const a = auth(req);
    if (a) { delete db.sessions[a.token]; store.save(); }
    ok(res, {});
  },

  /* 工人 */
  'POST /api/worker/login': async (req, res) => {
    const b = await readBody(req);
    const code = String(b.code || '').trim();
    const pin = String(b.pin || '').trim();
    const w = db.workers.find((x) => x.code === code);
    if (!w || w.pin !== pin) return fail(res, 401, '工号或密码错误');
    const token = createSession('worker', w.id);
    ok(res, { token, worker: { code: w.code, name: w.name } });
  },
  'GET /api/worker/me': async (req, res) => {
    const a = requireAuth(req, res, 'worker'); if (!a) return;
    const w = workerById(a.workerId);
    if (!w) return fail(res, 404, '工人信息不存在');
    const today = todayStr();
    const s = db.settings;
    const recs = db.records
      .filter((r) => r.workerId === w.id && r.date === today)
      .map((r) => recordView(r, s));
    const piece = round2(recs.reduce((sum, r) => sum + r.pieceWage, 0));
    const shSub = round2(recs.reduce((sum, r) => sum + r.shortageSubsidy, 0));
    const manualSubs = db.subs.filter((x) => x.workerId === w.id && x.date === today);
    const manual = round2(manualSubs.reduce((sum, x) => sum + Number(x.amount || 0), 0));
    const total = round2(piece + shSub + manual);

    // 本月累计
    const month = today.slice(0, 7);
    const mRecs = db.records.filter((r) => r.workerId === w.id && r.date.startsWith(month));
    const mPiece = round2(mRecs.reduce((sum, r) => sum + pieceWage(r, s), 0));
    const mSh = round2(mRecs.reduce((sum, r) => sum + shortageSubsidy(r, s), 0));
    const mManual = round2(db.subs
      .filter((x) => x.workerId === w.id && x.date.startsWith(month))
      .reduce((sum, x) => sum + Number(x.amount || 0), 0));

    ok(res, {
      worker: { code: w.code, name: w.name },
      today,
      todayWage: { piece, shortageSubsidy: shSub, manualSubsidy: manual, total },
      monthWage: { piece: mPiece, shortageSubsidy: mSh, manualSubsidy: mManual, total: round2(mPiece + mSh + mManual) },
      records: recs,
      subsidies: manualSubs,
    });
  },

  /* 款号工序 */
  'GET /api/styles': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    ok(res, db.styles);
  },
  'POST /api/styles': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    const b = await readBody(req);
    const styleNo = str(b.styleNo, '款号', 40);
    const process = str(b.process, '工序', 40);
    const dup = db.styles.find((s) => s.styleNo === styleNo && s.process === process);
    if (dup) return fail(res, 409, '该款号下工序已存在');
    const item = {
      id: store.uid(), styleNo, process,
      price: nonNegNum(b.price, '工价'),
      shortageRate: nonNegNum(b.shortageRate == null || b.shortageRate === '' ? 0 : b.shortageRate, '缺料补贴单价'),
      active: true,
    };
    db.styles.push(item); store.save();
    ok(res, item);
  },
  'PUT /api/styles/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const item = styleById(p.id);
    if (!item) return fail(res, 404, '工序不存在');
    const b = await readBody(req);
    if (b.styleNo != null) item.styleNo = str(b.styleNo, '款号', 40);
    if (b.process != null) item.process = str(b.process, '工序', 40);
    if (b.price != null) item.price = nonNegNum(b.price, '工价');
    if (b.shortageRate != null) item.shortageRate = nonNegNum(b.shortageRate, '缺料补贴单价');
    if (b.active != null) item.active = !!b.active;
    const dup = db.styles.find((s) => s.id !== item.id && s.styleNo === item.styleNo && s.process === item.process);
    if (dup) return fail(res, 409, '该款号下工序已存在');
    store.save();
    ok(res, item);
  },
  'DELETE /api/styles/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const used = db.records.some((r) => r.styleId === p.id);
    if (used) {
      const item = styleById(p.id);
      if (item) item.active = false;
      store.save();
      return ok(res, { deactivated: true }); // 有历史记录则停用而非删除
    }
    const i = db.styles.findIndex((s) => s.id === p.id);
    if (i < 0) return fail(res, 404, '工序不存在');
    db.styles.splice(i, 1); store.save();
    ok(res, { deleted: true });
  },

  /* 工人 */
  'GET /api/workers': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    ok(res, db.workers.map((w) => ({ id: w.id, code: w.code, name: w.name })));
  },
  'POST /api/workers': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    const b = await readBody(req);
    const code = str(b.code, '工号', 20);
    const name = str(b.name, '姓名', 20);
    if (db.workers.find((w) => w.code === code)) return fail(res, 409, '工号已存在');
    const item = { id: store.uid(), code, name, pin: str(b.pin || '1234', '密码', 20) };
    db.workers.push(item); store.save();
    ok(res, { id: item.id, code: item.code, name: item.name });
  },
  'PUT /api/workers/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const item = workerById(p.id);
    if (!item) return fail(res, 404, '工人不存在');
    const b = await readBody(req);
    if (b.code != null) {
      const code = str(b.code, '工号', 20);
      if (db.workers.find((w) => w.id !== item.id && w.code === code)) return fail(res, 409, '工号已存在');
      item.code = code;
    }
    if (b.name != null) item.name = str(b.name, '姓名', 20);
    if (b.pin != null) item.pin = str(b.pin, '密码', 20);
    store.save();
    ok(res, { id: item.id, code: item.code, name: item.name });
  },
  'DELETE /api/workers/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const used = db.records.some((r) => r.workerId === p.id) || db.subs.some((x) => x.workerId === p.id);
    if (used) return fail(res, 409, '该工人有产量/补贴记录，不能删除（可在工号上加注停用）');
    const i = db.workers.findIndex((w) => w.id === p.id);
    if (i < 0) return fail(res, 404, '工人不存在');
    db.workers.splice(i, 1); store.save();
    ok(res, { deleted: true });
  },

  /* 产量记录 */
  'GET /api/records': async (req, res, p, u) => {
    const a = requireAuth(req, res, 'admin'); if (!a) return;
    const date = u.searchParams.get('date') || todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, '日期格式应为 YYYY-MM-DD');
    const recs = db.records.filter((r) => r.date === date);
    ok(res, recs.map((r) => recordView(r, db.settings)));
  },
  'POST /api/records': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    const b = await readBody(req);
    const date = b.date ? str(b.date, '日期', 10) : todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, '日期格式应为 YYYY-MM-DD');
    const workerId = str(b.workerId, '工人');
    const styleId = str(b.styleId, '款号工序');
    if (!workerById(workerId)) return fail(res, 400, '工人不存在');
    const st = styleById(styleId);
    if (!st) return fail(res, 400, '款号工序不存在');
    const counts = {
      ok: nonNegInt(b.ok, '合格数'),
      rework: nonNegInt(b.rework == null || b.rework === '' ? 0 : b.rework, '返工数'),
      shortage: nonNegInt(b.shortage == null || b.shortage === '' ? 0 : b.shortage, '缺料数'),
      qcfail: nonNegInt(b.qcfail == null || b.qcfail === '' ? 0 : b.qcfail, '质检不过数'),
    };
    if (counts.ok + counts.rework + counts.shortage + counts.qcfail === 0) {
      return fail(res, 400, '完成数量不能全部为 0');
    }
    let rec = db.records.find((r) => r.date === date && r.workerId === workerId && r.styleId === styleId);
    if (rec) {
      Object.assign(rec, counts, { updatedAt: new Date().toISOString() });
    } else {
      rec = {
        id: store.uid(), date, workerId, styleId, ...counts,
        priceSnapshot: st.price,
        shortageRateSnapshot: st.shortageRate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.records.push(rec);
    }
    store.save();
    ok(res, recordView(rec, db.settings));
  },
  'PUT /api/records/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const rec = db.records.find((r) => r.id === p.id);
    if (!rec) return fail(res, 404, '记录不存在');
    const b = await readBody(req);
    if (b.date != null) {
      const date = str(b.date, '日期', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, '日期格式应为 YYYY-MM-DD');
      rec.date = date;
    }
    if (b.workerId != null) {
      if (!workerById(b.workerId)) return fail(res, 400, '工人不存在');
      rec.workerId = b.workerId;
    }
    if (b.styleId != null) {
      const st = styleById(b.styleId);
      if (!st) return fail(res, 400, '款号工序不存在');
      rec.styleId = b.styleId;
      rec.priceSnapshot = st.price;
      rec.shortageRateSnapshot = st.shortageRate;
    }
    for (const [k, label] of [['ok', '合格数'], ['rework', '返工数'], ['shortage', '缺料数'], ['qcfail', '质检不过数']]) {
      if (b[k] != null) rec[k] = nonNegInt(b[k], label);
    }
    const dup = db.records.find((r) => r.id !== rec.id
      && r.date === rec.date && r.workerId === rec.workerId && r.styleId === rec.styleId);
    if (dup) return fail(res, 409, '同一天同一工人同一工序只能有一条记录');
    rec.updatedAt = new Date().toISOString();
    store.save();
    ok(res, recordView(rec, db.settings));
  },
  'DELETE /api/records/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const i = db.records.findIndex((r) => r.id === p.id);
    if (i < 0) return fail(res, 404, '记录不存在');
    db.records.splice(i, 1); store.save();
    ok(res, { deleted: true });
  },

  /* 手工补贴 */
  'GET /api/subsidies': async (req, res, p, u) => {
    if (!requireAuth(req, res, 'admin')) return;
    const month = u.searchParams.get('month') || todayStr().slice(0, 7);
    const items = db.subs.filter((x) => x.date.startsWith(month));
    ok(res, items.map((x) => ({
      ...x,
      workerName: (workerById(x.workerId) || {}).name || '(已删除)',
      workerCode: (workerById(x.workerId) || {}).code || '-',
    })));
  },
  'POST /api/subsidies': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    const b = await readBody(req);
    const date = b.date ? str(b.date, '日期', 10) : todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, '日期格式应为 YYYY-MM-DD');
    const workerId = str(b.workerId, '工人');
    if (!workerById(workerId)) return fail(res, 400, '工人不存在');
    const amount = nonNegNum(b.amount, '补贴金额');
    if (amount === 0) return fail(res, 400, '补贴金额需大于 0');
    const item = {
      id: store.uid(), date, workerId, amount: round2(amount),
      type: str(b.type || '其他补贴', '补贴类型', 20),
      reason: String(b.reason || '').slice(0, 100),
      createdAt: new Date().toISOString(),
    };
    db.subs.push(item); store.save();
    ok(res, item);
  },
  'DELETE /api/subsidies/:id': async (req, res, p) => {
    if (!requireAuth(req, res, 'admin')) return;
    const i = db.subs.findIndex((x) => x.id === p.id);
    if (i < 0) return fail(res, 404, '补贴不存在');
    db.subs.splice(i, 1); store.save();
    ok(res, { deleted: true });
  },

  /* 看板汇总 */
  'GET /api/dashboard': async (req, res, p, u) => {
    if (!requireAuth(req, res, 'admin')) return;
    const date = u.searchParams.get('date') || todayStr();
    const recs = db.records.filter((r) => r.date === date);
    const s = db.settings;
    const byWorker = new Map();
    let g = { ok: 0, rework: 0, shortage: 0, qcfail: 0, piece: 0, shSub: 0 };
    for (const r of recs) {
      const w = byWorker.get(r.workerId) || {
        workerId: r.workerId, workerName: (workerById(r.workerId) || {}).name || '(已删除)',
        workerCode: (workerById(r.workerId) || {}).code || '-',
        ok: 0, rework: 0, shortage: 0, qcfail: 0, piece: 0, shSub: 0,
      };
      const pw = pieceWage(r, s), sh = shortageSubsidy(r, s);
      w.ok += r.ok; w.rework += r.rework; w.shortage += r.shortage; w.qcfail += r.qcfail;
      w.piece = round2(w.piece + pw); w.shSub = round2(w.shSub + sh);
      byWorker.set(r.workerId, w);
      g.ok += r.ok; g.rework += r.rework; g.shortage += r.shortage; g.qcfail += r.qcfail;
      g.piece = round2(g.piece + pw); g.shSub = round2(g.shSub + sh);
    }
    const manualToday = round2(db.subs.filter((x) => x.date === date)
      .reduce((sum, x) => sum + Number(x.amount || 0), 0));
    // 按工序
    const byStyle = new Map();
    for (const r of recs) {
      const st = styleById(r.styleId);
      const key = r.styleId;
      const v = byStyle.get(key) || {
        styleId: key, styleNo: st ? st.styleNo : '-', process: st ? st.process : '-',
        ok: 0, rework: 0, shortage: 0, qcfail: 0,
      };
      v.ok += r.ok; v.rework += r.rework; v.shortage += r.shortage; v.qcfail += r.qcfail;
      byStyle.set(key, v);
    }
    ok(res, {
      date,
      totals: { ...g, manualSub: manualToday, grand: round2(g.piece + g.shSub + manualToday) },
      workers: [...byWorker.values()].sort((a, b) => b.piece - a.piece),
      styles: [...byStyle.values()].sort((a, b) => a.styleNo.localeCompare(b.styleNo) || a.process.localeCompare(b.process)),
      recordCount: recs.length,
    });
  },

  /* 设置 */
  'GET /api/settings': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    ok(res, db.settings);
  },
  'PUT /api/settings': async (req, res) => {
    if (!requireAuth(req, res, 'admin')) return;
    const b = await readBody(req);
    if (b.adminPassword != null) {
      const p = String(b.adminPassword).trim();
      if (p.length < 4) return fail(res, 400, '管理员密码至少4位');
      db.settings.adminPassword = p;
    }
    if (b.shortageSubsidyEnabled != null) db.settings.shortageSubsidyEnabled = !!b.shortageSubsidyEnabled;
    if (b.reworkPay != null) db.settings.reworkPay = nonNegNum(b.reworkPay, '返工单价');
    if (b.qcfailPay != null) db.settings.qcfailPay = nonNegNum(b.qcfailPay, '质检不过单价');
    store.save();
    ok(res, db.settings);
  },

  /* 月底导出 */
  'GET /api/export/piece.csv': async (req, res, p, u) => {
    if (!requireAuth(req, res, 'admin')) return;
    const { month, records } = monthData(u.searchParams);
    download(res, `计件工资明细_${month}.csv`, toCsv(monthPieceRows(records, db.settings)),
      'text/csv; charset=utf-8');
  },
  'GET /api/export/subsidy.csv': async (req, res, p, u) => {
    if (!requireAuth(req, res, 'admin')) return;
    const { month, records, subs } = monthData(u.searchParams);
    download(res, `补贴明细_${month}.csv`, toCsv(monthSubsidyRows(records, subs, db.settings)),
      'text/csv; charset=utf-8');
  },
  'GET /api/export/payroll.xls': async (req, res, p, u) => {
    if (!requireAuth(req, res, 'admin')) return;
    const { month, records, subs } = monthData(u.searchParams);
    const xml = toXlsXml([
      ['普通计件', monthPieceRows(records, db.settings)],
      ['补贴', monthSubsidyRows(records, subs, db.settings)],
    ]);
    download(res, `工资表_计件与补贴_${month}.xls`, xml,
      'application/vnd.ms-excel; charset=utf-8');
  },
};

/* ---------------- 静态文件 + 路由 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PUBLIC = path.join(__dirname, 'public');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);

  if (pathname.startsWith('/api/')) {
    try {
      // 精确匹配优先，再做 :id 模式匹配
      const exact = `${req.method} ${pathname}`;
      let fn = handlers[exact];
      let params = {};
      if (!fn) {
        for (const key of Object.keys(handlers)) {
          const [m, pat] = key.split(' ');
          if (m !== req.method) continue;
          const pp = pat.split('/');
          const ap = pathname.split('/');
          if (pp.length !== ap.length) continue;
          const pm = {};
          let matched = true;
          for (let i = 0; i < pp.length; i++) {
            if (pp[i].startsWith(':')) pm[pp[i].slice(1)] = decodeURIComponent(ap[i]);
            else if (pp[i] !== ap[i]) { matched = false; break; }
          }
          if (matched) { fn = handlers[key]; params = pm; break; }
        }
      }
      if (!fn) return fail(res, 404, '接口不存在');
      await fn(req, res, params, u);
    } catch (e) {
      fail(res, 400, e.message || '请求处理失败');
    }
    return;
  }

  // 静态文件
  let fp = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(PUBLIC, 'index.html');
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`服装厂计件看板已启动: http://localhost:${PORT}`);
  console.log(`管理员默认密码: ${db.settings.adminPassword}（登录后请修改）`);
  console.log(`演示工人账号: A001~A003/B001~B002，密码均为 1234`);
});
