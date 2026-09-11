'use strict';
/*
 * 极简 JSON 文件数据层（零依赖）
 * 数据文件: data/store.json
 * 集合: workers / styles / records / subs
 * - workers 工人: code(工号) name(姓名) pin(密码)
 * - styles  款号工序: styleNo 款号, process 工序, price 工价, shortageRate 缺料补贴单价
 * - records 每日每工人每工序产量: date|workerId|styleId 唯一
 *     ok 合格, rework 返工, shortage 缺料, qcfail 质检不过
 *     priceSnapshot 当时工价, shortageRateSnapshot 当时缺料补贴单价
 * - subs    手工补贴: date/workerId/amount/type/reason
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

let db = null;
let saveTimer = null;

function uid() {
  return crypto.randomUUID();
}

function load() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const bak = DB_FILE + '.broken-' + Date.now();
      fs.copyFileSync(DB_FILE, bak);
      db = emptyDb();
    }
  } else {
    db = seed();
    saveNow();
  }
  ['workers', 'styles', 'records', 'subs'].forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = [];
  });
  return db;
}

function emptyDb() {
  return {
    settings: {
      adminPassword: '123456',
      shortageSubsidyEnabled: true,
      reworkPay: 0,
      qcfailPay: 0,
    },
    sessions: {},
    workers: [],
    styles: [],
    records: [],
    subs: [],
  };
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function seed() {
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  const d0 = fmtDate(yest);
  const d1 = fmtDate(today);

  const workers = [
    { id: uid(), code: 'A001', name: '张晓梅', pin: '1234' },
    { id: uid(), code: 'A002', name: '李春兰', pin: '1234' },
    { id: uid(), code: 'A003', name: '王秀芳', pin: '1234' },
    { id: uid(), code: 'B001', name: '陈桂英', pin: '1234' },
    { id: uid(), code: 'B002', name: '赵金凤', pin: '1234' },
  ];

  const styles = [
    { id: uid(), styleNo: 'K-8801', process: '前片拼缝', price: 0.85, shortageRate: 0.10, active: true },
    { id: uid(), styleNo: 'K-8801', process: '装拉链', price: 1.20, shortageRate: 0.15, active: true },
    { id: uid(), styleNo: 'K-8801', process: '袖口绗线', price: 0.65, shortageRate: 0.10, active: true },
    { id: uid(), styleNo: 'W-6620', process: '锁眼钉扣', price: 0.45, shortageRate: 0.05, active: true },
    { id: uid(), styleNo: 'W-6620', process: '整烫包装', price: 0.55, shortageRate: 0.05, active: true },
  ];

  const mk = (date, wi, si, ok, rework, shortage, qcfail) => ({
    id: uid(),
    date,
    workerId: workers[wi].id,
    styleId: styles[si].id,
    ok,
    rework,
    shortage,
    qcfail,
    priceSnapshot: styles[si].price,
    shortageRateSnapshot: styles[si].shortageRate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const records = [
    mk(d1, 0, 0, 120, 3, 5, 1),
    mk(d1, 0, 1, 80, 1, 0, 2),
    mk(d1, 1, 0, 135, 0, 8, 0),
    mk(d1, 2, 2, 200, 5, 0, 3),
    mk(d1, 3, 3, 300, 4, 10, 2),
    mk(d1, 4, 4, 160, 0, 0, 0),
    mk(d0, 0, 0, 110, 2, 0, 1),
    mk(d0, 1, 1, 90, 0, 4, 0),
    mk(d0, 2, 2, 190, 3, 6, 2),
  ];

  const subs = [
    {
      id: uid(),
      date: d1,
      workerId: workers[0].id,
      amount: 20,
      type: '全勤奖',
      reason: '演示数据',
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(),
      date: d0,
      workerId: workers[2].id,
      amount: 15,
      type: '加班补贴',
      reason: '演示数据',
      createdAt: new Date().toISOString(),
    },
  ];

  return {
    settings: {
      adminPassword: '123456',
      shortageSubsidyEnabled: true,
      reworkPay: 0,
      qcfailPay: 0,
    },
    sessions: {},
    workers,
    styles,
    records,
    subs,
  };
}

function saveNow() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}

module.exports = {
  load,
  save,
  saveNow,
  uid,
  fmtDate,
};
