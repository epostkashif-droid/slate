/* Slate: one month of spending, a fresh start every month. Everything stays on the phone. */
(function () {
  'use strict';
  var P = window.SmsParser, A = window.Android, DAY = 86400000;
  // ---------- categories: a rich starting set, and people can add, rename, recolour, cap, reorder or hide them ----------
  var DEF_CATS = [
    ['food', '🍽️', 'Food', '#f97316'], ['groceries', '🛒', 'Groceries', '#22c55e'], ['travel', '🚕', 'Travel', '#3b82f6'], ['fuel', '⛽', 'Fuel', '#0ea5e9'],
    ['shopping', '🛍️', 'Shopping', '#ec4899'], ['bills', '💡', 'Bills & home', '#eab308'], ['rent', '🏠', 'Rent', '#b45309'], ['emi', '🏦', 'EMI & loans', '#6366f1'],
    ['education', '📚', 'Education', '#8b5cf6'], ['kids', '🧸', 'Kids', '#f472b6'], ['health', '💊', 'Health', '#ef4444'], ['personal', '💇', 'Personal care', '#d946ef'],
    ['subs', '📺', 'Subscriptions', '#14b8a6'], ['fun', '🎬', 'Fun', '#f43f5e'], ['gifts', '🎁', 'Gifts', '#fb7185'], ['charity', '🤲', 'Charity', '#10b981'],
    ['people', '🤝', 'Family & friends', '#64748b'], ['cash', '💵', 'Cash', '#84cc16'], ['other', '✨', 'Other', '#94a3b8']
  ];
  var FALL = { fuel: 'travel', rent: 'bills', emi: 'bills', education: 'bills', subs: 'bills', kids: 'people', personal: 'shopping', gifts: 'people', charity: 'people' };
  var EMO = '🍽️ 🍕 🍔 ☕ 🍵 🍺 🍰 🛒 🥦 🥩 🐟 🚕 🛺 🚌 🚆 ✈️ ⛽ 🅿️ 🚗 🏍️ 🛍️ 👕 👟 💄 💍 💡 📱 🌐 🔥 💧 🏠 🛠️ 🧹 🏦 💳 📚 🎓 ✏️ 🧸 👶 🍼 💊 🏥 🦷 👓 💇 🧘 🏋️ ⚽ 📺 🎮 🎬 🎵 📸 🎁 🎉 🤲 🕌 🤝 👪 👵 🐶 🐱 🌱 💼 🧾 📦 💵 💰 📈 ✨ 🏷️'.split(' ');
  var SW = ['#f97316', '#ef4444', '#f43f5e', '#ec4899', '#d946ef', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308', '#b45309', '#64748b'];
  var B = {}, ORDER = [];
  function buildCats() {
    B = {}; ORDER = [];
    state.cats.forEach(function (c) { B[c.k] = [c.e, c.n, c.c]; if (!c.hide) ORDER.push(c.k); });
    if (!B.other) B.other = ['✨', 'Other', '#94a3b8'];
    B.moved = ['🔁', 'Not a spend', '#9ca3af'];
  }
  function bk(k) { return B[k] || (ui.catSnap && ui.catSnap[k]) || (k === '?' ? ['?', 'Unsorted', '#9ca3af'] : B.other); }
  function catOf(k) { for (var i = 0; i < state.cats.length; i++) if (state.cats[i].k === k) return state.cats[i]; return null; }
  function initCats() {
    if (!Array.isArray(state.cats) || !state.cats.length) state.cats = DEF_CATS.map(function (d) { return { k: d[0], e: d[1], n: d[2], c: d[3] }; });
    if ((state.catsV || 0) < 2) {           // people upgrading from the first version get the new starters too
      var have = {}; state.cats.forEach(function (c) { have[c.k] = 1; });
      DEF_CATS.forEach(function (d, i) { if (!have[d[0]]) state.cats.splice(Math.min(i, state.cats.length), 0, { k: d[0], e: d[1], n: d[2], c: d[3] }); });
      state.catsV = 2;
    }
    buildCats();
  }
  function visible(k) { var c = catOf(k); if (c && !c.hide) return k; if (FALL[k]) return visible(FALL[k]); return c ? k : 'other'; }
  function catColor(k) { return bk(k)[2] || '#94a3b8'; }
  var MAP = { 'Food & Dining': 'food', 'Groceries': 'groceries', 'Shopping': 'shopping', 'Transport': 'travel', 'Fuel': 'fuel', 'Travel': 'travel', 'Bills & Utilities': 'bills', 'Rent & Housing': 'rent',
    'EMI & Loans': 'emi', 'Insurance': 'bills', 'Education': 'education', 'Fees & Charges': 'bills', 'Health': 'health', 'Entertainment': 'fun', 'Family & Personal': 'people', 'Charity & Donations': 'charity', 'Transfers': 'people',
    'Cash withdrawal': 'cash', 'Investments': 'moved', 'Card bill payment': 'moved', 'Self transfer': 'moved', 'Business': 'other', 'Other': 'other' };
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var state = { v: 1, month: '', txns: [], rules: {}, deleted: {}, budget: 0, notify: false, lastScan: 0, wrap: null, onboarded: false, fixed: [], iou: [], accts: {},
    cats: null, catsV: 0, archive: [], keepMonths: 24, autoCsv: true, theme: 'emerald', mode: 'system', motion: 'lively' };
  var ui = { tab: 'today', perm: true, denied: false, q: '', fb: '', selBar: -1, layer: null, sheet: null, anim: true, viz: 'donut', fresh: {}, aq: '' };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { var v = Math.round(Math.abs(n)); return (n < 0 ? '−' : '') + '₹' + v.toLocaleString('en-IN'); }
  function mkey(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function mname(k) { var a = k.split('-'); return MON[+a[1] - 1]; }
  function sod(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function monthStart() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).getTime(); }
  function dim() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate(); }
  function time(ts) { var d = new Date(ts), h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm'); }
  function iso(ts) { var d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function toast(msg, undo) { var t = document.getElementById('toast'); t.textContent = msg; if (undo && ui.undo) { var b = document.createElement('button'); b.textContent = 'Undo'; b.setAttribute('data-act', 'undo'); t.appendChild(b); } t.className = 'on' + (undo ? ' act' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, undo ? 5500 : 2400); }
  function spends(list) { return (list || state.txns).filter(function (t) { return t.dir === 'out' && t.b !== 'moved'; }); }
  function sum(list) { var s = 0; list.forEach(function (t) { s += t.amt; }); return s; }
  function toSort() { return state.txns.filter(function (t) { return t.b === '?'; }); }
  function snapshot() { ui.undo = JSON.stringify({ txns: state.txns, rules: state.rules, deleted: state.deleted }); }

  // ---------- fixed payments (EMIs, rent, subscriptions) and money lent / borrowed: these survive the monthly reset ----------
  function norm(x) { return String(x || '').replace(/\s+/g, ' ').trim(); }
  function fxPaid(f) {
    if (f.paid === state.month) return true;
    if (!f.keys || !f.keys.length) return false;
    return spends().some(function (t) { return f.keys.indexOf(P.merchantKey(t.who)) >= 0; });
  }
  function fxState() {
    var o = { total: 0, paid: 0, reserve: 0, nPaid: 0, next: null, today: new Date().getDate() };
    state.fixed.forEach(function (f) { var p = fxPaid(f); o.total += f.amt; if (p) { o.paid += f.amt; o.nPaid++; } else { o.reserve += f.amt; if (!o.next || (f.day || 99) < (o.next.day || 99)) o.next = f; } });
    return o;
  }
  function fxStatus(f) {
    if (fxPaid(f)) return ['Paid ✓', 'ok'];
    var d = new Date().getDate();
    if (f.day && d > f.day) return ['Was due on the ' + f.day + nth(f.day), 'bad'];
    return [f.day ? (f.day === d ? 'Due today' : 'Due on the ' + f.day + nth(f.day)) : 'Not paid yet', 'wait'];
  }
  function iouTotals() { var o = { owed: 0, owe: 0, n: 0 }; state.iou.forEach(function (x) { if (x.done) return; o.n++; if (x.dir === 'lent') o.owed += x.amt; else o.owe += x.amt; }); return o; }
  function topBuckets() {
    var cnt = {}; spends().forEach(function (t) { if (B[t.b] && t.b !== 'moved') cnt[t.b] = (cnt[t.b] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    ['food', 'groceries', 'travel', 'shopping'].forEach(function (k) { if (top.indexOf(k) < 0) top.push(k); });
    return top.slice(0, 3);
  }
  function applyPending() {
    var list = []; try { list = JSON.parse(A.takePending() || '[]'); } catch (e) { }
    list.forEach(function (p) { var b = norm(p.body), i; for (i = 0; i < state.txns.length; i++) { var t = state.txns[i]; if (t.raw && norm(t.raw) === b && B[p.b]) { t.b = p.b; t.edited = true; learn(t); break; } } });
  }

  // ---------- balances: you type the figure once, Slate keeps it moving ----------
  function alias(n) { return (state.alias && state.alias[n]) || n; }
  function ensureAccts() {
    if (!state.accts.Cash) state.accts.Cash = { type: 'cash', base: null };
    state.txns.forEach(function (t) { if (t.acct && !state.accts[t.acct]) state.accts[t.acct] = { type: / Card( |$)/.test(t.acct) ? 'card' : 'bank', base: null }; });
  }
  function balOf(name) {
    var a = state.accts[name]; if (!a || !a.base) return null;
    var v = a.base.v, n = 0, card = a.type === 'card';
    state.txns.forEach(function (t) {
      if (t.ts <= a.base.ts) return;
      if (t.acct === name) { v += (card ? t.dir === 'out' : t.dir === 'in') ? t.amt : -t.amt; n++; }
      else if (a.type === 'cash' && t.b === 'cash' && t.dir === 'out') { v += t.amt; n++; }      // cash taken out of a bank account lands in your wallet
    });
    return { v: v, n: n, ts: a.base.ts };
  }
  function balTotals() {
    var o = { have: 0, owe: 0, set: 0, all: 0 };
    Object.keys(state.accts).forEach(function (k) { o.all++; var b = balOf(k); if (!b) return; o.set++; if (state.accts[k].type === 'card') o.owe += b.v; else o.have += b.v; });
    return o;
  }
  // before transactions are cleared, bake them into each balance so nothing is lost
  function foldBalances(ts) { Object.keys(state.accts).forEach(function (k) { var b = balOf(k); if (b) state.accts[k].base = { v: b.v, ts: ts }; }); }
  function lastBankFigure(name) { for (var i = 0; i < state.txns.length; i++) { var t = state.txns[i]; if (t.acct === name && t.bal != null) return t; } return null; }

  // ---------- numbers ----------
  function calc() {
    var sp = spends(), today = sod(Date.now()), n = new Date(), spentMonth = sum(sp), spentToday = sum(sp.filter(function (t) { return t.ts >= today; }));
    var daysLeft = dim() - n.getDate() + 1, o = { spentMonth: spentMonth, spentToday: spentToday, daysLeft: daysLeft, day: n.getDate(), dim: dim(), budget: state.budget };
    o.moneyIn = sum(state.txns.filter(function (t) { return t.dir === 'in' && t.b !== 'moved'; }));
    var fx = fxState(); o.reserve = fx.reserve; o.fx = fx;
    var gm = goalMonth(); o.goalsMonth = gm.month; o.goalsToday = gm.today;
    if (state.budget > 0) {
      o.allow = Math.max((state.budget - fx.reserve - (gm.month - gm.today) - (spentMonth - spentToday)) / daysLeft, 0);
      o.leftToday = o.allow - spentToday - gm.today; o.leftMonth = state.budget - spentMonth - fx.reserve - gm.month;
      o.tomorrow = daysLeft > 1 ? Math.max(o.leftMonth / (daysLeft - 1), 0) : 0;
      o.mood = o.leftMonth < 0 || o.leftToday < 0 ? 'over' : (o.allow > 0 && spentToday / o.allow > 0.8) ? 'tight' : 'good';
    } else o.mood = 'plain';
    // streak: days in a row (up to today) at or under the flat daily limit
    var per = {}, i; sp.forEach(function (t) { var k = new Date(t.ts).getDate(); per[k] = (per[k] || 0) + t.amt; });
    o.per = per; o.streak = 0; o.best = 0; o.zero = 0;
    var lim = state.budget > 0 ? state.budget / o.dim : 0, run = 0;
    for (i = 1; i <= o.day; i++) { var v = per[i] || 0; if (!v) o.zero++; if (lim && v <= lim) { run++; if (run > o.best) o.best = run; } else run = 0; }
    o.streak = run;
    return o;
  }
  function summary() {
    var c = calc(), sp = spends(), by = {}, cnt = {}, big = null;
    sp.forEach(function (t) { by[t.b] = (by[t.b] || 0) + t.amt; var w = t.who || 'Unknown'; cnt[w] = (cnt[w] || 0) + 1; if (!big || t.amt > big.amt) big = t; });
    var cats = Object.keys(by).filter(function (k) { return k !== 'moved' && k !== '?'; }).map(function (k) { return [k, by[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var fav = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    return { month: state.month, spent: c.spentMonth, budget: state.budget, n: sp.length, cats: cats, top: cats[0] ? cats[0][0] : '', big: big ? { who: big.who || 'Unknown', amt: big.amt } : null,
      fav: fav && cnt[fav] > 1 ? { who: fav, n: cnt[fav] } : null, zero: c.zero, best: c.best, avg: c.spentMonth / Math.max(c.day, 1), moneyIn: c.moneyIn, days: c.day };
  }

  // ---------- storage ----------
  function load() { try { var s = A.loadData(); if (s) { var o = JSON.parse(s); for (var k in o) state[k] = o[k]; } } catch (e) { } load2(); }
  function load2() { if (!Array.isArray(state.txns)) state.txns = []; if (!Array.isArray(state.goals)) state.goals = []; if (!state.rules) state.rules = {}; if (!state.deleted) state.deleted = {}; if (!Array.isArray(state.fixed)) state.fixed = []; if (!Array.isArray(state.iou)) state.iou = []; if (!state.accts) state.accts = {}; if (!state.alias) state.alias = {}; if (!Array.isArray(state.archive)) state.archive = []; initCats(); ensureAccts(); }
  var saveT;
  function pushLive() {
    var c = calc(), n = new Date(), known = P.KNOWN_WORDS.concat(Object.keys(state.rules)).filter(function (w) { return w.length >= 4; });
    var fixed = state.fixed.filter(function (f) { return !fxPaid(f) && f.keys && f.keys.length; }).map(function (f) { return f.keys[0] + '\t' + f.name.replace(/[\t\n]/g, ' ') + '\t' + f.amt; });
    try { A.setLive(JSON.stringify({ notify: !!state.notify, budget: state.budget || 0, month: state.month, day: n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(), spentMonth: c.spentMonth, spentToday: c.spentToday,
      reserve: c.reserve || 0, known: known.join('\n'), fixed: fixed.join('\n'), top: topBuckets().map(function (k) { return k + '\t' + bk(k)[0] + ' ' + bk(k)[1]; }).join('\n') })); } catch (e) { }
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { try { A.saveData(JSON.stringify(state)); } catch (e) { toast('Could not save'); } pushLive(); }, 120); }

  // ---------- a fresh start every month ----------
  function csv(list) {
    var rows = [['Date', 'Time', 'Type', 'Amount', 'Paid to / from', 'Category', 'Account', 'Note']];
    list.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (t) { rows.push([iso(t.ts), time(t.ts), t.dir === 'out' ? 'Spent' : 'Received', t.amt, t.who, bk(t.b)[1], t.acct || '', t.note || '']); });
    return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); if (/^[=+\-@]/.test(c) && isNaN(c)) c = "'" + c; return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
  }
  function rollover() {
    var cur = mkey();
    if (!state.month) { state.month = cur; return; }
    if (state.month === cur) return;
    try { if (state.lastScan && A.hasSmsPermission()) ingest(state.lastScan - 5 * 60000, monthStart(), false); } catch (e) { }   // last few days of the old month
    foldBalances(monthStart() - 1);
    if (state.txns.length) {
      var csvText = csv(state.txns), e = archiveNow(dimOf(state.month)), w = e.w; w.saved = false;
      if (state.autoCsv !== false) try { w.saved = !!A.saveToDownloads('Slate-' + state.month + '.csv', 'text/csv', csvText); } catch (x) { }
      state.wrap = w; ui.showWrap = true;
    }
    state.txns = []; state.deleted = {}; state.lastScan = 0; state.month = cur;
    save();
  }

  // ---------- reading SMS ----------
  function acctName(t) { return t.bank + (t.acctType === 'credit_card' ? ' Card' : '') + (t.last4 ? ' ••' + t.last4 : ''); }
  function bucketFor(t) { var k = P.merchantKey(t.merchant); if (k && state.rules[k] && B[state.rules[k]]) return state.rules[k]; return MAP[t.category] ? visible(MAP[t.category]) : '?'; }
  function ingest(since, until, full) {
    var list, have = {}, n = 0, max = state.lastScan;
    try { list = JSON.parse(A.readSms(String(Math.floor(since)))); } catch (e) { return -1; }
    state.txns.forEach(function (t) { have[t.id] = t; });
    list.forEach(function (m) {
      if (m.d >= until) return;
      var id = 's' + m.id; if (m.d > max) max = m.d;
      if (state.deleted[id] || (have[id] && (have[id].edited || !full))) return;
      var r = P.parseSms(m, {});
      if (r.kind !== 'txn') { if (have[id] && full) { state.txns.splice(state.txns.indexOf(have[id]), 1); } return; }
      var x = r.txn, t = { id: id, ts: x.ts, amt: x.amount, dir: x.dir === 'debit' ? 'out' : 'in', who: x.merchant, acct: alias(acctName(x)), raw: x.raw, edited: false, note: '' };
      if (x.balance != null && x.acctType !== 'credit_card') t.bal = x.balance;
      t.b = bucketFor(x);
      if (t.dir === 'in' && t.b === '?') t.b = 'other';                // money in never needs sorting
      if (!have[id]) {               // the same spend may already be here from an imported spreadsheet: adopt it instead of doubling up
        var mk2 = minuteKey(t.ts, t.amt, t.dir), imp = null;
        for (var q = 0; q < state.txns.length; q++) { var y = state.txns[q]; if (/^i/.test(y.id) && minuteKey(y.ts, y.amt, y.dir) === mk2) { imp = y; break; } }
        if (imp) { t.b = imp.b; t.note = imp.note; t.edited = true; state.txns[state.txns.indexOf(imp)] = t; have[id] = t; return; }
      }
      if (have[id]) state.txns[state.txns.indexOf(have[id])] = t; else { state.txns.push(t); n++; if (state.lastScan) ui.fresh[id] = 1; }
    });
    state.lastScan = Math.max(max, state.lastScan);
    ensureAccts();
    return n;
  }
  function scan(full) {
    if (!A.hasSmsPermission()) { ui.perm = false; render(); return 0; }
    ui.perm = true;
    var n = ingest(Math.max(monthStart() - 1, full ? 0 : state.lastScan - 5 * 60000), Infinity, full);
    if (n < 0) { toast('Could not read messages'); return 0; }
    applyPending();
    state.txns.sort(function (a, b) { return b.ts - a.ts; });
    save(); render();
    return n;
  }

  // ---------- views ----------
  var IC = { today: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>', month: '<path d="M5 20V10M12 20V4M19 20v-7"/>', bals: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>' };
  function navSway() {
    document.getElementById('nav').innerHTML = !ui.perm || !state.onboarded ? '' : dockHtml() + '<button class="add" data-act="add" aria-label="Add a spend">+</button>';
  }
  var MENU = '<button class="menu" data-act="menu"><svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14"/></svg>Menu</button>';
  function head(label, title, sub, cls) {
    if (look() !== 'sway') return '<div class="top"><div><h1>' + title + '</h1><div class="sub">' + label + '</div></div><button class="icon" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24">' + IC.gear + '</svg></button></div>';
    return '<header class="hd2"><div class="l">' + label + '</div><div class="t num ' + (cls || '') + '"' + (/^₹|^−/.test(title) ? ' data-count="' + title.replace(/[^\d]/g, '') + '"' : '') + '>' + title + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + MENU + '</header>';
  }
  function menuSheet() {
    var n = toSort().length, bt = balTotals(), fx = fxState(), io = iouTotals();
    function row(act, v, icon, name, meta) { return '<div class="kv" data-act="' + act + '" data-v="' + v + '"><span class="row"><span class="em" style="width:38px;height:38px;border-radius:12px;background:var(--track);display:flex;align-items:center;justify-content:center;font-size:18px">' + icon + '</span><span><b>' + name + '</b>' + (meta ? '<br><span class="mute small">' + meta + '</span>' : '') + '</span></span><span class="mute">›</span></div>'; }
    sheet('<div class="hd"><b>Menu</b><button class="x" data-act="close">✕</button></div><div class="card" style="padding:4px 16px;margin-top:8px">' +
      row('go', 'today', '☀️', 'Today', 'What is safe to spend') + row('go', 'bals', '💰', 'Balances', bt.set ? inr(bt.have) + ' in hand' + (bt.owe ? ' · ' + inr(bt.owe) + ' on cards' : '') : 'Enter them once') +
      row('go', 'month', '📊', mname(state.month), 'Where it went, day by day') + '</div><div class="card" style="padding:4px 16px">' +
      (n ? row('goSort', '', '❓', 'Sort spends', n + ' waiting') : '') + row('goFixed', '', '📌', 'Fixed payments', state.fixed.length ? fx.nPaid + ' of ' + state.fixed.length + ' paid' : 'EMIs, rent, fees') +
      row('goIou', '', '🤝', 'Lent & borrowed', io.n ? io.n + ' open' : 'Track who owes whom') + row('goGoals', '', '🎯', 'Goals & wishlist', goals().length ? inr(goalsSaved()) + ' saved' : 'Save for what you want') + row('goCats', '', '🏷️', 'Categories', state.cats.length + ' · add your own') +
      row('goArch', '', '🗂️', 'Archive', state.archive.length ? state.archive.length + ' month' + (state.archive.length === 1 ? '' : 's') + ' kept' : 'Past months live here') + row('dkTheme', '', '🎨', 'Colour & mode', THEMES[state.theme] ? THEMES[state.theme][0] : 'Emerald') + row('goSettings', '', '⚙️', 'Settings', 'Limit, notifications, export') + '</div>', 'menu');
  }
  function pc(t) {       // a spend as a card
    var q = t.b === '?';
    return '<div class="pc' + (ui.fresh[t.id] ? ' fresh' : '') + '" data-act="edit" data-v="' + esc(t.id) + '"><div class="row"><span class="em' + (q ? ' q' : '') + '" style="' + (q ? '' : 'background:' + rgba(catColor(t.b), .2)) + '">' + (q ? '?' : bk(t.b)[0]) + '</span><b class="grow ell">' + (q ? 'Tap to sort' : esc(bk(t.b)[1])) + '</b></div>' +
      '<div class="pt">' + esc(t.who || (t.dir === 'in' ? 'Money in' : 'Unknown')) + '</div><div class="pa num' + (t.dir === 'in' ? ' in' : '') + '">' + (t.dir === 'in' ? '+' : '') + inr(t.amt) + '</div><div class="pm ell">' + time(t.ts) + (t.acct ? ' · ' + esc(t.acct) : '') + '</div></div>';
  }
  function sec(cls, badge, title, right, cards) {
    return '<section class="sec ' + cls + '"><div class="sh"><span class="bd num">' + badge + '</span><b class="grow">' + title + '</b>' + (right ? '<span class="rt num">' + right + '</span>' : '') + '</div><div class="hs">' + cards + '</div></section>';
  }
  function rail(c) {
    var lim = state.budget > 0 ? state.budget / c.dim : 0, h = '<aside class="rail">', i;
    for (i = 1; i <= c.dim; i++) {
      var v = c.per[i] || 0, cls = i > c.day ? 'f' : !v ? 'z' : !lim ? 'g' : v > lim ? 'r' : v > lim * 0.8 ? 'a' : 'g';
      h += '<div class="d ' + cls + (i === c.day ? ' now' : '') + '" data-act="railDay" data-v="' + i + '">' + (i === 1 || i % 5 === 0 || i === c.day ? '<span>' + i + '</span>' : '') + '</div>';
    }
    return h + '</aside>';
  }
  function navClassic() {
    function tab(k, label) { return '<button class="t' + (ui.tab === k ? ' on' : '') + '" data-act="tab" data-v="' + k + '"><svg viewBox="0 0 24 24">' + IC[k] + '</svg>' + label + '</button>'; }
    document.getElementById('nav').innerHTML = !ui.perm || !state.onboarded ? '' :
      tab('today', 'Today') + tab('bals', 'Balances') + tab('month', mname(state.month)) + dockHtml() + '<button class="add" data-act="add" aria-label="Add a spend">+</button>';
  }
  function viewTodayClassic() {
    var c = calc(), n = new Date(), ts = toSort(), h;
    h = '<div class="top"><div><h1>Slate</h1><div class="sub">' + DOW[n.getDay()] + ', ' + n.getDate() + ' ' + mname(state.month) + '</div></div><button class="icon" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24">' + IC.gear + '</svg></button></div>';
    h += hero(c);
    h += glance(c) + capChips() + goalsStrip(c);
    h += '<div class="facts"><div class="fact"><div class="k">Today</div><div class="v num">' + inr(c.spentToday) + '</div></div><div class="fact"><div class="k">Per day so far</div><div class="v num">' + inr(c.spentMonth / c.day) + '</div></div>' +
      '<div class="fact"><div class="k">' + (state.budget > 0 ? 'Streak' : 'No-spend days') + '</div><div class="v">' + (state.budget > 0 ? (c.streak ? '🔥 ' + c.streak + ' day' + (c.streak === 1 ? '' : 's') : '—') : c.zero) + '</div></div></div>';
    if (ts.length) h += '<button class="sortpill" data-act="sort"><span class="n">' + ts.length + '</span><span class="grow"><b>Sort ' + (ts.length === 1 ? 'this spend' : 'these spends') + '</b><span class="s">One tap each. Slate remembers for next time.</span></span><span>›</span></button>';
    var bt = balTotals();
    var free = bt.have - bt.owe - c.reserve - iouTotals().owe - goalsSaved();
    h += '<button class="slim" data-act="tab" data-v="bals"><span class="grow">' + (bt.set ? '💰 <b class="num">' + inr(bt.have) + '</b> in hand · <b class="num" style="color:' + (free < 0 ? 'var(--red)' : 'var(--accent)') + '">' + inr(free) + '</b> truly free' : '💰 Enter your balances once and Slate keeps them current') + '</span><span>›</span></button>';
    var fx = c.fx, io = iouTotals();
    h += '<div class="duo"><button class="tile" data-act="fixed"><span class="k">📌 Fixed payments</span>' + (state.fixed.length ? '<b class="num">' + fx.nPaid + ' of ' + state.fixed.length + ' paid</b><span class="s">' + (fx.reserve ? inr(fx.reserve) + ' to go' : 'All done this month') + '</span>' : '<b>Add EMIs, rent…</b><span class="s">Slate sets them aside for you</span>') + '</button>' +
      '<button class="tile" data-act="iou"><span class="k">🤝 Lent & borrowed</span>' + (io.n ? '<b class="num">' + (io.owed ? 'Owed ' + inr(io.owed) : 'You owe ' + inr(io.owe)) + '</b><span class="s">' + (io.owed && io.owe ? 'You owe ' + inr(io.owe) : io.n + ' open') + '</span>' : '<b>Track an IOU</b><span class="s">Never forget who owes whom</span>') + '</button></div>';
    var recent = state.txns.slice(0, 6);
    h += '<div class="card"><h2>Latest</h2>' + (recent.length ? recent.map(txRow).join('') : '<div class="empty">Nothing yet this month.<br>Spends appear here as your bank texts you.</div>') +
      (state.txns.length > 6 ? '<button class="btn" style="margin-top:10px" data-act="tab" data-v="month">See all ' + state.txns.length + '</button>' : '') + '</div>';
    return h;
  }
  // ---------- looks: the same app in different clothes ----------
  var LOOKS = {
    classic: ['Classic', 'Clean cards and a bottom bar', '#f6f5f1', false],
    sway: ['Sway', 'Big headline, day rail, swipeable cards', '#f6f5f1', false],
    paper: ['Paper', 'Quiet and typographic, one ring', '#fbfaf5', false],
    glow: ['Glow', 'Dark glass with vivid colour', '#0b0b14', true]
  };
  function look() { return LOOKS[state.look] ? state.look : 'classic'; }
  function applyLook() {
    var k = look(), dark = LOOKS[k][3] || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.setAttribute('data-look', k);
    var bg = k === 'glow' ? '#0b0b14' : dark ? (k === 'paper' ? '#141412' : '#0e1110') : LOOKS[k][2];
    dark = isDark(); if (k !== 'glow') bg = dark ? (k === 'paper' ? '#141412' : '#0e1110') : LOOKS[k][2];
    applyTheme(); try { A.setChrome(bg, dark); } catch (e) { }
  }
  function nav() { if (look() === 'sway') navSway(); else navClassic(); }
  function viewToday() { return look() === 'sway' ? viewTodaySway() : viewTodayClassic(); }
  function heroRing(c) {        // Paper: one ring, one number
    var plain = c.mood === 'plain', used = plain ? 0 : c.allow > 0 ? Math.min(c.spentToday / c.allow, 1) : 1, C = 2 * Math.PI * 96, v = plain ? c.spentToday : Math.abs(c.leftToday);
    return '<div class="ringhero ' + c.mood + '"><svg viewBox="0 0 220 220"><circle class="t" cx="110" cy="110" r="96"/><circle class="f" cx="110" cy="110" r="96" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (ui.anim ? C : C * (1 - used)).toFixed(1) + '" data-to="' + (C * (1 - used)).toFixed(1) + '"/></svg>' +
      '<div class="in"><div class="lbl">' + (plain ? 'Spent today' : c.leftToday >= 0 ? 'Safe to spend today' : 'Over today by') + '</div><div class="big num" data-count="' + v + '">' + inr(v) + '</div><div class="sub">' + (plain ? inr(c.spentMonth) + ' this month' : c.leftMonth >= 0 ? inr(c.leftMonth) + ' · ' + c.daysLeft + ' day' + (c.daysLeft === 1 ? '' : 's') + ' left' : inr(-c.leftMonth) + ' over this month') + '</div></div></div>' +
      (plain ? '<button class="btn dark" style="margin-bottom:14px" data-act="budget">Set a monthly limit</button>' : c.reserve > 0 ? '<div class="mute small" style="text-align:center;margin:-4px 0 14px">' + inr(c.reserve) + ' set aside for fixed payments</div>' : '');
  }
  function weekStrip(c) {       // Glow: the last seven days inside the hero
    var h = '<div class="week">', max = 1, i, d;
    for (i = 6; i >= 0; i--) { d = c.day - i; if (d >= 1 && (c.per[d] || 0) > max) max = c.per[d]; }
    for (i = 6; i >= 0; i--) { d = c.day - i; var v = d >= 1 ? (c.per[d] || 0) : 0; h += '<div class="w' + (i === 0 ? ' now' : '') + '"><i style="height:' + Math.max(v / max * 100, 4).toFixed(0) + '%"></i><span>' + (d >= 1 ? d : '') + '</span></div>'; }
    return h + '</div>';
  }
  function lookSheet() {
    var cur = look();
    sheet('<div class="hd"><b>Choose a look</b><button class="x" data-act="close">✕</button></div><p class="mute" style="margin:0 0 12px">Same app, same data. Switch any time.</p><div class="looks">' + Object.keys(LOOKS).map(function (k) {
      return '<button class="lk' + (cur === k ? ' on' : '') + '" data-act="setLook" data-v="' + k + '"><span class="pv pv-' + k + '"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></span><b>' + LOOKS[k][0] + '</b><span class="s">' + LOOKS[k][1] + '</span></button>';
    }).join('') + '</div>', 'look');
  }

  function txRow(t, ro) {
    var q = t.b === '?';
    return '<div class="tx' + (ui.fresh[t.id] && !ro ? ' fresh' : '') + '"' + (ro ? '' : ' data-act="edit" data-v="' + esc(t.id) + '"') + '><div class="em' + (q ? ' q' : '') + '" style="' + (q ? '' : 'background:' + rgba(catColor(t.b), .16)) + '">' + (q ? '?' : bk(t.b)[0]) + '</div><div class="grow"><div class="who ell">' + esc(t.who || (t.dir === 'in' ? 'Money in' : 'Unknown')) + '</div>' +
      '<div class="meta ell">' + (q ? 'Tap to sort' : esc(bk(t.b)[1])) + ' · ' + (ro ? new Date(t.ts).getDate() + ' ' + MON[new Date(t.ts).getMonth()].slice(0, 3) + ' · ' : '') + time(t.ts) + (t.acct ? ' · ' + esc(t.acct) : '') + '</div></div><div class="amt num' + (t.dir === 'in' ? ' in' : '') + '">' + (t.dir === 'in' ? '+' : '') + inr(t.amt) + '</div></div>';
  }
  function hero(c) {
    if (look() === 'paper') return heroRing(c);
    var h = '<div class="hero ' + c.mood + '">';
    if (c.mood === 'plain') {
      h += '<div class="lbl">Spent today</div><div class="big num" data-count="' + c.spentToday + '">' + inr(c.spentToday) + '</div><div class="sub">' + inr(c.spentMonth) + ' so far in ' + mname(state.month) + '</div>' +
        '<button class="cta" data-act="budget">Set a monthly limit to see what is safe to spend</button>';
    } else {
      var used = c.allow > 0 ? Math.min(c.spentToday / c.allow, 1) : 1, C = 2 * Math.PI * 30;
      h += '<div class="ring"><svg viewBox="0 0 70 70"><circle class="t" cx="35" cy="35" r="30"/><circle class="f" cx="35" cy="35" r="30" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (ui.anim ? C : C * (1 - used)).toFixed(1) + '" data-to="' + (C * (1 - used)).toFixed(1) + '"/></svg><b>' + Math.round(used * 100) + '%</b></div>';
      if (c.leftToday >= 0) h += '<div class="lbl">Safe to spend today</div><div class="big num" data-count="' + c.leftToday + '">' + inr(c.leftToday) + '</div>';
      else h += '<div class="lbl">Over today\'s limit by</div><div class="big num" data-count="' + (-c.leftToday) + '">' + inr(-c.leftToday) + '</div>';
      h += '<div class="sub">' + (c.leftMonth >= 0 ? inr(c.leftMonth) + ' left for ' + c.daysLeft + ' day' + (c.daysLeft === 1 ? '' : 's') : inr(-c.leftMonth) + ' over your limit this month') +
        (c.leftToday < 0 && c.leftMonth >= 0 && c.daysLeft > 1 ? ' · tomorrow ' + inr(c.tomorrow) : '') + (c.reserve > 0 ? '<br>' + inr(c.reserve) + ' set aside for fixed payments' : '') + '</div>' +
        '<div class="bar"><i style="width:' + (ui.anim ? 0 : Math.min(c.spentMonth / c.budget, 1) * 100).toFixed(1) + '%" data-w="' + (Math.min(c.spentMonth / c.budget, 1) * 100).toFixed(1) + '"></i></div>';
    }
    if (look() === 'glow') h += weekStrip(c);
    return h + '</div>';
  }
  function viewTodaySway() {
    var c = calc(), n = new Date(), ts = toSort(), today = sod(Date.now()), h, label, title, cls = '';
    if (c.mood === 'plain') { label = DOW[n.getDay()] + ' ' + n.getDate() + ' · spent today'; title = inr(c.spentToday); }
    else if (c.leftToday >= 0) { label = DOW[n.getDay()] + ' ' + n.getDate() + ' · safe to spend'; title = inr(c.leftToday); cls = c.mood === 'tight' ? 'amber' : ''; }
    else { label = DOW[n.getDay()] + ' ' + n.getDate() + ' · over today by'; title = inr(-c.leftToday); cls = 'red'; }
    var sub = c.mood === 'plain' ? inr(c.spentMonth) + ' so far in ' + mname(state.month) : (c.leftMonth >= 0 ? inr(c.leftMonth) + ' left for ' + c.daysLeft + ' day' + (c.daysLeft === 1 ? '' : 's') : inr(-c.leftMonth) + ' over this month') + (c.streak ? ' · 🔥 ' + c.streak : '');
    h = head(label, title, sub, cls);
    if (c.mood === 'plain') h += '<div style="text-align:center;margin:-6px 0 14px"><button class="btn pri" style="display:inline-block;width:auto" data-act="budget">Set a monthly limit</button></div>';
    h += '<div class="tl">' + rail(c) + '<div class="col"><div class="swg">' + glance(c) + capChips() + goalsStrip(c) + '</div>';
    var td = state.txns.filter(function (t) { return t.ts >= today; }), bt = balTotals(), fx = c.fx, io = iouTotals();
    h += sec(c.mood === 'over' ? 'red' : c.mood === 'tight' ? 'amber' : 'green', td.length, 'Today', c.spentToday ? inr(c.spentToday) : '', td.length ? td.map(pc).join('') : '<div class="pc ghost"><div class="pt">Nothing spent yet today</div><div class="pm">Spends land here as your bank texts you</div></div>');
    if (ts.length) h += sec('ink', ts.length, 'To sort', '', ts.slice(0, 10).map(function (t) { return pc(t).replace('data-act="edit"', 'data-act="sortOne"'); }).join(''));
    h += sec('grey', 3, 'Your money', '',
      '<div class="pc" data-act="go" data-v="bals"><div class="row"><span class="em">💰</span><b class="grow ell">Balances</b></div><div class="pt">' + (bt.set ? 'In hand' : 'Enter your balances once') + '</div><div class="pa num">' + (bt.set ? inr(bt.have) : 'Set') + '</div><div class="pm ell">' + (bt.owe ? inr(bt.owe) + ' on cards' : 'Bank, cards and cash') + '</div></div>' +
      '<div class="pc" data-act="fixed"><div class="row"><span class="em">📌</span><b class="grow ell">Fixed payments</b></div><div class="pt">' + (state.fixed.length ? fx.nPaid + ' of ' + state.fixed.length + ' paid' : 'EMIs, rent, fees') + '</div><div class="pa num">' + (state.fixed.length ? inr(fx.reserve) : 'Add') + '</div><div class="pm ell">' + (state.fixed.length ? (fx.reserve ? 'still to go' : 'all done') : 'Set aside before you spend') + '</div></div>' +
      '<div class="pc" data-act="iou"><div class="row"><span class="em">🤝</span><b class="grow ell">Lent & borrowed</b></div><div class="pt">' + (io.n ? (io.owed ? 'You are owed' : 'You owe') : 'Who owes whom') + '</div><div class="pa num">' + (io.n ? inr(io.owed || io.owe) : 'Add') + '</div><div class="pm ell">' + (io.n ? io.n + ' open' : 'Never forget an IOU') + '</div></div>');
    var earlier = state.txns.filter(function (t) { return t.ts < today && t.b !== '?'; }).slice(0, 8);
    if (earlier.length) h += sec('grey', state.txns.length - td.length, 'Earlier in ' + mname(state.month), '', earlier.map(pc).join('') + '<div class="pc ghost" data-act="go" data-v="month"><div class="pt">See the whole month</div><div class="pa">›</div></div>');
    return h + '</div></div>';
  }
  function viewMonth() {
    var c = calc(), s = summary(), h, i;
    h = head('Day ' + c.day + ' of ' + c.dim + ' · clears on the 1st', mname(state.month), '');
    h += '<div class="card"><div class="row"><span class="grow mute small" style="font-weight:700">SPENT</span>' + (c.moneyIn ? '<span class="mute small">in ' + inr(c.moneyIn) + '</span>' : '') + '</div><div class="num" style="font-size:34px;font-weight:800;letter-spacing:-.02em" data-count="' + c.spentMonth + '">' + inr(c.spentMonth) + '</div>';
    if (state.budget > 0) h += '<div class="prog' + (c.leftMonth < 0 ? ' over' : '') + '"><i style="width:' + (Math.min(c.spentMonth / state.budget, 1) * 100).toFixed(1) + '%"></i></div><div class="small mute">' + (c.leftMonth >= 0 ? inr(c.leftMonth) + ' left of ' + inr(state.budget) : inr(-c.leftMonth) + ' over your ' + inr(state.budget) + ' limit') + '</div>';
    h += '</div>';
    h += '<div class="card dcard">' + dayStrip(c) + '</div>';
    h += vizCard(c);
    if (s.cats.length) {
      h += '<div class="card"><div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">Where it went</h2><button class="lnk" data-act="goCats">Categories ›</button></div>' + s.cats.map(function (k) {
        var cc = catOf(k[0]), cap = cc && cc.cap > 0 ? cc.cap : 0, ref = cap ? Math.max(cap, k[1]) : s.cats[0][1];
        return '<div class="cat' + (ui.fb === k[0] ? ' on' : '') + '" data-act="fb" data-v="' + esc(k[0]) + '"><div class="l"><span>' + bk(k[0])[0] + ' ' + esc(bk(k[0])[1]) + '</span><span class="num"><b>' + inr(k[1]) + '</b> <span class="mute">' + (cap ? 'of ' + kfmt(cap) : Math.round(k[1] / s.spent * 100) + '%') + '</span></span></div><div class="trk"><i style="width:' + (k[1] / ref * 100).toFixed(1) + '%;background:' + (cap && k[1] > cap ? 'var(--red)' : catColor(k[0])) + '"></i>' + (cap ? '<u style="left:' + (cap / ref * 100).toFixed(1) + '%"></u>' : '') + '</div></div>';
      }).join('') + '</div>';
      var max = 0; for (i = 1; i <= c.dim; i++) if ((c.per[i] || 0) > max) max = c.per[i];
      var tip = ui.selBar > 0 ? '<b>' + inr(c.per[ui.selBar] || 0) + '</b> on the ' + ui.selBar + nth(ui.selBar) : 'Tap a bar to see that day';
      h += '<div class="card"><h2>Day by day</h2><div class="tip">' + tip + '</div><div class="bars">';
      for (i = 1; i <= c.dim; i++) { var v = c.per[i] || 0; h += '<div class="b' + (v ? '' : ' zero') + (i === c.day ? ' today' : '') + (i === ui.selBar ? ' sel' : '') + '" data-act="bar" data-v="' + i + '"><i style="height:' + (max ? Math.max(v / max * 100, v ? 3 : 0) : 0).toFixed(1) + '%;--i:' + i + '"></i></div>'; }
      h += '</div><div class="xl">'; for (i = 1; i <= c.dim; i++) h += '<span>' + (i === 1 || i % 5 === 0 ? i : '') + '</span>'; h += '</div></div>';
    }
    h += '<div class="row" style="margin-bottom:8px"><button class="btn dark" style="margin:0" data-act="wrap">' + mname(state.month) + ' so far ✨</button><button class="btn" style="margin:0" data-act="export">Export</button></div>';
    h += '<button class="btn" style="margin-bottom:12px" data-act="goArch">🗂️ Archive' + (state.archive.length ? ' · ' + state.archive.length + ' past month' + (state.archive.length === 1 ? '' : 's') : '') + '</button>';
    h += '<input type="search" id="q" placeholder="Search" value="' + esc(ui.q) + '">' + (ui.fb ? '<div class="quick"><button data-act="fb" data-v="' + esc(ui.fb) + '">' + bk(ui.fb)[0] + ' ' + esc(bk(ui.fb)[1]) + ' ✕</button></div>' : '') + '<div id="list">' + listHtml() + '</div>';
    return h;
  }
  function nth(d) { return d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'; }
  function listHtml(src, qq, ro) {
    var q = (qq != null ? qq : ui.q).trim().toLowerCase(), list = (src || state.txns).filter(function (t) { return (ro || !ui.fb || t.b === ui.fb) && (!q || ((t.who || '') + ' ' + t.amt + ' ' + (t.note || '') + ' ' + bk(t.b)[1]).toLowerCase().indexOf(q) >= 0); });
    if (!list.length) return '<div class="empty">Nothing to show.</div>';
    var h = '', i = 0;
    while (i < list.length) {
      var d0 = sod(list[i].ts), j = i, tot = 0, d = new Date(d0);
      while (j < list.length && sod(list[j].ts) === d0) { if (list[j].dir === 'out' && list[j].b !== 'moved') tot += list[j].amt; j++; }
      h += '<div class="day"><span>' + (d0 === sod(Date.now()) ? 'Today' : DOW[d.getDay()] + ' ' + d.getDate()) + '</span><span class="num">' + (tot ? inr(tot) : '') + '</span></div><div class="card" style="padding:4px 14px;margin:6px 0 0">' + list.slice(i, j).map(function (t) { return txRow(t, ro); }).join('') + '</div>';
      i = j;
    }
    return h;
  }
  function viewPerm() {
    return '<div class="ob"><div class="logo"></div><h1>One last thing.</h1><p>Slate reads the texts your bank already sends you, so you never type a spend. It needs your OK to see them.</p>' +
      '<button class="btn pri" data-act="askPerm">Allow SMS access</button>' +
      (ui.denied ? '<div class="card" style="margin-top:16px"><b>Blocked by Android?</b><div class="small mute" style="margin:6px 0 10px">For apps installed outside the Play Store: open app settings, tap ⋮ at the top right, choose "Allow restricted settings", then Permissions → SMS → Allow.</div><button class="btn" data-act="appSettings">Open app settings</button></div>' : '') +
      '<p class="small mute" style="margin-top:18px">Slate has no internet access at all. Nothing can leave this phone.</p></div>';
  }
  function viewWelcome() {
    return '<div class="ob"><div class="logo"></div><h1>Know what you can spend today.</h1><p>One number, updated every time your bank texts you.</p>' +
      '<ul><li><b>Zero typing.</b> Slate reads your bank SMS on this phone.</li><li><b>A clean slate every month.</b> On the 1st your screen starts fresh. Last month moves to the Archive, ready to view or export.</li><li><b>Private by design.</b> No account, no cloud, no internet permission.</li></ul>' +
      '<button class="btn pri" data-act="start">Get started</button><button class="btn" style="margin-top:8px" data-act="importStart">I have a Slate export or backup</button></div>';
  }
  function render() {
    nav();
    var v = document.getElementById('view');
    v.className = state.onboarded && ui.perm && ui.tab === 'today' && look() === 'sway' ? 'bleed' : '';
    v.innerHTML = !state.onboarded ? viewWelcome() : !ui.perm ? viewPerm() : ui.tab === 'today' ? viewToday() : ui.tab === 'bals' ? viewBals() : viewMonth();
    v.classList.remove('anim');
    if (ui.anim) { void v.offsetWidth; v.classList.add('anim'); animIn(v); }
    ui.anim = false;
    var ds = document.getElementById('dsr'); if (ds) { var on = ds.querySelector('.on'); if (on) ds.scrollLeft = on.offsetLeft - ds.clientWidth / 2 + on.offsetWidth / 2; }
    if (Object.keys(ui.fresh).length) { clearTimeout(ui.freshT); ui.freshT = setTimeout(function () { ui.fresh = {}; }, 2500); }
  }
  function renderA() { ui.anim = true; render(); }
  function keep() { var v = document.getElementById('view'), st = v.scrollTop; render(); v.scrollTop = st; }
  function tween(el, to) {
    if (!(to > 0) || calm()) return;
    var t0 = null; function step(ts) { if (t0 == null) t0 = ts; var k = Math.min((ts - t0) / 650, 1), e = 1 - Math.pow(1 - k, 3); if (!el.isConnected) return; el.textContent = inr(to * e); if (k < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  // ---------- motion, haptics, confetti ----------
  function calm() { return state.motion === 'calm' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function hap(k) { try { A.haptic(k || 0); } catch (e) { } }
  function confetti(n) {
    hap(1); if (calm()) return;
    var cv = document.createElement('canvas'), g = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight, parts = [], i;
    var acc = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#0b8a5f', cols = [acc, '#f59e0b', '#ec4899', '#3b82f6', '#22c55e', '#a855f7', '#f43f5e'];
    cv.width = W * dpr; cv.height = H * dpr; cv.className = 'confetti'; document.body.appendChild(cv); g.scale(dpr, dpr);
    for (i = 0; i < (n || 90); i++) parts.push({ x: W / 2 + (Math.random() - .5) * 60, y: H * .42, vx: (Math.random() - .5) * 15, vy: -Math.random() * 15 - 5, w: Math.random() * 7 + 5, h: Math.random() * 4 + 3, a: Math.random() * 6, va: (Math.random() - .5) * .35, c: cols[i % cols.length], round: Math.random() < .3 });
    var t0 = performance.now();
    function f(ts) {
      var k = (ts - t0) / 2400; g.clearRect(0, 0, W, H);
      parts.forEach(function (q) { q.vy += .42; q.vx *= .985; q.vy *= .985; q.x += q.vx; q.y += q.vy; q.a += q.va;
        g.save(); g.globalAlpha = Math.max(1 - k * k, 0); g.translate(q.x, q.y); g.rotate(q.a); g.fillStyle = q.c;
        if (q.round) { g.beginPath(); g.arc(0, 0, q.h, 0, 7); g.fill(); } else g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.a * 2)) + 1); g.restore(); });
      if (k < 1) requestAnimationFrame(f); else cv.remove();
    }
    requestAnimationFrame(f);
  }
  document.addEventListener('pointerdown', function (e) {           // a soft ripple wherever you press
    if (calm()) return;
    var el = e.target.closest && e.target.closest('.btn, .pick, .tile, .sortpill, .slim, .lk, .quick button, .vtab, .thm, .glance, .cta, .menu, #nav .add');
    if (!el || el.disabled) return;
    var r = el.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement('span');
    s.className = 'rip'; s.style.width = s.style.height = d + 'px'; s.style.left = (e.clientX - r.left - d / 2) + 'px'; s.style.top = (e.clientY - r.top - d / 2) + 'px';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden'; el.appendChild(s); setTimeout(function () { s.remove(); }, 600);
  }, { passive: true });

  // ---------- colour themes and light / dark ----------
  // name, accent (light), accent (dark), hero from, hero to, glow from, glow to
  var THEMES = {
    emerald: ['Emerald', '#0b8a5f', '#22b583', '#0d9668', '#075f52', '#7c5cff', '#22c7e6'],
    ocean: ['Ocean', '#1f6fd1', '#5aa2ff', '#2f7be5', '#123f8c', '#3b82f6', '#22d3ee'],
    grape: ['Grape', '#7b4bd6', '#a98bff', '#8a5cf0', '#43228f', '#a855f7', '#ec4899'],
    teal: ['Teal', '#0f7f85', '#33c6c8', '#14a3a5', '#0b5560', '#14b8a6', '#a3e635'],
    sunset: ['Sunset', '#d9531e', '#ff8a4c', '#f26a2e', '#a3264f', '#f97316', '#e11d48'],
    rose: ['Rose', '#c92f66', '#ff6f9c', '#e44d7f', '#7c1d55', '#f43f5e', '#c084fc'],
    graphite: ['Graphite', '#374151', '#a5b1c2', '#4b5563', '#111827', '#64748b', '#cbd5e1'],
    aurora: ['Aurora', '#5b5bf0', '#8f8cff', '#6d5dfc', '#0ea5a4', '#7c5cff', '#22c7e6']
  };
  function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function isDark() { var k = look(); if (k === 'glow') return true; if (state.mode === 'dark') return true; if (state.mode === 'light') return false; return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function applyTheme() {
    var k = look(), th = THEMES[state.theme] || THEMES.emerald, dark = isDark(), s = document.body.style;
    document.documentElement.classList.toggle('dk', dark);
    document.body.classList.toggle('aurora', state.theme === 'aurora' && !calm());
    document.body.classList.toggle('calm', calm());
    ['--accent', '--accent-soft', '--g1', '--g2', '--x1', '--x2'].forEach(function (p) { s.removeProperty(p); });
    if (k === 'classic' || k === 'sway') { var a = dark ? th[2] : th[1]; s.setProperty('--accent', a); s.setProperty('--accent-soft', rgba(a, dark ? .16 : .11)); s.setProperty('--g1', th[3]); s.setProperty('--g2', th[4]); }
    else if (k === 'glow') { s.setProperty('--x1', th[5]); s.setProperty('--x2', th[6]); s.setProperty('--accent', th[5]); s.setProperty('--accent-soft', rgba(th[5], .2)); }
  }
  if (window.matchMedia) try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { applyLook(); render(); }); } catch (e) { }
  function themeSheet() {
    var cur = state.theme || 'emerald', k = look();
    sheet('<div class="hd"><b>Colour & mode</b><button class="x" data-act="close">✕</button></div>' +
      '<label class="f" style="margin-top:4px">Colour</label><div class="thms">' + Object.keys(THEMES).map(function (t) {
        var th = THEMES[t]; return '<button class="thm' + (cur === t ? ' on' : '') + (t === 'aurora' ? ' au' : '') + '" data-act="setTheme" data-v="' + t + '"><i style="background:linear-gradient(140deg,' + (k === 'glow' ? th[5] + ',' + th[6] : th[3] + ',' + th[4]) + ')"></i>' + th[0] + '</button>';
      }).join('') + '</div>' + (k === 'paper' ? '<p class="mute small" style="margin:8px 2px 0">Paper keeps its ink-on-paper colours. Colours show in Classic, Sway and Glow.</p>' : '') +
      '<label class="f">Mode</label><div class="seg2">' + [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (m) { return '<button data-act="setMode" data-v="' + m[0] + '" class="' + ((state.mode || 'system') === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      (k === 'glow' ? '<p class="mute small" style="margin:8px 2px 0">Glow is always dark.</p>' : '') +
      '<label class="f">Motion</label><div class="seg2">' + [['lively', '✨ Lively'], ['calm', 'Calm']].map(function (m) { return '<button data-act="setMotion" data-v="' + m[0] + '" class="' + ((state.motion || 'lively') === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<p class="mute small" style="margin:8px 2px 0">Lively adds liquid, confetti, ripples and gentle haptics. Calm keeps things still.</p>' +
      '<button class="btn" style="margin-top:16px" data-act="looks">Change the layout (' + LOOKS[k][0] + ') ›</button>', 'theme');
  }

  // ---------- live visuals ----------
  function spentBy(list) { var by = {}; spends(list).forEach(function (t) { by[t.b] = (by[t.b] || 0) + t.amt; }); return by; }
  function catsSorted(list) { var by = spentBy(list); return Object.keys(by).filter(function (k) { return k !== '?' && k !== 'moved'; }).map(function (k) { return [k, by[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function wavePath(off) { return 'M0 8 Q 27.5 ' + (off ? 0 : 16) + ' 55 8 T 110 8 T 165 8 T 220 8 V 220 H 0 Z'; }
  var tankN = 0;
  function tankSvg(pct, mood) {
    pct = Math.max(0, Math.min(1, pct || 0)); var id = 'tk' + (++tankN), y = 8 + (1 - pct) * 134;
    var col = mood === 'over' ? 'var(--red)' : mood === 'tight' ? 'var(--amber)' : mood === 'plain' ? 'var(--mute)' : 'var(--accent)';
    return '<svg class="tank ' + mood + '" viewBox="0 0 110 150" aria-hidden="true"><defs><clipPath id="' + id + '"><rect x="7" y="7" width="96" height="136" rx="28"/></clipPath></defs>' +
      '<rect class="glass" x="5" y="5" width="100" height="140" rx="30"/><g clip-path="url(#' + id + ')"><g class="lvl" data-y="' + y.toFixed(1) + '" style="transform:translateY(' + (ui.anim && !calm() ? 150 : y).toFixed(1) + 'px)">' +
      '<path class="w2" style="fill:' + col + '" d="' + wavePath(1) + '"/><path class="w1" style="fill:' + col + '" d="' + wavePath(0) + '"/>' +
      (pct > .04 ? '<circle class="bb b1" cx="30" cy="70" r="3"/><circle class="bb b2" cx="62" cy="80" r="2.2"/><circle class="bb b3" cx="80" cy="64" r="2.8"/>' : '') +
      '</g></g><path class="shine" d="M24 30 Q 20 60 24 96"/></svg>';
  }
  function dayFrac() { var n = new Date(); return (n.getHours() * 60 + n.getMinutes()) / 1440; }
  function pace(c) {
    var fx = c.fx, varBudget = Math.max(state.budget - fx.total, 1), varSpent = Math.max(c.spentMonth - fx.paid, 0), elapsed = Math.max(c.day - 1 + dayFrac(), .25);
    var timePct = Math.min(elapsed / c.dim, 1), usedPct = varSpent / varBudget, proj = varSpent / elapsed * c.dim + fx.total;
    return { timePct: timePct, usedPct: usedPct, gap: timePct * varBudget - varSpent, proj: proj };
  }
  function glance(c) {
    if (!(state.budget > 0)) return '<button class="card glance" data-act="budget">' + tankSvg(.62, 'plain') + '<span class="gi"><b>See your month as a tank</b><span class="mute small">Set a monthly limit and watch what is left drain as you spend. Amber when you are running fast, red when you go over.</span><span class="chip">Set a limit ›</span></span></button>';
    var left = Math.max(c.leftMonth, 0), pc2 = pace(c), ahead = pc2.gap < 0;
    return '<div class="card glance" data-act="viz" data-v="pace">' + tankSvg(left / state.budget, c.mood) + '<div class="gi"><span class="mute small" style="font-weight:700">LEFT THIS MONTH</span><b class="num gbig" data-count="' + left + '">' + inr(left) + '</b><span class="mute small">of ' + inr(state.budget) + '</span>' +
      '<div class="pbar"><span>Month gone</span><div><i style="width:' + (pc2.timePct * 100).toFixed(0) + '%"></i></div><b class="num">' + Math.round(pc2.timePct * 100) + '%</b></div>' +
      '<div class="pbar ' + (ahead ? 'hot' : '') + '"><span>Spending used</span><div><i style="width:' + Math.min(pc2.usedPct * 100, 100).toFixed(0) + '%"></i></div><b class="num">' + Math.round(pc2.usedPct * 100) + '%</b></div>' +
      '<span class="verdict ' + (ahead ? 'hot' : 'ok') + '">' + (ahead ? '🏃 ' + inr(-pc2.gap) + ' ahead of pace' : '🐢 ' + inr(pc2.gap) + ' under pace') + '</span></div></div>';
  }
  function paceSvg(c) {
    var W = 320, H = 130, L = 6, R = 6, T = 10, Bm = 20, dimN = c.dim, cum = [], run = 0, i, max = state.budget || 0, p2 = state.budget > 0 ? pace(c) : null;
    for (i = 1; i <= c.day; i++) { run += c.per[i] || 0; cum.push(run); }
    var proj = p2 ? p2.proj : run / Math.max(c.day - 1 + dayFrac(), .25) * dimN;
    max = Math.max(max, proj, run, 1) * 1.08;
    function X(d) { return L + (d / dimN) * (W - L - R); } function Y(v) { return T + (1 - v / max) * (H - T - Bm); }
    var line = 'M' + X(0) + ' ' + Y(0) + cum.map(function (v, j) { return ' L' + X(j + 1).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('');
    var area = line + ' L' + X(c.day).toFixed(1) + ' ' + Y(0) + ' Z', over = state.budget > 0 && proj > state.budget;
    var h = '<svg class="pace" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="pg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
    if (state.budget > 0) h += '<line class="lim" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(state.budget).toFixed(1) + '" y2="' + Y(state.budget).toFixed(1) + '"/><text class="lt" x="' + (W - R) + '" y="' + (Y(state.budget) - 4).toFixed(1) + '" text-anchor="end">Limit ' + inr(state.budget) + '</text>' +
      '<line class="ideal" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(dimN).toFixed(1) + '" y2="' + Y(state.budget).toFixed(1) + '"/>';
    h += '<path class="ar" d="' + area + '"/><path class="ln" pathLength="1" d="' + line + '"/>' +
      '<line class="pj' + (over ? ' hot' : '') + '" x1="' + X(c.day).toFixed(1) + '" y1="' + Y(run).toFixed(1) + '" x2="' + X(dimN).toFixed(1) + '" y2="' + Y(proj).toFixed(1) + '"/>' +
      '<circle class="dot" cx="' + X(c.day).toFixed(1) + '" cy="' + Y(run).toFixed(1) + '" r="5"/><circle class="pulse" cx="' + X(c.day).toFixed(1) + '" cy="' + Y(run).toFixed(1) + '" r="5"/>' +
      '<text class="ax" x="' + L + '" y="' + (H - 4) + '">1</text><text class="ax" x="' + X(c.day).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">Today</text><text class="ax" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + dimN + '</text></svg>';
    return h + '<div class="legend"><span><i class="k1"></i>You</span>' + (state.budget > 0 ? '<span><i class="k2"></i>Even pace</span>' : '') + '<span><i class="k3' + (over ? ' hot' : '') + '"></i>Where you are heading</span></div>' +
      '<p class="vnote">At this rate you will spend about <b class="num">' + inr(proj) + '</b> by the ' + dimN + nth(dimN) + (state.budget > 0 ? (over ? ', <b style="color:var(--red)">' + inr(proj - state.budget) + ' over</b> your limit.' : ', <b style="color:var(--accent)">' + inr(state.budget - proj) + ' under</b> your limit.') : '.') + '</p>';
  }
  function donutSvg(cats, total, act) {
    if (!total) return '<div class="empty">Nothing spent yet.</div>';
    var r = 62, C = 2 * Math.PI * r, at = 0, gap = cats.length > 1 ? 2.2 : 0, h = '<div class="donut"><svg viewBox="0 0 160 160">';
    h += '<circle cx="80" cy="80" r="' + r + '" class="dt"/>';
    cats.forEach(function (k, i) {
      var len = Math.max(k[1] / total * C - gap, .8);
      h += '<circle class="seg' + (ui.fb && ui.fb !== k[0] ? ' dim' : '') + '" cx="80" cy="80" r="' + r + '" stroke="' + catColor(k[0]) + '" style="--len:' + len.toFixed(1) + ';--c:' + C.toFixed(1) + ';--i:' + i + '" stroke-dasharray="' + len.toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-at).toFixed(1) + '"' + (act ? ' data-act="' + act + '" data-v="' + esc(k[0]) + '"' : '') + '/>';
      at += k[1] / total * C;
    });
    var focus = ui.fb && act ? cats.filter(function (k) { return k[0] === ui.fb; })[0] : null;
    h += '</svg><div class="dc">' + (focus ? '<span class="e">' + bk(focus[0])[0] + '</span><b class="num">' + inr(focus[1]) + '</b><span>' + Math.round(focus[1] / total * 100) + '% · ' + esc(bk(focus[0])[1]) + '</span>' : '<b class="num" data-count="' + total + '">' + inr(total) + '</b><span>spent</span>') + '</div></div>';
    h += '<div class="dl">' + cats.slice(0, 8).map(function (k) { return '<button class="' + (ui.fb === k[0] ? 'on' : '') + '"' + (act ? ' data-act="' + act + '" data-v="' + esc(k[0]) + '"' : '') + '><i style="background:' + catColor(k[0]) + '"></i>' + bk(k[0])[0] + ' ' + esc(bk(k[0])[1]) + ' <b class="num">' + Math.round(k[1] / total * 100) + '%</b></button>'; }).join('') + '</div>';
    return h;
  }
  function waffle(cats, total) {
    if (!total) return '<div class="empty">Nothing spent yet.</div>';
    var cells = [], rem = [], used = 0, h;
    cats.forEach(function (k, i) { var x = k[1] / total * 100, f = Math.floor(x); cells.push(f); used += f; rem.push([x - f, i]); });
    rem.sort(function (a, b) { return b[0] - a[0]; }); for (var j = 0; used < 100 && j < rem.length; j++, used++) cells[rem[j][1]]++;
    h = '<div class="waf">'; var n = 0;
    cats.forEach(function (k, i) { for (var c = 0; c < cells[i]; c++, n++) h += '<i style="background:' + catColor(k[0]) + ';--i:' + n + '" title="' + esc(bk(k[0])[1]) + '"></i>'; });
    h += '</div><p class="vnote">Of every <b>₹100</b> you spent: ' + cats.slice(0, 4).filter(function (k, i) { return cells[i]; }).map(function (k) { return '<b class="num">₹' + cells[cats.indexOf(k)] + '</b> ' + bk(k[0])[0] + ' ' + esc(bk(k[0])[1]); }).join(', ') + (cats.length > 4 ? ', and the rest on everything else' : '') + '.</p>';
    return h;
  }
  function heatmap(per, mk, uptoDay, budget, act) {
    var a = mk.split('-'), y = +a[0], m = +a[1] - 1, dimN = new Date(y, m + 1, 0).getDate(), first = (new Date(y, m, 1).getDay() + 6) % 7, lim = budget > 0 ? budget / dimN : 0, max = 1, i;
    for (i = 1; i <= dimN; i++) if ((per[i] || 0) > max) max = per[i];
    var h = '<div class="heat"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>';
    for (i = 0; i < first; i++) h += '<b class="pad"></b>';
    for (i = 1; i <= dimN; i++) {
      var v = per[i] || 0, fut = i > uptoDay, lv = fut ? 'f' : !v ? 'z' : lim && v > lim ? 'r' : v / max > .66 ? 'l3' : v / max > .33 ? 'l2' : 'l1';
      h += '<b class="' + lv + (i === uptoDay && act ? ' now' : '') + (ui.selBar === i && act ? ' sel' : '') + '" style="--i:' + i + '"' + (act && !fut ? ' data-act="' + act + '" data-v="' + i + '"' : '') + '>' + i + '</b>';
    }
    return h + '</div><div class="legend"><span><i class="hz"></i>No spend</span><span><i class="h1"></i>Light</span><span><i class="h3"></i>Heavy</span>' + (lim ? '<span><i class="hr"></i>Over the day\'s share</span>' : '') + '</div>';
  }
  function monthsChart() {
    var rows = state.archive.slice(0, 5).reverse().map(function (e) { return [e.month, e.w.spent, e.budget, false]; });
    rows.push([state.month, calc().spentMonth, state.budget, true]);
    var max = 1; rows.forEach(function (r) { if (r[1] > max) max = r[1]; if (r[2] > max) max = r[2]; });
    return '<div class="mchart">' + rows.map(function (r, i) {
      return '<div class="mc' + (r[3] ? ' now' : '') + '"' + (r[3] ? '' : ' data-act="archOpen" data-v="' + r[0] + '"') + '><b class="num">' + kfmt(r[1]) + '</b><div class="col"><i style="height:' + (r[1] / max * 100).toFixed(1) + '%;--i:' + i + '"></i>' + (r[2] > 0 ? '<u style="bottom:' + (r[2] / max * 100).toFixed(1) + '%"></u>' : '') + '</div><span>' + MON[+r[0].split('-')[1] - 1].slice(0, 3) + '</span></div>';
    }).join('') + '</div>';
  }
  function kfmt(v) { return v >= 100000 ? '₹' + (v / 100000).toFixed(v >= 1000000 ? 0 : 1) + 'L' : v >= 1000 ? '₹' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : inr(v); }
  function vizCard(c) {
    var cats = catsSorted(), tot = c.spentMonth, tabs = [['donut', 'Donut'], ['waffle', '₹100'], ['pace', 'Pace'], ['cal', 'Calendar']];
    if (state.archive.length) tabs.push(['months', 'Months']);
    if (!tabs.some(function (t) { return t[0] === ui.viz; })) ui.viz = 'donut';
    var body = ui.viz === 'waffle' ? waffle(cats, tot) : ui.viz === 'pace' ? paceSvg(c) : ui.viz === 'cal' ? heatmap(c.per, state.month, c.day, state.budget, 'bar') : ui.viz === 'months' ? monthsChart() + '<p class="vnote">Tap a past month to open it from the Archive. The line on each bar is that month\'s limit.</p>' : donutSvg(cats, tot, 'fb');
    return '<div class="card viz"><div class="vtabs">' + tabs.map(function (t) { return '<button class="vtab' + (ui.viz === t[0] ? ' on' : '') + '" data-act="viz" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="vbody" key="' + ui.viz + '">' + body + '</div></div>';
  }
  function capAlerts() {
    var by = spentBy(), out = [];
    state.cats.forEach(function (c) { if (c.cap > 0 && (by[c.k] || 0) >= c.cap * .8) out.push([c, by[c.k] || 0]); });
    return out.sort(function (a, b) { return b[1] / b[0].cap - a[1] / a[0].cap; });
  }
  function capChips() {
    var al = capAlerts(); if (!al.length) return '';
    return '<div class="caps">' + al.slice(0, 3).map(function (x) { var c = x[0], p = x[1] / c.cap, over = p > 1;
      return '<button class="capc' + (over ? ' over' : '') + '" data-act="goCats"><span>' + c.e + '</span><span class="grow"><b>' + esc(c.n) + (over ? ' is over its cap' : ' is close to its cap') + '</b><span class="mini"><i style="width:' + Math.min(p * 100, 100).toFixed(0) + '%;background:' + (over ? 'var(--red)' : c.c) + '"></i></span></span><b class="num">' + Math.round(p * 100) + '%</b></button>'; }).join('') + '</div>';
  }
  function moneyFlow() {
    var bt = balTotals(); if (!bt.set) return '';
    var fx = fxState(), io = iouTotals(), free = bt.have - bt.owe - fx.reserve - io.owe, steps = [['In bank and cash', bt.have, 'pos']];
    if (bt.owe) steps.push(['Card dues', -bt.owe, 'neg']); if (fx.reserve) steps.push(['Fixed payments still due', -fx.reserve, 'neg']); if (io.owe) steps.push(['Money you owe people', -io.owe, 'neg']); var gsv = goalsSaved(); if (gsv) steps.push(['Set aside for goals', -gsv, 'goal']); free -= gsv;
    var max = Math.max(bt.have, 1), at = 0, h = '<div class="card flow"><h2>Truly free to use</h2><div class="fbig num ' + (free < 0 ? 'neg' : '') + '" data-count="' + Math.abs(free) + '">' + inr(free) + '</div><div class="mute small" style="margin-bottom:10px">What is left after card dues, fixed payments, IOUs and goal savings</div>';
    steps.forEach(function (s, i) {
      var w = Math.abs(s[1]) / max * 100, left = s[1] >= 0 ? at : Math.max(at - w, 0); if (s[1] < 0) w = Math.min(w, at); at = s[1] >= 0 ? at + w : left;
      h += '<div class="fl"><span class="ell">' + s[0] + '</span><div class="ft"><i class="' + s[2] + '" style="left:' + left.toFixed(1) + '%;width:' + Math.max(w, .8).toFixed(1) + '%;--i:' + i + '"></i></div><b class="num">' + (s[1] < 0 ? '−' : '') + kfmt(Math.abs(s[1])) + '</b></div>';
    });
    h += '<div class="fl total"><span>Free</span><div class="ft"><i class="' + (free < 0 ? 'neg' : 'free') + '" style="left:0;width:' + Math.max(Math.min(Math.abs(free) / max * 100, 100), .8).toFixed(1) + '%;--i:' + steps.length + '"></i></div><b class="num">' + (free < 0 ? '−' : '') + kfmt(Math.abs(free)) + '</b></div>';
    if (io.owed) h += '<p class="vnote">Plus <b class="num">' + inr(io.owed) + '</b> people owe you, not counted until it comes back.</p>';
    return h + '</div>';
  }
  function acctShare() {
    var parts = []; Object.keys(state.accts).forEach(function (k) { var a = state.accts[k], b = balOf(k); if (b && a.type !== 'card' && b.v > 0) parts.push([k, b.v]); });
    if (parts.length < 2) return '';
    var tot = 0; parts.forEach(function (p) { tot += p[1]; }); parts.sort(function (a, b) { return b[1] - a[1]; });
    var cols = ['var(--accent)', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#94a3b8'];
    return '<div class="card"><h2>Where your money sits</h2><div class="share">' + parts.map(function (p, i) { return '<i style="width:' + (p[1] / tot * 100).toFixed(2) + '%;background:' + cols[i % cols.length] + ';--i:' + i + '"></i>'; }).join('') + '</div><div class="dl" style="margin-top:10px">' +
      parts.map(function (p, i) { return '<button><i style="background:' + cols[i % cols.length] + '"></i>' + esc(p[0]) + ' <b class="num">' + Math.round(p[1] / tot * 100) + '%</b></button>'; }).join('') + '</div></div>';
  }

  // ---------- the archive: every month that clears is kept here ----------
  function dimOf(mk) { var a = mk.split('-'); return new Date(+a[0], +a[1], 0).getDate(); }
  function mlong(mk) { var a = mk.split('-'); return MON[+a[1] - 1] + ' ' + a[0]; }
  function compact(t) { var o = { id: t.id, ts: t.ts, amt: t.amt, dir: t.dir, who: t.who || '', b: t.b, acct: t.acct || '' }; if (t.note) o.note = t.note; return o; }
  function wrapOf(txns, mk, budget, days) {
    var sp = spends(txns), by = {}, cnt = {}, big = null, per = {}, total = 0, moneyIn = 0, i;
    sp.forEach(function (t) { total += t.amt; by[t.b] = (by[t.b] || 0) + t.amt; var w = t.who || 'Unknown'; cnt[w] = (cnt[w] || 0) + 1; if (!big || t.amt > big.amt) big = t; var d = new Date(t.ts).getDate(); per[d] = (per[d] || 0) + t.amt; });
    txns.forEach(function (t) { if (t.dir === 'in' && t.b !== 'moved') moneyIn += t.amt; });
    var cats = Object.keys(by).filter(function (k) { return k !== 'moved' && k !== '?'; }).map(function (k) { return [k, by[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var fav = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0], zero = 0, best = 0, run = 0, lim = budget > 0 ? budget / dimOf(mk) : 0;
    for (i = 1; i <= days; i++) { var v = per[i] || 0; if (!v) zero++; if (lim && v <= lim) { run++; if (run > best) best = run; } else run = 0; }
    return { month: mk, spent: total, budget: budget, n: sp.length, cats: cats, top: cats[0] ? cats[0][0] : '', big: big ? { who: big.who || 'Unknown', amt: big.amt } : null,
      fav: fav && cnt[fav] > 1 ? { who: fav, n: cnt[fav] } : null, zero: zero, best: best, avg: total / Math.max(days, 1), moneyIn: moneyIn, days: days, per: per };
  }
  function archiveNow(days) {
    if (!state.txns.length) return null;
    var mk = state.month, e = null, list = state.txns.map(compact), snap = {};
    state.archive.forEach(function (x) { if (x.month === mk) e = x; });
    if (e) { var seen = {}; e.txns.forEach(function (t) { if (t.id) seen[t.id] = 1; }); e.txns = e.txns.concat(list.filter(function (t) { return !t.id || !seen[t.id]; })); }
    else { e = { month: mk, txns: list }; state.archive.push(e); }
    e.txns.sort(function (a, b) { return b.ts - a.ts; });
    state.archive.sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    e.ts = Date.now(); e.budget = state.budget; e.days = Math.max(e.days || 0, days);
    e.txns.forEach(function (t) { snap[t.b] = bk(t.b); }); e.cats = snap;
    e.w = wrapOf(e.txns, mk, e.budget, e.days);
    if (state.keepMonths > 0) { var d = new Date(), cut = mkey(new Date(d.getFullYear(), d.getMonth() - state.keepMonths, 1)); state.archive = state.archive.filter(function (x) { return x.month > cut; }); }
    return e;
  }
  function archEntry(mk) { return state.archive.filter(function (x) { return x.month === mk; })[0]; }
  function spark(per, mk) {
    var n = dimOf(mk), max = 1, i, h = ''; for (i = 1; i <= n; i++) if ((per[i] || 0) > max) max = per[i];
    for (i = 1; i <= n; i++) h += '<i style="height:' + Math.max((per[i] || 0) / max * 100, 6).toFixed(0) + '%' + (per[i] ? '' : ';opacity:.25') + '"></i>';
    return '<span class="spark">' + h + '</span>';
  }
  function archiveLayer() {
    ui.catSnap = null;
    var h = '<div class="row"><b class="grow" style="font-size:18px">Archive</b><button class="x" data-act="closeFull">✕</button></div>' +
      '<p class="mute small" style="margin:8px 2px 14px">The slate is wiped, the history is not. Every month that clears is kept here, read-only. Open one to see its wrap, charts and every spend, or export it.</p>';
    if (!state.archive.length) h += '<div class="card"><div class="empty" style="padding:14px 6px">Nothing here yet.<br>On the 1st, ' + mname(state.month) + ' moves here on its own.</div></div>';
    else {
      h += '<div class="card"><h2>Month by month</h2>' + monthsChart() + '</div><div class="card" style="padding:4px 16px">' + state.archive.map(function (e) {
        var w = e.w, d = w.budget > 0 ? w.budget - w.spent : null;
        return '<div class="tx" data-act="archOpen" data-v="' + e.month + '"><div class="em">🗂️</div><div class="grow"><div class="who">' + mlong(e.month) + '</div><div class="meta ell">' + w.n + ' spends' + (d != null ? ' · ' + (d >= 0 ? inr(d) + ' under' : inr(-d) + ' over') : '') + '</div>' + spark(w.per || {}, e.month) + '</div><div class="amt num">' + inr(w.spent) + '</div></div>';
      }).join('') + '</div>';
    }
    h += '<div class="card" style="padding:4px 16px"><div class="kv" data-act="keepAsk"><span><b>Keep months for</b><br><span class="mute small">' + (state.keepMonths > 0 ? state.keepMonths + ' months, then the oldest go' : 'Forever') + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="backup"><span><b>Back up everything</b><br><span class="mute small">One file in Downloads with every month, category and setting</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="importStart"><span><b>Import an export or backup</b><br><span class="mute small">A Slate spreadsheet from any month, or a full backup from another phone</span></span><span class="mute">›</span></div></div>';
    full(h, 'archive');
  }
  function archMonth(mk) {
    var e = archEntry(mk); if (!e) return;
    ui.catSnap = e.cats || {}; ui.arch = e; ui.aq = ''; ui.fb = '';
    var h = '<div class="row"><button class="x" data-act="archBack" aria-label="Back">‹</button><b class="grow" style="font-size:18px">' + mlong(mk) + '</b><button class="x" data-act="closeFull">✕</button></div>' + wrapHtml(e.w, false);
    h += '<div class="card"><h2>Where it went</h2>' + donutSvg(e.w.cats, e.w.spent, '') + '</div><div class="card"><h2>The month as a calendar</h2>' + heatmap(e.w.per || {}, mk, e.days, e.budget, '') + '</div>';
    h += '<div class="row" style="margin-bottom:12px"><button class="btn pri" style="margin:0" data-act="archCsv">Export spreadsheet</button><button class="btn" style="margin:0" data-act="archImg">Share picture</button></div>';
    h += '<input type="search" id="aq" placeholder="Search ' + e.txns.length + ' transactions"><div id="alist">' + listHtml(e.txns, '', true) + '</div><button class="btn danger" style="margin-top:16px" data-act="archDel">Delete ' + mname(mk) + ' from the archive</button>';
    full(h, 'archMonth');
    animIn(document.getElementById('full'));
  }

  // ---------- wallet pocket, date strip, floating dock (inspired by the reference screens) ----------
  function walletHero() {
    var bt = balTotals(), ks = Object.keys(state.accts).filter(function (k) { return k !== 'Cash'; }).sort(function (a, b) { return (balOf(b) ? 1 : 0) - (balOf(a) ? 1 : 0); }).slice(0, 3);
    if (!ks.length) ks = ['Cash'];
    return '<div class="wallet' + (ui.fan ? ' fan' : '') + '" data-act="fan">' + ks.map(function (k, i) {
      var b = balOf(k), a = state.accts[k]; return '<div class="wc" style="--i:' + i + '"><span class="ell">' + esc(k) + '</span><em>' + (a.type === 'card' ? 'CREDIT' : a.type === 'cash' ? 'CASH' : 'BANK') + '</em><b class="num">' + (b ? (a.type === 'card' ? 'Owe ' : '') + inr(b.v) : 'Tap below to set') + '</b></div>';
    }).join('') + '<div class="pocket"><span class="pl">Total in hand</span><b class="num"' + (bt.set ? ' data-count="' + Math.max(bt.have, 0) + '"' : '') + '>' + (bt.set ? inr(bt.have) : '—') + '</b><span class="pr">' + (bt.owe ? '<span>💳 ' + inr(bt.owe) + ' on cards</span>' : '') + '<span class="fanb">' + (ui.fan ? 'Tuck in' : 'Peek') + '</span></span></div></div>';
  }
  function dayStrip(c) {
    var sel = ui.selBar > 0 ? ui.selBar : c.day, a = state.month.split('-'), h = '<div class="dstrip"><div class="dsh"><b>' + mname(state.month) + '</b><span>' + (sel === c.day ? 'Today' : DOW[new Date(+a[0], +a[1] - 1, sel).getDay()] + ' ' + sel) + ' · ' + inr(c.per[sel] || 0) + '</span></div><div class="dsr" id="dsr">';
    for (var i = 1; i <= c.day; i++) { var d = new Date(+a[0], +a[1] - 1, i); h += '<button class="dd' + (i === sel ? ' on' : '') + ((c.per[i] || 0) ? ' has' : '') + '" data-act="bar" data-v="' + i + '"><span>' + DOW[d.getDay()] + '</span><b>' + i + '</b><i></i></button>'; }
    h += '</div></div>';
    var list = state.txns.filter(function (t) { return new Date(t.ts).getDate() === sel; }).slice().sort(function (x, y) { return x.ts - y.ts; }), now = Date.now(), nowDone = sel !== c.day;
    h += '<div class="tline">';
    if (!list.length) h += '<div class="empty" style="padding:16px">Nothing on this day. A no-spend day 🌿</div>';
    list.forEach(function (t) {
      if (!nowDone && t.ts > now) { h += '<div class="nowl"><i></i></div>'; nowDone = true; }
      h += '<div class="tli"><span class="tt">' + time(t.ts) + '</span><div class="tc" data-act="edit" data-v="' + esc(t.id) + '" style="--cc:' + catColor(t.b) + '"><b class="ell">' + esc(t.who || (t.dir === 'in' ? 'Money in' : 'Unknown')) + '</b><span>' + bk(t.b)[0] + ' ' + esc(bk(t.b)[1]) + '</span><em class="num' + (t.dir === 'in' ? ' in' : '') + '">' + (t.dir === 'in' ? '+' : '') + inr(t.amt) + '</em></div></div>';
    });
    if (!nowDone && list.length) h += '<div class="nowl"><i></i></div>';
    return h + '</div>';
  }
  function dockHtml() {
    var n = toSort().length;
    function b(act, ic, label, badge) { return '<button data-act="' + act + '" aria-label="' + label + '"><span>' + ic + '</span><em>' + label + '</em>' + (badge ? '<u>' + badge + '</u>' : '') + '</button>'; }
    return '<div class="dock' + (ui.dock ? ' open' : '') + '"><div class="dkl">' + b('dkSort', '❓', 'Sort', n) + b('dkGoals', '🎯', 'Goals') + b('dkCats', '🏷️', 'Categories') + b('dkArch', '🗂️', 'Archive') + b('dkTheme', '🎨', 'Colours') + b('dkFixed', '📌', 'Fixed') + '</div>' +
      '<button class="dkb" data-act="dock" aria-label="Quick menu"><i></i><i></i><i></i></button></div>';
  }

  // ---------- categories screen ----------
  function catsLayer() {
    var by = spentBy();
    var h = '<div class="row"><b class="grow" style="font-size:18px">Categories</b><button class="x" data-act="closeFull">✕</button></div><p class="mute small" style="margin:8px 2px 12px">Add your own, rename, recolour, give one a monthly cap, reorder, or hide the ones you never use.</p>';
    h += '<button class="btn pri" data-act="catNew">＋ Add a category</button><div class="card" style="padding:4px 14px;margin-top:12px">' + state.cats.map(function (c, i) {
      var sp = by[c.k] || 0, cap = c.cap > 0;
      return '<div class="tx catrow' + (c.hide ? ' off' : '') + '" data-act="catOpen" data-v="' + esc(c.k) + '"><div class="em" style="background:' + rgba(c.c, .16) + '">' + c.e + '</div><div class="grow"><div class="who ell">' + esc(c.n) + (c.hide ? ' <span class="mute small">· hidden</span>' : '') + '</div>' +
        (cap ? '<span class="mini"><i style="width:' + Math.min(sp / c.cap * 100, 100).toFixed(0) + '%;background:' + (sp > c.cap ? 'var(--red)' : c.c) + '"></i></span><div class="meta">' + inr(sp) + ' of ' + inr(c.cap) + ' cap</div>' : '<div class="meta">' + (sp ? inr(sp) + ' this month' : 'Nothing this month') + '</div>') +
        '</div><div class="ord"><button data-act="catUp" data-v="' + esc(c.k) + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>▲</button><button data-act="catDown" data-v="' + esc(c.k) + '" aria-label="Move down"' + (i < state.cats.length - 1 ? '' : ' disabled') + '>▼</button></div></div>';
    }).join('') + '</div>';
    full(h, 'cats');
  }
  function catSheet(c, isNew) {
    ui.cat = { c: c, isNew: isNew, e: c.e, col: c.c };
    var used = state.txns.filter(function (t) { return t.b === c.k; }).length;
    var h = '<div class="hd"><b>' + (isNew ? 'New category' : esc(c.n)) + '</b><button class="x" data-act="catClose">✕</button></div>' +
      '<div class="catprev"><span id="cPrev" style="background:' + c.c + '">' + c.e + '</span></div>' +
      '<label class="f">Name</label><input type="text" id="cName" maxlength="24" value="' + esc(c.n) + '" placeholder="e.g. Chai & snacks">' +
      '<label class="f">Icon</label><div class="emo" id="cEmo">' + EMO.map(function (e) { return '<button data-act="cEmo" data-v="' + e + '"' + (e === c.e ? ' class="on"' : '') + '>' + e + '</button>'; }).join('') + '</div>' +
      '<input type="text" id="cEmoIn" maxlength="8" placeholder="Or type any emoji" style="margin-top:8px">' +
      '<label class="f">Colour</label><div class="swatch" id="cCol">' + SW.map(function (x) { return '<button data-act="cCol" data-v="' + x + '" style="background:' + x + '"' + (x === c.c ? ' class="on"' : '') + ' aria-label="Colour"></button>'; }).join('') + '</div>' +
      '<label class="f">Monthly cap (optional)</label><input type="number" id="cCap" inputmode="numeric" placeholder="No cap" value="' + (c.cap || '') + '">' +
      '<p class="mute small" style="margin:6px 2px 0">A bar fills as you spend, and Slate flags it on Today when you pass 80%.</p>' +
      '<div style="margin-top:16px"><button class="btn pri" data-act="catSave">' + (isNew ? 'Add category' : 'Save') + '</button>' +
      (isNew ? '' : '<button class="btn" data-act="catHide">' + (c.hide ? 'Show it in the picker again' : 'Hide from the picker') + '</button>' + (c.custom ? '<button class="btn danger" data-act="catDel">Delete' + (used ? ' (' + used + ' spend' + (used === 1 ? '' : 's') + ' move to Other)' : '') + '</button>' : '')) + '</div>';
    sheet(h, 'cat');
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function clean(s) { return String(s || '').replace(/[<>"\\]/g, '').trim(); }
  function animIn(root) {
    if (!root) return;
    var els = root.querySelectorAll('[data-count]'), i;
    for (i = 0; i < els.length; i++) tween(els[i], +els[i].getAttribute('data-count'));
    setTimeout(function () {
      var lv = root.querySelectorAll('.lvl'); for (i = 0; i < lv.length; i++) lv[i].style.transform = 'translateY(' + lv[i].getAttribute('data-y') + 'px)';
      var f = root.querySelector('.ring .f, .ringhero .f'); if (f) f.setAttribute('stroke-dashoffset', f.getAttribute('data-to'));
      var b = root.querySelector('.hero .bar i'); if (b) b.style.width = b.getAttribute('data-w') + '%';
    }, 60);
  }

  // ---------- import: a spreadsheet exported from any Slate version, or a full backup ----------
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false, i, ch;
    text = String(text || '').replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0]) rows.push(row); row = []; }
      else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function unguard(s) { s = String(s == null ? '' : s).trim(); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; }
  function minuteKey(ts, amt, dir) { return Math.floor(ts / 60000) + '|' + Math.round(amt * 100) + '|' + dir; }
  var CAT_ALIAS = { 'people': 'people', 'bills & home': 'bills', 'not a spend': 'moved', 'unsorted': '?', 'family & friends': 'people' };
  function csvRows(text) {      // -> [{ts, amt, dir, who, cat, acct, note}] or null if this is not a Slate export
    var rows = parseCsv(text); if (!rows.length) return null;
    var h = rows[0].map(function (x) { return x.trim().toLowerCase(); }), ix = function (n) { return h.indexOf(n); };
    if (ix('date') < 0 || ix('amount') < 0) return null;
    var out = [];
    rows.slice(1).forEach(function (r) {
      var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r[ix('date')] || ''), amt = parseFloat(String(r[ix('amount')] || '').replace(/[^\d.]/g, ''));
      if (!d || !(amt > 0)) return;
      var tm = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(r[ix('time')] || ''), hh = 12, mm = 0;
      if (tm) { hh = +tm[1] % 12; mm = +tm[2]; if (/pm/i.test(tm[3] || '')) hh += 12; if (!tm[3]) hh = +tm[1]; }
      var ty = String(r[ix('type')] || '').toLowerCase();
      out.push({ ts: new Date(+d[1], +d[2] - 1, +d[3], hh, mm).getTime(), amt: amt, dir: /receiv|credit|in/.test(ty) ? 'in' : 'out',
        who: unguard(r[ix('paid to / from')]), cat: unguard(r[ix('category')]), acct: unguard(r[ix('account')]), note: unguard(r[ix('note')]) });
    });
    return out;
  }
  function catForName(name, made) {
    var n = String(name || '').trim(), l = n.toLowerCase(); if (!n) return '?';
    if (CAT_ALIAS[l]) return CAT_ALIAS[l];
    var cl = clean(n).toLowerCase();
    for (var i = 0; i < state.cats.length; i++) { var cn = state.cats[i].n.toLowerCase(); if (cn === l || cn === cl) return state.cats[i].k; }
    var c = { k: 'u' + Date.now().toString(36) + state.cats.length, e: '🏷️', n: clean(n).slice(0, 24) || 'Imported', c: SW[(state.cats.length * 5) % SW.length], custom: true };
    state.cats.push(c); buildCats(); made.push(c.n); return c.k;
  }
  function importRows(list) {
    var made = [], res = { matched: 0, added: 0, past: 0, months: {}, cats: made }, idx = {}, used = {};
    state.txns.forEach(function (t) { var k = minuteKey(t.ts, t.amt, t.dir); (idx[k] = idx[k] || []).push(t); });
    list.forEach(function (r) {
      var b = catForName(r.cat, made), mk = mkey(new Date(r.ts));
      if (mk > state.month) return;
      var key = minuteKey(r.ts, r.amt, r.dir);
      if (mk === state.month) {
        var hit = (idx[key] || []).filter(function (t) { return !used[t.id]; })[0];
        if (hit) { used[hit.id] = 1; if (b !== '?') hit.b = b; if (r.note) hit.note = r.note; hit.edited = true; if (b !== '?') learn(hit); res.matched++; }
        else { var t = { id: 'i' + r.ts.toString(36) + Math.round(r.amt * 100).toString(36), ts: r.ts, amt: r.amt, dir: r.dir, who: r.who, b: b, acct: r.acct || '', note: r.note || '', edited: true };
          if (!find(t.id)) { state.txns.push(t); used[t.id] = 1; (idx[key] = idx[key] || []).push(t); if (b !== '?') learn(t); res.added++; } }
      } else {                  // an earlier month goes straight into the Archive
        var e = archEntry(mk); if (!e) { e = { month: mk, txns: [], budget: state.budget, days: dimOf(mk) }; state.archive.push(e); }
        var dup = e.txns.some(function (x) { return minuteKey(x.ts, x.amt, x.dir) === key; });
        if (!dup) { e.txns.push({ id: 'i' + r.ts.toString(36) + Math.round(r.amt * 100).toString(36), ts: r.ts, amt: r.amt, dir: r.dir, who: r.who, b: b, acct: r.acct || '', note: r.note || '' }); res.past++; res.months[mk] = 1; }
        var k2 = P.merchantKey(r.who); if (k2 && b !== '?' && b !== 'moved' && !state.rules[k2]) state.rules[k2] = b;
      }
    });
    Object.keys(res.months).forEach(function (mk) { var e = archEntry(mk), snap = {}; e.txns.sort(function (a, b) { return b.ts - a.ts; }); e.txns.forEach(function (t) { snap[t.b] = bk(t.b); }); e.cats = snap; e.w = wrapOf(e.txns, mk, e.budget, e.days); });
    state.archive.sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    state.txns.sort(function (a, b) { return b.ts - a.ts; });
    return res;
  }
  function importFile(text) {
    var s = String(text || '').trim();
    if (s.charAt(0) === '{') return window.onNative('backupFile', s);
    var list = csvRows(s);
    if (!list || !list.length) { toast('That file is not a Slate export or backup'); return; }
    ui.importList = list;
    var cur = list.filter(function (r) { return mkey(new Date(r.ts)) === state.month; }).length, past = list.filter(function (r) { return mkey(new Date(r.ts)) < state.month; }).length;
    sheet('<div class="hd"><b>Import this export?</b><button class="x" data-act="close">✕</button></div><div class="card"><b>' + list.length + ' entries found</b><div class="mute small" style="margin-top:4px">' +
      (cur ? cur + ' from ' + mname(state.month) : '') + (cur && past ? ' · ' : '') + (past ? past + ' from earlier months, which go into the Archive' : '') + '</div></div>' +
      '<p class="mute small" style="margin:0 2px 12px">Slate matches each entry to the spend it already read from your bank SMS and copies over your category and note, so you do not sort anything twice. Entries it cannot find, like cash you typed in, are added. Importing the same file twice does not create duplicates.</p>' +
      '<button class="btn pri" data-act="importGo">Import</button><button class="btn" data-act="close">Cancel</button>', 'import');
  }

  // ---------- goals & wishlist: jars that fill as you save ----------
  var GEMO = '🎯 🏍️ 🚗 📱 💻 🎧 ⌚ 📷 🎮 ✈️ 🏖️ 🕋 🕌 🏠 🛋️ 💍 👗 👟 🎓 📚 👶 🎁 🎉 🩺 🛟 💰 🌱 🐶 🚲 🏋️'.split(' ');
  function goals() { if (!Array.isArray(state.goals)) state.goals = []; return state.goals; }
  function gPct(g) { return g.target > 0 ? Math.min(g.saved / g.target, 1) : 0; }
  function gLeft(g) { return Math.max(g.target - g.saved, 0); }
  function gRate(g) {          // average saved per day since the first deposit
    var tot = 0, first = 0, n = 0; (g.log || []).forEach(function (l) { if (l.start) return; tot += l.amt; if (l.amt > 0) { n++; if (!first || l.ts < first) first = l.ts; } });
    if (!first || tot <= 0 || n < 2 || Date.now() - first < 14 * 864e5) return 0;   // need a couple of weeks of saving before guessing a pace
    return tot / ((Date.now() - first) / 864e5);
  }
  function dur(days) { days = Math.ceil(days); return days <= 1 ? 'a day' : days < 45 ? days + ' days' : days < 700 ? Math.round(days / 30.4) + ' months' : (days / 365).toFixed(1) + ' years'; }
  function gPlan(g) {
    var left = gLeft(g); if (!left) return 'Reached 🎉';
    if (g.due) {
      var a = g.due.split('-'), end = new Date(+a[0], +a[1], 0, 23, 59), days = (end - Date.now()) / 864e5;
      if (days <= 0) return inr(left) + ' to go · date passed';
      return (days > 62 ? inr(Math.ceil(left / (days / 30.4))) + ' a month' : inr(Math.ceil(left / days)) + ' a day') + ' to make it by ' + mlong(g.due);
    }
    var r = gRate(g); return r ? 'At your pace, about ' + dur(left / r) + ' to go' : inr(left) + ' to go';
  }
  function goalMonth() {      // leftovers stashed from this month's spending come off the month, like fixed payments
    var m = 0, d = 0, t0 = sod(Date.now()), ms = new Date(); ms = new Date(ms.getFullYear(), ms.getMonth(), 1).getTime();
    goals().forEach(function (g) { (g.log || []).forEach(function (l) { if (l.src === 'stash' && l.ts >= ms) { m += l.amt; if (l.ts >= t0) d += l.amt; } }); });
    return { month: Math.max(m, 0), today: Math.max(d, 0) };
  }
  function goalsSaved() { var s = 0; goals().forEach(function (g) { s += g.saved; }); return s; }
  var jarN = 0;
  var JAR = 'M24 36 Q24 28 32 28 H78 Q86 28 86 36 V126 Q86 144 68 144 H42 Q24 144 24 126 Z';
  function jarSvg(g, cls) {
    var id = 'jr' + (++jarN), p = gPct(g), y = 30 + (1 - p) * 112, start = ui.anim && !calm() ? 150 : y;
    return '<svg class="jar ' + (cls || '') + '" viewBox="0 0 110 150" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + JAR + '"/></clipPath></defs>' +
      '<path class="jglass" d="' + JAR + '"/><rect x="30" y="14" width="50" height="14" rx="5" style="fill:' + g.color + '"/><rect x="36" y="9" width="38" height="7" rx="3" style="fill:' + g.color + ';opacity:.6"/>' +
      '<g clip-path="url(#' + id + ')"><g class="lvl" data-y="' + y.toFixed(1) + '" style="transform:translateY(' + start.toFixed(1) + 'px)">' +
      '<path class="w2" style="fill:' + g.color + '" d="' + wavePath(1) + '"/><path class="w1" style="fill:' + g.color + '" d="' + wavePath(0) + '"/>' +
      (p > .05 ? '<circle class="bb b1" cx="40" cy="70" r="2.6"/><circle class="bb b2" cx="66" cy="84" r="2"/><circle class="bb b3" cx="56" cy="62" r="2.4"/>' : '') + '</g></g>' +
      '<path class="shine" d="M34 46 Q31 84 34 120"/><text class="jemo" x="55" y="96" text-anchor="middle">' + (p >= 1 ? '✓' : g.emoji) + '</text></svg>';
  }
  function goalCard(g) {
    return '<button class="gcard' + (gPct(g) >= 1 ? ' done' : '') + '" data-act="goalOpen" data-v="' + g.id + '" style="--gc:' + g.color + '">' + jarSvg(g) +
      '<b class="ell">' + esc(g.name) + '</b><span class="num">' + inr(g.saved) + ' <i>of ' + kfmt(g.target) + '</i></span><span class="gbar"><i style="width:' + (gPct(g) * 100).toFixed(1) + '%"></i></span><span class="gplan">' + gPlan(g) + '</span></button>';
  }
  function stashOffer(c) {      // after 6 pm, offer today's unspent share to a goal
    var open = goals().filter(function (g) { return gPct(g) < 1; });
    if (!open.length || !(state.budget > 0) || !(c.leftToday >= 50) || new Date().getHours() < 18 || state.stashDay === iso(Date.now())) return '';
    var g = open[0], amt = Math.floor(c.leftToday / 10) * 10;
    return '<div class="stash" style="--gc:' + g.color + '"><span class="se">' + g.emoji + '</span><span class="grow"><b>' + inr(amt) + ' of today is still unspent</b><span class="mute small">Stash it in ' + esc(g.name) + ' and it is ' + Math.min(Math.round(amt / Math.max(g.target, 1) * 1000) / 10, 100) + '% closer</span></span><button class="chip" data-act="stash" data-v="' + g.id + '|' + amt + '">Stash</button><button class="x" data-act="stashNo" aria-label="Not today">✕</button></div>';
  }
  function goalsStrip(c) {
    var gs = goals();
    if (!gs.length) return '<button class="card gstrip empty" data-act="goGoals"><span class="gi2">' + jarSvg({ emoji: '🎯', color: '#94a3b8', saved: 6, target: 10 }, 'mini ghost') + '</span><span class="grow"><b>Saving for something?</b><span class="mute small">A bike, a trip, Umrah, a new phone. Add a goal and watch its jar fill every time you put money aside.</span><span class="chip">Start a goal ›</span></span></button>';
    var open = gs.filter(function (g) { return gPct(g) < 1; }).concat(gs.filter(function (g) { return gPct(g) >= 1; }));
    return stashOffer(c) + '<div class="card gstrip"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Goals & wishlist</h2><button class="lnk" data-act="goGoals">All ›</button></div><div class="gscroll">' +
      open.slice(0, 6).map(function (g) { return '<button class="gmini" data-act="goalOpen" data-v="' + g.id + '">' + jarSvg(g, 'mini') + '<span class="ell">' + esc(g.name) + '</span><b class="num">' + Math.round(gPct(g) * 100) + '%</b></button>'; }).join('') +
      '<button class="gmini add" data-act="goalNew"><span class="plus">＋</span><span>New goal</span></button></div></div>';
  }
  function goalsLayer() {
    var gs = goals(), saved = goalsSaved(), tgt = 0; gs.forEach(function (g) { tgt += g.target; });
    var open = gs.filter(function (g) { return gPct(g) < 1; }), done = gs.filter(function (g) { return gPct(g) >= 1; });
    var h = '<div class="row"><b class="grow" style="font-size:18px">Goals & wishlist</b><button class="x" data-act="closeFull">✕</button></div>';
    h += '<div class="ghero"><span class="mute2">Saved towards your dreams</span><b class="num" data-count="' + saved + '">' + inr(saved) + '</b><span class="mute2">' + (gs.length ? 'across ' + gs.length + ' goal' + (gs.length === 1 ? '' : 's') + (tgt ? ' · ' + Math.round(saved / tgt * 100) + '% of everything you want' : '') : 'Every jar starts with one coin') + '</span>' +
      '<div class="coinrain" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div>';
    h += '<button class="btn pri" data-act="goalNew">＋ New goal or wish</button>';
    if (open.length) h += '<div class="ggrid">' + open.map(goalCard).join('') + '</div>';
    if (done.length) h += '<div class="day" style="margin-top:16px"><span>Reached 🎉</span></div><div class="ggrid">' + done.map(goalCard).join('') + '</div>';
    if (!gs.length) h += '<div class="card" style="margin-top:12px"><div class="empty" style="padding:10px 4px">Name the thing you want, set its price, and add a little whenever you can. Slate shows how close you are and what it takes to get there.</div></div>';
    h += '<p class="mute small" style="margin:14px 4px 0">Money you put in a goal stays in your bank. Slate keeps it out of your "truly free" money so you are not tempted to spend it. Leftovers you stash from a day also come off this month\'s limit.</p>';
    full(h, 'goals');
    animIn(document.getElementById('full'));
  }
  function goalSheet(g) {
    ui.goal = g; var left = gLeft(g), r = gRate(g), wish = g.kind === 'wish';
    var h = '<div class="hd"><b class="ell">' + g.emoji + ' ' + esc(g.name) + '</b><button class="x" data-act="close">✕</button></div>';
    h += '<div class="gdet" style="--gc:' + g.color + '"><div class="jarwrap" id="jarwrap">' + jarSvg(g, 'big') + '</div><div class="grow"><span class="mute small" style="font-weight:700">' + (wish ? 'SAVED FOR IT' : 'SAVED') + '</span>' +
      '<b class="num gbig" id="gSaved">' + inr(g.saved) + '</b><span class="mute small">of ' + inr(g.target) + '</span><span class="gbar big"><i id="gBar" style="width:' + (gPct(g) * 100).toFixed(1) + '%"></i></span>' +
      '<b class="num gpct" id="gPct">' + Math.round(gPct(g) * 100) + '%</b><span class="gplan" id="gPlan">' + gPlan(g) + '</span></div></div>';
    if (left > 0) {
      h += '<label class="f">Put money in</label><div class="qadd">' + [100, 500, 1000, 5000].filter(function (v) { return v <= Math.max(left, 100) * 1.01 || v === 100; }).map(function (v) { return '<button data-act="gAdd" data-v="' + v + '">+' + kfmt(v) + '</button>'; }).join('') + '</div>' +
        '<div class="row" style="gap:8px;margin-top:8px"><input type="number" id="gAmt" inputmode="numeric" placeholder="Any amount" style="flex:1"><button class="btn pri" style="width:auto;margin:0;padding:0 20px" data-act="gAddAmt">Add</button></div>';
      var coffee = 160, perDay = coffee * 5 / 7, now = r ? left / r : 0, soon = left / (r + perDay);
      h += '<div class="insp"><span>☕</span><span>' + (r ? 'Skip a ₹160 coffee five days a week and you get here <b>' + dur(now - soon) + ' sooner</b>.' : 'Skipping a ₹160 coffee five days a week gets you here in about <b>' + dur(left / perDay) + '</b>.') + '</span></div>';
      if (wish) { var free = trulyFree(); h += '<div class="insp"><span>🛍️</span><span>' + (free >= left ? 'You could cover the rest (' + inr(left) + ') from free money today, leaving ' + inr(free - left) + ' truly free.' : 'Not yet. You would need ' + inr(left - Math.max(free, 0)) + ' more than you have free right now.') + '</span></div>'; }
    } else h += '<div class="insp done"><span>🏆</span><span>You did it. ' + (wish ? 'Enjoy it, you saved for it properly.' : 'Goal reached.') + '</span></div>';
    var log = (g.log || []).slice(-5).reverse();
    if (log.length) h += '<label class="f">Recent</label><div class="card" style="padding:2px 14px">' + log.map(function (l) { var d = new Date(l.ts); return '<div class="kv"><span>' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + '</span><b class="num" style="color:' + (l.amt < 0 ? 'var(--red)' : 'var(--accent)') + '">' + (l.amt < 0 ? '−' : '+') + inr(Math.abs(l.amt)) + '</b></div>'; }).join('') + '</div>';
    h += '<div style="margin-top:12px">' + (g.saved > 0 ? '<button class="btn" data-act="gTake">Take money out</button>' : '') + '<button class="btn" data-act="goalEdit">Edit goal</button></div>';
    sheet(h, 'goal');
    setTimeout(function () { var lv = document.querySelector('#jarwrap .lvl'); if (lv) lv.style.transform = 'translateY(' + lv.getAttribute('data-y') + 'px)'; }, 60);
  }
  function goalEditSheet(g, isNew) {
    ui.gEdit = { g: g, isNew: isNew, emoji: g.emoji, color: g.color, kind: g.kind || 'goal' };
    var h = '<div class="hd"><b>' + (isNew ? 'New goal or wish' : 'Edit goal') + '</b><button class="x" data-act="close">✕</button></div>' +
      '<div class="seg2" id="gKind">' + [['goal', '🎯 Savings goal'], ['wish', '🛍️ Wishlist item']].map(function (k) { return '<button data-act="gKind" data-v="' + k[0] + '" class="' + (ui.gEdit.kind === k[0] ? 'on' : '') + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      '<div class="catprev"><span id="gPrev" style="background:' + g.color + '">' + g.emoji + '</span></div>' +
      '<label class="f">What is it?</label><input type="text" id="gName" maxlength="30" value="' + esc(g.name) + '" placeholder="e.g. Royal Enfield, Umrah, new phone">' +
      '<label class="f">How much does it cost?</label><input type="number" id="gTarget" inputmode="numeric" value="' + (g.target || '') + '" placeholder="₹">' +
      (isNew ? '<label class="f">Already saved (optional)</label><input type="number" id="gStart" inputmode="numeric" placeholder="₹0">' : '') +
      '<label class="f">By when? (optional)</label><input type="month" id="gDue" value="' + (g.due || '') + '">' +
      '<label class="f">Icon</label><div class="emo" id="gEmo">' + GEMO.map(function (e) { return '<button data-act="gEmo" data-v="' + e + '"' + (e === g.emoji ? ' class="on"' : '') + '>' + e + '</button>'; }).join('') + '</div>' +
      '<label class="f">Colour</label><div class="swatch" id="gCol">' + SW.map(function (x) { return '<button data-act="gCol" data-v="' + x + '" style="background:' + x + '"' + (x === g.color ? ' class="on"' : '') + ' aria-label="Colour"></button>'; }).join('') + '</div>' +
      '<div style="margin-top:16px"><button class="btn pri" data-act="goalSave">' + (isNew ? 'Start saving' : 'Save') + '</button>' + (isNew ? '' : '<button class="btn danger" data-act="goalDel">Delete this goal</button>') + '</div>';
    sheet(h, 'goalEdit');
  }
  function trulyFree() { var bt = balTotals(); if (!bt.set) return 0; return bt.have - bt.owe - fxState().reserve - iouTotals().owe - goalsSaved(); }
  function goalDeposit(g, amt, src) {
    var before = gPct(g); amt = Math.round(amt);
    if (amt < 0) amt = -Math.min(-amt, g.saved);
    if (!amt) return;
    g.saved = Math.max(g.saved + amt, 0); var le = { ts: Date.now(), amt: amt }; if (src) le.src = src; (g.log = g.log || []).push(le); save();
    var after = gPct(g), wrap = document.getElementById('jarwrap');
    if (wrap && amt > 0 && !calm()) { var coin = document.createElement('i'); coin.className = 'coin'; coin.textContent = '₹'; wrap.appendChild(coin); setTimeout(function () { coin.remove(); }, 900); }
    setTimeout(function () {
      var lv = wrap && wrap.querySelector('.lvl'); if (lv) lv.style.transform = 'translateY(' + (30 + (1 - after) * 112).toFixed(1) + 'px)';
      var sv = document.getElementById('gSaved'); if (sv) tween(sv, g.saved);
      var bar = document.getElementById('gBar'); if (bar) bar.style.width = (after * 100).toFixed(1) + '%';
      var pc = document.getElementById('gPct'); if (pc) pc.textContent = Math.round(after * 100) + '%';
      var pl = document.getElementById('gPlan'); if (pl) pl.textContent = gPlan(g);
    }, amt > 0 && !calm() ? 420 : 0);
    var hit = [.25, .5, .75, 1].filter(function (m) { return before < m && after >= m; }).pop();
    if (hit) setTimeout(function () { confetti(hit === 1 ? 160 : 70); toast(hit === 1 ? g.emoji + ' ' + g.name + ' reached! 🎉' : Math.round(hit * 100) + '% of the way to ' + g.name + ' ✨'); if (hit === 1) goalSheet(g); }, 900);
    else { hap(amt > 0 ? 1 : 0); toast(amt > 0 ? '+' + inr(amt) + ' to ' + g.name : inr(-amt) + ' taken out'); }
  }

  // ---------- layers ----------
  function sheet(html, kind) { ui.sheet = kind; var s = document.getElementById('sheet'); s.innerHTML = html; s.scrollTop = 0; document.body.classList.add('sheet'); }
  function closeSheet() { ui.sheet = null; document.body.classList.remove('sheet'); }
  function full(html, kind) { ui.layer = kind; var f = document.getElementById('full'); f.innerHTML = html; f.scrollTop = 0; document.body.classList.add('full'); }
  function closeFull() { ui.layer = null; ui.catSnap = null; ui.arch = null; document.body.classList.remove('full'); }
  function find(id) { for (var i = 0; i < state.txns.length; i++) if (state.txns[i].id === id) return state.txns[i]; return null; }
  function picks(cur, act) {
    return '<div class="grid">' + ORDER.concat(['moved']).map(function (k) { var c = catColor(k); return '<button class="pick' + (cur === k ? ' on' : '') + '" style="--cc:' + c + '" data-act="' + act + '" data-v="' + esc(k) + '"><span>' + bk(k)[0] + '</span>' + esc(bk(k)[1]) + '</button>'; }).join('') +
      '<button class="pick new" data-act="newCat"><span>＋</span>New</button></div>';
  }
  function learn(t) { var k = P.merchantKey(t.who), n = 0; if (!k || t.b === '?') return 0; state.rules[k] = t.b; state.txns.forEach(function (x) { if (x !== t && !x.edited && x.dir === t.dir && P.merchantKey(x.who) === k && x.b !== t.b) { x.b = t.b; n++; } }); return n; }

  function editSheet(t, isNew) {
    ui.draft = { t: t, isNew: isNew, b: t.b === '?' ? '' : t.b, acct: t.acct || 'Cash' };
    var h = '<div class="hd"><b>' + (isNew ? 'Add a spend' : t.dir === 'in' ? 'Money in' : 'Spend') + '</b><button class="x" data-act="close">✕</button></div>' +
      '<input class="amtin num" type="number" id="eAmt" inputmode="decimal" placeholder="₹0" value="' + (t.amt || '') + '">' +
      '<label class="f">' + (t.dir === 'in' ? 'From' : 'Paid to') + '</label><input type="text" id="eWho" value="' + esc(t.who) + '" placeholder="e.g. Tea shop">' +
      '<label class="f">What was it?</label><div id="ePick">' + picks(ui.draft.b, 'eB') + '</div>' +
      (/^m/.test(t.id) ? '<label class="f">' + (t.dir === 'in' ? 'Into' : 'Paid from') + '</label><div class="quick" id="eAcct" style="margin-top:0">' + acctChips(t.acct || 'Cash') + '</div>' : '') +
      '<label class="f">Note</label><input type="text" id="eNote" value="' + esc(t.note || '') + '" placeholder="Optional">' +
      (t.raw ? '<label class="f">From your bank</label><div class="sms">' + esc(t.raw) + '</div>' : '') +
      '<div style="margin-top:18px"><button class="btn pri" data-act="saveTx">Save</button>' + (!isNew && t.dir === 'out' ? '<button class="btn" data-act="txFixed">📌 This is a monthly fixed payment</button><button class="btn" data-act="txLent">🤝 I lent this money</button>' : '') + (!isNew && t.dir === 'in' ? '<button class="btn" data-act="txBorrowed">🤝 I borrowed this money</button>' : '') + (isNew ? '' : '<button class="btn danger" data-act="delTx">Remove</button>') + '</div>';
    sheet(h, 'edit');
  }
  function sortNext() {
    var all = toSort(), list = all.filter(function (t) { return !ui.skipped[t.id]; });
    if (!list.length) { closeFull(); renderA(); toast(all.length ? all.length + ' left for later' : 'All sorted 🎉'); if (!all.length && ui.sortTotal > 1) confetti(110); return; }
    var t = list[0], done = ui.sortTotal - list.length, d = new Date(t.ts);
    ui.sorting = t.id;
    full('<div class="row"><b class="grow" style="font-size:18px">Sort your spends</b><button class="x" data-act="closeFull">✕</button></div><div class="dots" style="margin-top:14px"><i style="width:' + (done / ui.sortTotal * 100).toFixed(0) + '%"></i></div>' +
      '<div class="sortcard"><div class="mute small">' + DOW[d.getDay()] + ' ' + d.getDate() + ' · ' + time(t.ts) + (t.acct ? ' · ' + esc(t.acct) : '') + '</div><div class="a num">' + inr(t.amt) + '</div><div class="w">' + esc(t.who || 'Unknown') + '</div></div>' +
      picks('', 'sortB') + '<button class="btn" style="margin-top:14px" data-act="sortSkip">Skip for now</button><div class="mute small" style="text-align:center;margin-top:10px">' + (done + 1) + ' of ' + ui.sortTotal + '</div>', 'sort');
  }
  function wrapHtml(w, live) {
    var saved = w.budget > 0 ? w.budget - w.spent : null;
    var line = saved == null ? w.n + ' spends across ' + w.days + ' days' : saved >= 0 ? 'You stayed ' + inr(saved) + ' under your limit' : inr(-saved) + ' over your limit';
    function cell(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
    return '<div class="wrap" id="wrapCard"><div class="m">' + mname(w.month) + (live ? ' so far' : ', wrapped') + '</div><div class="t num">' + inr(w.spent) + '</div><div class="line">' + line + '</div><div class="g">' +
      (w.top ? cell('Most went on', bk(w.top)[0] + ' ' + bk(w.top)[1]) : '') + (w.big ? cell('Biggest spend', esc(w.big.who) + ' ' + inr(w.big.amt)) : '') +
      (w.fav ? cell('Regular haunt', esc(w.fav.who) + ' ×' + w.fav.n) : cell('Spends', w.n)) + cell('Per day', inr(w.avg)) + cell('No-spend days', w.zero) + (w.budget > 0 ? cell('Best streak', w.best + ' day' + (w.best === 1 ? '' : 's')) : cell('Money in', inr(w.moneyIn))) +
      '</div><div class="f">Slate · tracked privately on my phone</div></div>';
  }
  function showWrap(w, live) {
    ui.wrapData = w;
    full('<div class="row"><b class="grow" style="font-size:18px">' + (live ? 'Your month so far' : 'A clean slate') + '</b><button class="x" data-act="closeFull">✕</button></div>' + wrapHtml(w, live) +
      (live ? '' : '<p class="mute" style="margin:0 2px 16px">' + mname(w.month) + ' is safely in your <b>Archive</b>, every spend intact, and today starts on a clean slate.' + (w.saved ? ' A spreadsheet copy is also in Downloads as Slate-' + w.month + '.csv.' : '') + '</p><button class="btn dark" data-act="goArch">Open the Archive</button>') +
      '<button class="btn pri" data-act="wrapImg">Share as a picture</button><button class="btn" data-act="wrapTxt">Share as text</button>', 'wrap');
  }
  function wrapText(w) {
    var L = ['My ' + mname(w.month) + ' with Slate', 'Spent: ' + inr(w.spent) + (w.budget > 0 ? ' of ' + inr(w.budget) : '')];
    w.cats.slice(0, 5).forEach(function (c) { L.push(bk(c[0])[0] + ' ' + bk(c[0])[1] + ': ' + inr(c[1])); });
    L.push('No-spend days: ' + w.zero); return L.join('\n');
  }
  function wrapImage(w) {
    var c = document.createElement('canvas'); c.width = 1080; c.height = 1350; var g = c.getContext('2d');
    var cs = getComputedStyle(document.body), c1 = cs.getPropertyValue('--g1').trim() || '#0d9668', c2 = cs.getPropertyValue('--g2').trim() || '#064d47';
    var gr = g.createLinearGradient(0, 0, 1080, 1350); gr.addColorStop(0, c1); gr.addColorStop(0.7, c2); gr.addColorStop(1, '#0b2b33'); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.arc(120, 1300, 380, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    g.globalAlpha = .8; g.font = '700 38px system-ui, sans-serif'; g.fillText(mname(w.month).toUpperCase() + (w.live ? '  SO FAR' : ',  WRAPPED'), 90, 110);
    g.globalAlpha = 1; g.font = '800 150px system-ui, sans-serif'; g.fillText(inr(w.spent), 84, 180);
    var saved = w.budget > 0 ? w.budget - w.spent : null;
    g.font = '500 46px system-ui, sans-serif'; g.globalAlpha = .92; g.fillText(saved == null ? w.n + ' spends across ' + w.days + ' days' : saved >= 0 ? 'Stayed ' + inr(saved) + ' under my limit' : inr(-saved) + ' over my limit', 90, 370);
    var cells = []; if (w.top) cells.push(['Most went on', bk(w.top)[1]]); if (w.big) cells.push(['Biggest spend', inr(w.big.amt)]); cells.push(['Per day', inr(w.avg)]); cells.push(['No-spend days', String(w.zero)]);
    if (w.budget > 0) cells.push(['Best streak', w.best + ' days']); cells.push(['Spends', String(w.n)]);
    cells.slice(0, 6).forEach(function (cl, i) {
      var x = 90 + (i % 2) * 465, y = 520 + Math.floor(i / 2) * 215;
      g.globalAlpha = .12; g.fillStyle = '#fff'; rr(g, x, y, 435, 185, 36); g.fill();
      g.globalAlpha = .8; g.font = '600 32px system-ui, sans-serif'; g.fillText(cl[0], x + 34, y + 36);
      g.globalAlpha = 1; g.font = '800 54px system-ui, sans-serif'; g.fillText(cl[1], x + 34, y + 88, 370);
    });
    g.globalAlpha = .7; g.font = '500 32px system-ui, sans-serif'; g.fillText('Slate · tracked privately on my phone', 90, 1230);
    return c.toDataURL('image/png').split(',')[1];
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function acctChips(cur) {
    var keys = ['Cash'].concat(Object.keys(state.accts).filter(function (k) { return k !== 'Cash'; }));
    return keys.map(function (k) { return '<button data-act="eAcct" data-v="' + esc(k) + '"' + (k === cur ? ' class="on"' : '') + '>' + esc(k) + '</button>'; }).join('');
  }
  function balsLayer() { if (ui.layer) closeFull(); if (ui.tab !== 'bals') ACT.tab('bals'); else keep(); }
  function viewBals() {
    ensureAccts();
    var bt = balTotals(), keys = Object.keys(state.accts), h = head('Kept up to date with every spend and credit', 'Balances', '');
    h += walletHero() + moneyFlow() + acctShare();
    function group(title, type, icon) {
      var ks = keys.filter(function (k) { return state.accts[k].type === type; }); if (!ks.length) return '';
      return '<h2 style="margin-top:6px">' + title + '</h2><div class="card" style="padding:4px 16px">' + ks.map(function (k) {
        var b = balOf(k), d = b ? new Date(b.ts) : null;
        return '<div class="tx" data-act="balOpen" data-v="' + esc(k) + '"><div class="em">' + icon + '</div><div class="grow"><div class="who ell">' + esc(k) + '</div><div class="meta ell">' + (b ? 'Entered ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + ' · ' + (b.n ? b.n + ' change' + (b.n === 1 ? '' : 's') + ' since' : 'no changes since') : 'Tap to enter ' + (type === 'card' ? 'what you owe' : 'the balance')) + '</div></div>' +
          (b ? '<div class="amt num">' + inr(b.v) + '</div>' : '<div class="amt" style="color:var(--accent)">Set</div>') + '</div>';
      }).join('') + '</div>';
    }
    h += group('Bank accounts', 'bank', '🏦') + group('Credit cards · what you owe', 'card', '💳') + group('Cash', 'cash', '💵');
    h += '<button class="btn" data-act="acctAdd">Add another account or card</button>';
    h += '<p class="mute small" style="margin:12px 4px 0">Type each balance once. From that moment Slate adds every credit and subtracts every spend it sees. Cash you withdraw from a bank is added to Cash. If a figure ever looks off, tap it and type the right one.</p>';
    return h;
  }
  function balSheet(name) {
    var a = state.accts[name], b = balOf(name), card = a.type === 'card', hint = card ? null : lastBankFigure(name);
    ui.bal = name; ui.balHint = hint ? { v: Math.round(hint.bal), ts: hint.ts } : null;
    var h = '<div class="hd"><b>' + esc(name) + '</b><button class="x" data-act="close">✕</button></div><label class="f" style="margin-top:6px">' + (card ? 'What you owe on this card right now' : a.type === 'cash' ? 'Cash you have right now' : 'Balance right now') + '</label>' +
      '<input class="amtin num" type="number" id="balVal" inputmode="decimal" placeholder="₹" value="' + (b ? Math.round(b.v) : '') + '">';
    if (hint) { var d = new Date(hint.ts); h += '<div class="quick"><button data-act="balHint" data-v="' + hint.bal + '">Bank SMS on ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + ' said ' + inr(hint.bal) + ' · use it</button></div>'; }
    h += '<p class="mute small" style="margin:12px 2px 0">' + (b ? 'Saving replaces the current figure. Slate counts from this moment again.' : 'Slate counts from this moment on.') + '</p>' +
      '<div style="margin-top:14px"><button class="btn pri" data-act="balSave">Save</button>' + (b ? '<button class="btn" data-act="balStop">Stop tracking this one</button>' : '') + (a.type !== 'cash' && Object.keys(state.accts).filter(function (k) { return k !== name && state.accts[k].type === a.type; }).length ? '<button class="btn" data-act="mergeAsk">This is the same as another ' + (card ? 'card' : 'account') + '…</button>' : '') + '</div>';
    sheet(h, 'bal');
    setTimeout(function () { var e = document.getElementById('balVal'); if (e && !b) e.focus(); }, 250);
  }
  function fixedLayer() {
    var fx = fxState(), h = '<div class="row"><b class="grow" style="font-size:18px">Fixed payments</b><button class="x" data-act="closeFull">✕</button></div>';
    h += '<div class="card" style="margin-top:14px"><div class="row"><span class="grow mute small" style="font-weight:700">' + mname(state.month).toUpperCase() + '</span><span class="mute small">' + fx.nPaid + ' of ' + state.fixed.length + ' paid</span></div><div class="num" style="font-size:30px;font-weight:800">' + inr(fx.reserve) + ' <span class="mute" style="font-size:15px;font-weight:600">still to go</span></div>' +
      '<div class="prog"><i style="width:' + (fx.total ? fx.paid / fx.total * 100 : 0).toFixed(1) + '%"></i></div><div class="small mute">Unpaid ones are set aside first, so "safe to spend today" never eats into your EMIs or rent.</div></div>';
    if (state.fixed.length) h += '<div class="card" style="padding:4px 16px">' + state.fixed.slice().sort(function (a, b) { return (a.day || 99) - (b.day || 99); }).map(function (f) {
      var st = fxStatus(f); return '<div class="tx" data-act="fxOpen" data-v="' + esc(f.id) + '"><div class="em">' + (st[1] === 'ok' ? '✅' : st[1] === 'bad' ? '⏰' : '📌') + '</div><div class="grow"><div class="who ell">' + esc(f.name) + '</div><div class="meta" style="' + (st[1] === 'bad' ? 'color:var(--red)' : '') + '">' + st[0] + '</div></div><div class="amt num">' + inr(f.amt) + '</div></div>';
    }).join('') + '</div>';
    else h += '<div class="empty">EMIs, rent, school fees, SIPs, subscriptions.<br>Add them once; Slate ticks them off each month.</div>';
    h += '<button class="btn pri" data-act="fxAdd">Add a fixed payment</button>';
    full(h, 'fixed');
  }
  function fxSheet(f, isNew) {
    ui.fx = { f: f, isNew: isNew };
    var paid = fxPaid(f), auto = paid && f.paid !== state.month;
    var h = '<div class="hd"><b>' + (isNew ? 'New fixed payment' : esc(f.name)) + '</b><button class="x" data-act="close">✕</button></div>' +
      '<label class="f">Name</label><input type="text" id="fName" value="' + esc(f.name) + '" placeholder="e.g. Home loan EMI">' +
      '<label class="f">Amount each month (₹)</label><input type="number" id="fAmt" inputmode="decimal" value="' + (f.amt || '') + '">' +
      '<label class="f">Usual day of the month</label><input type="number" id="fDay" inputmode="numeric" min="1" max="31" value="' + (f.day || '') + '" placeholder="e.g. 5">';
    if (!isNew) {
      h += '<div class="card" style="padding:4px 16px;margin-top:16px"><div class="kv"><span><b>Paid for ' + mname(state.month) + '</b><br><span class="mute small">' + (auto ? 'Spotted in your bank messages' : f.keys && f.keys.length ? 'Ticks itself when the payment shows up' : 'Tick it yourself, or link a payment below') + '</span></span><button class="sw' + (paid ? ' on' : '') + '" data-act="fxToggle"' + (auto ? ' disabled' : '') + ' aria-label="Paid"></button></div></div>';
      var cand = spends().filter(function (t) { return t.who && (!f.keys || f.keys.indexOf(P.merchantKey(t.who)) < 0); }).slice(0, 40);
      if (cand.length) h += '<label class="f">Link the payment so it ticks itself every month</label><div class="card" style="padding:4px 14px;max-height:220px;overflow-y:auto">' + cand.map(function (t) { var d = new Date(t.ts); return '<div class="tx" data-act="fxLink" data-v="' + esc(t.id) + '"><div class="grow"><div class="who ell">' + esc(t.who) + '</div><div class="meta">' + d.getDate() + ' ' + mname(state.month).slice(0, 3) + '</div></div><div class="amt num">' + inr(t.amt) + '</div></div>'; }).join('') + '</div>';
    }
    h += '<div style="margin-top:18px"><button class="btn pri" data-act="fxSave">Save</button>' + (isNew ? '' : '<button class="btn danger" data-act="fxDel">Delete</button>') + '</div>';
    sheet(h, 'fx');
  }
  function iouLayer() {
    var io = iouTotals(), open = state.iou.filter(function (x) { return !x.done; }), done = state.iou.filter(function (x) { return x.done; });
    var h = '<div class="row"><b class="grow" style="font-size:18px">Lent & borrowed</b><button class="x" data-act="closeFull">✕</button></div>' +
      '<div class="duo" style="margin-top:14px"><div class="tile"><span class="k">You are owed</span><b class="num" style="font-size:22px;color:var(--accent)">' + inr(io.owed) + '</b></div><div class="tile"><span class="k">You owe</span><b class="num" style="font-size:22px">' + inr(io.owe) + '</b></div></div>';
    function row(x) { var d = new Date(x.ts), age = Math.floor((Date.now() - x.ts) / DAY); return '<div class="tx" data-act="iouOpen" data-v="' + esc(x.id) + '"><div class="em">' + (x.done ? '✅' : x.dir === 'lent' ? '↗️' : '↙️') + '</div><div class="grow"><div class="who ell">' + esc(x.who) + '</div><div class="meta ell">' + (x.dir === 'lent' ? 'You lent' : 'You borrowed') + ' · ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + (!x.done && age >= 30 ? ' · ' + age + ' days ago' : '') + (x.note ? ' · ' + esc(x.note) : '') + '</div></div><div class="amt num' + (x.dir === 'lent' && !x.done ? ' in' : '') + '">' + inr(x.amt) + '</div></div>'; }
    h += open.length ? '<div class="card" style="padding:4px 16px">' + open.map(row).join('') + '</div>' : '<div class="empty">Nothing open.<br>Lent a friend some money, or borrowed some? Note it here so it is never forgotten. This list is not cleared at month end.</div>';
    h += '<button class="btn pri" data-act="iouAdd">Add one</button>';
    if (done.length) h += '<h2 style="margin-top:20px">Settled</h2><div class="card" style="padding:4px 16px">' + done.slice(0, 15).map(row).join('') + '</div>';
    full(h, 'iou');
  }
  function iouSheet(x, isNew) {
    ui.io = { x: x, isNew: isNew, dir: x.dir };
    var h = '<div class="hd"><b>' + (isNew ? 'Add' : esc(x.who)) + '</b><button class="x" data-act="close">✕</button></div>' +
      '<div class="seg2" id="iDir"><button data-act="iDir" data-v="lent" class="' + (x.dir === 'lent' ? 'on' : '') + '">I lent</button><button data-act="iDir" data-v="borrowed" class="' + (x.dir === 'borrowed' ? 'on' : '') + '">I borrowed</button></div>' +
      '<input class="amtin num" style="margin-top:12px" type="number" id="iAmt" inputmode="decimal" placeholder="₹0" value="' + (x.amt || '') + '">' +
      '<label class="f">Who</label><input type="text" id="iWho" value="' + esc(x.who) + '" placeholder="Name">' +
      '<label class="f">Note</label><input type="text" id="iNote" value="' + esc(x.note || '') + '" placeholder="Optional, e.g. for the trip">' +
      '<div style="margin-top:18px"><button class="btn pri" data-act="iouSave">Save</button>' +
      (isNew ? '' : (x.done ? '<button class="btn" data-act="iouDone">Reopen</button>' : '<button class="btn dark" data-act="iouDone">' + (x.dir === 'lent' ? 'Got it back' : 'Paid it back') + ' ✓</button>' + (x.dir === 'lent' ? '<button class="btn" data-act="iouNudge">Send a friendly reminder</button>' : '')) + '<button class="btn danger" data-act="iouDel">Delete</button>') + '</div>';
    sheet(h, 'iou');
  }
  function budgetSheet(first) {
    sheet('<div class="hd"><b>Monthly limit</b>' + (first ? '' : '<button class="x" data-act="close">✕</button>') + '</div><p class="mute" style="margin:0 0 12px">What is the most you want to spend in a month? Slate turns it into one number for each day.</p>' +
      '<input class="amtin num" type="number" id="bVal" inputmode="numeric" placeholder="₹" value="' + (state.budget || '') + '"><div class="quick">' + [20000, 30000, 50000, 75000, 100000].map(function (v) { return '<button data-act="bQuick" data-v="' + v + '">' + inr(v) + '</button>'; }).join('') + '</div>' +
      '<div style="margin-top:18px"><button class="btn pri" data-act="bSave">Save</button>' + (first ? '<button class="btn" data-act="close">Skip for now</button>' : '') + '</div>', 'budget');
  }
  function settingsSheet() {
    var ready = false; try { ready = A.notifyReady(); } catch (e) { }
    sheet('<div class="hd"><b>Settings</b><button class="x" data-act="close">✕</button></div><div class="card" style="padding:4px 16px;margin-top:8px">' +
      '<div class="kv" data-act="looks"><span><b>Look</b><br><span class="mute small">' + LOOKS[look()][0] + ' · ' + LOOKS[look()][1] + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="dkTheme"><span><b>Colour & mode</b><br><span class="mute small">' + (THEMES[state.theme] || THEMES.emerald)[0] + ' · ' + ({ system: 'Auto', light: 'Light', dark: 'Dark' })[state.mode || 'system'] + ' · ' + (state.motion === 'calm' ? 'Calm' : 'Lively') + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="goCats"><span><b>Categories</b><br><span class="mute small">' + ORDER.length + ' in the picker · add your own</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="budget"><span><b>Monthly limit</b><br><span class="mute small">' + (state.budget ? inr(state.budget) : 'Not set') + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv"><span><b>Tell me after each spend</b><br><span class="mute small">' + (state.notify && !ready ? 'Needs notification and SMS permission. Tap the switch again.' : 'What is left for today, and one tap to sort a spend Slate does not recognise') + '</span></span><button class="sw' + (state.notify ? ' on' : '') + '" data-act="notify" aria-label="Spend notifications"></button></div></div>' +
      '<div class="card" style="padding:4px 16px"><div class="kv" data-act="export"><span><b>Export this month</b><br><span class="mute small">A spreadsheet file in your Downloads folder</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="rescan"><span><b>Read my messages again</b><br><span class="mute small">Your own changes are kept</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="goArch"><span><b>Archive</b><br><span class="mute small">' + (state.archive.length ? state.archive.length + ' past month' + (state.archive.length === 1 ? '' : 's') + ' kept' : 'Past months are kept here') + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv"><span><b>Also save a spreadsheet on the 1st</b><br><span class="mute small">A CSV copy of the month in Downloads, on top of the Archive</span></span><button class="sw' + (state.autoCsv !== false ? ' on' : '') + '" data-act="autoCsv" aria-label="Spreadsheet on the 1st"></button></div>' +
      '<div class="kv" data-act="backup"><span><b>Back up everything</b><br><span class="mute small">One file you can restore on any phone</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="importStart"><span><b>Import an export or backup</b><br><span class="mute small">A Slate spreadsheet (any version) or backup file. Your categories and notes come back</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="wipe"><span><b style="color:var(--red)">Start the month over</b><br><span class="mute small">Moves this month to the Archive, then clears the screen</span></span><span class="mute">›</span></div></div>' +
      '<p class="mute small" style="margin:4px 4px 0">On the 1st, Slate moves the month into the Archive and gives you a clean screen. Nothing is thrown away. It has no internet access, so nothing leaves this phone.</p>', 'settings');
  }

  // ---------- actions ----------
  var ACT = {
    tab: function (v) { ui.tab = v; ui.selBar = -1; renderA(); document.getElementById('view').scrollTop = 0; },
    start: function () { state.onboarded = true; save(); ui.perm = A.hasSmsPermission(); if (ui.perm) { scan(false); if (!state.budget) budgetSheet(true); } else render(); },
    askPerm: function () { A.requestSmsPermission(); },
    appSettings: function () { A.openAppSettings(); },
    settings: settingsSheet, close: function () { if (ui.sheet === 'cat') ACT.catClose(); else closeSheet(); }, closeFull: function () { closeFull(); renderA(); },
    budget: function () { budgetSheet(false); },
    bQuick: function (v) { document.getElementById('bVal').value = v; },
    bSave: function () { state.budget = Math.max(parseFloat(document.getElementById('bVal').value) || 0, 0); save(); closeSheet(); renderA(); toast(state.budget ? 'Limit set' : 'Limit removed'); },
    notify: function () { var ready = false; try { ready = A.notifyReady(); } catch (e) { } if (state.notify && ready) state.notify = false; else { state.notify = true; if (!ready) A.requestNotifyPermissions(); } save(); settingsSheet(); },
    add: function () { editSheet({ id: 'm' + Date.now(), ts: Date.now(), amt: 0, dir: 'out', who: '', b: '', acct: 'Cash', note: '', edited: true }, true); setTimeout(function () { var e = document.getElementById('eAmt'); if (e) e.focus(); }, 250); },
    edit: function (id) { var t = find(id); if (t) editSheet(t, false); },
    eB: function (k) { ui.draft.b = k; hap(0); document.getElementById('ePick').innerHTML = picks(k, 'eB'); },
    saveTx: function () {
      var d = ui.draft, t = d.t, amt = parseFloat(document.getElementById('eAmt').value);
      if (!(amt > 0)) { toast('Enter the amount'); return; }
      if (!d.b) { toast('Pick what it was'); return; }
      if (/^m/.test(t.id)) t.acct = d.acct;
      t.amt = amt; t.who = document.getElementById('eWho').value.trim(); t.note = document.getElementById('eNote').value.trim(); t.b = d.b; t.edited = true;
      if (d.isNew) state.txns.push(t);
      var n = learn(t); state.txns.sort(function (a, b) { return b.ts - a.ts; });
      save(); closeSheet(); renderA(); hap(1); toast(n ? 'Saved · ' + n + ' more sorted the same way' : 'Saved');
    },
    delTx: function () { var t = ui.draft.t; snapshot(); state.txns.splice(state.txns.indexOf(t), 1); if (/^s/.test(t.id)) state.deleted[t.id] = 1; save(); closeSheet(); renderA(); toast('Removed', true); },
    undo: function () { if (!ui.undo) return; var o = JSON.parse(ui.undo); state.txns = o.txns; state.rules = o.rules; state.deleted = o.deleted; ui.undo = null; save(); renderA(); toast('Back again'); },
    sort: function () { ui.sortTotal = toSort().length; ui.skipped = {}; sortNext(); },
    sortB: function (k) { var t = find(ui.sorting); if (!t || ui.flying) return; t.b = k; t.edited = true; learn(t); save(); hap(0);
      var sc = document.querySelector('.sortcard'); if (sc && !calm()) { ui.flying = true; sc.style.setProperty('--fc', catColor(k)); sc.classList.add('fly'); setTimeout(function () { ui.flying = false; sortNext(); }, 260); } else sortNext(); },
    sortSkip: function () { ui.skipped[ui.sorting] = 1; sortNext(); },
    looks: lookSheet,
    setLook: function (k) { state.look = k; save(); applyLook(); closeSheet(); renderA(); toast(LOOKS[k][0] + ' it is'); },
    setTheme: function (k) { state.theme = k; save(); applyLook(); themeSheet(); renderA(); hap(0); },
    setMode: function (k) { state.mode = k; save(); applyLook(); themeSheet(); renderA(); },
    setMotion: function (k) { state.motion = k; save(); applyLook(); themeSheet(); renderA(); if (k === 'lively') confetti(50); },
    dkTheme: function () { ui.dock = false; nav(); themeSheet(); },
    dock: function () { ui.dock = !ui.dock; hap(0); nav(); },
    dkSort: function () { ui.dock = false; nav(); if (toSort().length) ACT.sort(); else toast('Nothing to sort 🎉'); },
    dkCats: function () { ui.dock = false; nav(); catsLayer(); }, dkArch: function () { ui.dock = false; nav(); archiveLayer(); }, dkFixed: function () { ui.dock = false; nav(); fixedLayer(); },
    goCats: function () { closeSheet(); catsLayer(); },
    goGoals: function () { closeSheet(); goalsLayer(); }, dkGoals: function () { ui.dock = false; nav(); goalsLayer(); },
    goalOpen: function (id) { var g = goals().filter(function (x) { return x.id === id; })[0]; if (g) goalSheet(g); },
    goalNew: function () { goalEditSheet({ id: '', name: '', emoji: '🎯', color: SW[(goals().length * 3 + 10) % SW.length], target: 0, saved: 0, due: '', kind: 'goal', log: [] }, true); setTimeout(function () { var e = document.getElementById('gName'); if (e) e.focus(); }, 250); },
    goalEdit: function () { goalEditSheet(ui.goal, false); },
    gKind: function (k) { ui.gEdit.kind = k; var b = document.querySelectorAll('#gKind button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === k ? 'on' : ''; if (k === 'wish' && ui.gEdit.emoji === '🎯') ACT.gEmo('🛍️'); },
    gEmo: function (e) { ui.gEdit.emoji = e; document.getElementById('gPrev').textContent = e; var b = document.querySelectorAll('#gEmo button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === e ? 'on' : ''; hap(0); },
    gCol: function (x) { ui.gEdit.color = x; document.getElementById('gPrev').style.background = x; var b = document.querySelectorAll('#gCol button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === x ? 'on' : ''; hap(0); },
    goalSave: function () {
      var e = ui.gEdit, g = e.g, nm = clean(val('gName')).slice(0, 30), t = parseFloat(val('gTarget')), st = parseFloat(val('gStart')) || 0;
      if (!nm) { toast('Give it a name'); return; } if (!(t > 0)) { toast('How much does it cost?'); return; }
      g.name = nm; g.target = Math.round(t); g.emoji = e.emoji; g.color = e.color; g.kind = e.kind; g.due = /^\d{4}-\d{2}$/.test(val('gDue')) ? val('gDue') : '';
      if (e.isNew) { g.id = 'g' + Date.now().toString(36); g.created = Date.now(); g.saved = 0; g.log = []; if (st > 0) { g.saved = Math.round(st); g.log.push({ ts: Date.now(), amt: g.saved, start: 1 }); } goals().push(g); }
      save(); confetti(e.isNew ? 60 : 0); goalSheet(g); if (ui.layer === 'goals') goalsLayer(); else renderA();
    },
    goalDel: function () {
      if (!ui.gArm) { ui.gArm = true; toast('Tap Delete again to confirm'); setTimeout(function () { ui.gArm = false; }, 4000); return; }
      ui.gArm = false; state.goals.splice(state.goals.indexOf(ui.gEdit.g), 1); save(); closeSheet(); hap(2); toast('Goal deleted'); if (ui.layer === 'goals') goalsLayer(); else renderA();
    },
    gAdd: function (v) { goalDeposit(ui.goal, +v); if (ui.layer === 'goals') setTimeout(function () { var st = document.getElementById('full').scrollTop; goalsLayer(); document.getElementById('full').scrollTop = st; }, 1200); else setTimeout(renderA, 1200); },
    gAddAmt: function () { var v = parseFloat(val('gAmt')); if (!(v > 0)) { toast('Type an amount'); return; } document.getElementById('gAmt').value = ''; ACT.gAdd(v); },
    gTake: function () { var v = parseFloat(val('gAmt')); if (!(v > 0)) { toast('Type the amount to take out above'); var e = document.getElementById('gAmt'); if (e) e.focus(); else sheet('<div class="hd"><b>Take money out</b><button class="x" data-act="close">✕</button></div><input type="number" id="gAmt" inputmode="numeric" placeholder="Amount"><button class="btn danger" style="margin-top:12px" data-act="gTake">Take out</button>', 'goalTake'); return; } goalDeposit(ui.goal, -v); setTimeout(function () { goalSheet(ui.goal); if (ui.layer === 'goals') goalsLayer(); else renderA(); }, 500); },
    stash: function (v) { var a = v.split('|'), g = goals().filter(function (x) { return x.id === a[0]; })[0]; if (!g) return; state.stashDay = iso(Date.now()); goalSheet(g); setTimeout(function () { goalDeposit(g, +a[1], 'stash'); setTimeout(renderA, 1300); }, 350); },
    stashNo: function () { state.stashDay = iso(Date.now()); save(); renderA(); }, goArch: function () { closeSheet(); archiveLayer(); },
    viz: function (k) { if (ui.tab !== 'month') { ui.viz = k; ACT.tab('month'); return; } ui.viz = k; hap(0); keep(); var vb = document.querySelector('.vbody'); if (vb) animIn(vb); },
    fan: function () { ui.fan = !ui.fan; hap(0); var w = document.querySelector('.wallet'); if (w) { w.classList.toggle('fan', ui.fan); var fb = w.querySelector('.fanb'); if (fb) fb.textContent = ui.fan ? 'Tuck in' : 'Peek'; } },
    autoCsv: function () { state.autoCsv = state.autoCsv === false; save(); settingsSheet(); },
    catOpen: function (k) { var c = catOf(k); if (c) { ui.catRet = 'cats'; catSheet(c, false); } },
    catNew: function () { ui.catRet = 'cats'; catSheet({ k: '', e: '🏷️', n: '', c: SW[(state.cats.length * 5) % SW.length], custom: true }, true); },
    newCat: function () {
      if (ui.sheet === 'edit') { ui.draftVals = { amt: val('eAmt'), who: val('eWho'), note: val('eNote'), acct: ui.draft.acct }; ui.catRet = 'edit'; } else if (ui.layer === 'sort') ui.catRet = 'sort'; else ui.catRet = '';
      catSheet({ k: '', e: '🏷️', n: '', c: SW[(state.cats.length * 5) % SW.length], custom: true }, true);
      setTimeout(function () { var e = document.getElementById('cName'); if (e) e.focus(); }, 250);
    },
    cEmo: function (e) { ui.cat.e = e; document.getElementById('cPrev').textContent = e; document.getElementById('cEmoIn').value = ''; var b = document.querySelectorAll('#cEmo button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === e ? 'on' : ''; hap(0); },
    cCol: function (x) { ui.cat.col = x; document.getElementById('cPrev').style.background = x; var b = document.querySelectorAll('#cCol button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === x ? 'on' : ''; hap(0); },
    catClose: function () { closeSheet(); ACT.catBack(null); },
    catBack: function (nk) {
      var r = ui.catRet; ui.catRet = '';
      if (r === 'edit') { var dv = ui.draftVals || {}; editSheet(ui.draft.t, ui.draft.isNew); document.getElementById('eAmt').value = dv.amt || ''; document.getElementById('eWho').value = dv.who || ''; document.getElementById('eNote').value = dv.note || ''; if (dv.acct && document.getElementById('eAcct')) ACT.eAcct(dv.acct); if (nk) ACT.eB(nk); }
      else if (r === 'sort') { if (nk) ACT.sortB(nk); }
      else if (r === 'cats') catsLayer();
    },
    catSave: function () {
      var c = ui.cat.c, nm = clean(val('cName')).slice(0, 24), cap = parseFloat(val('cCap')), own = clean(val('cEmoIn')).slice(0, 8);
      if (!nm) { toast('Give it a name'); return; }
      if (state.cats.some(function (x) { return x !== c && x.n.toLowerCase() === nm.toLowerCase(); })) { toast('You already have one called that'); return; }
      c.n = nm; c.e = own || ui.cat.e || '🏷️'; c.c = ui.cat.col; c.cap = cap > 0 ? cap : 0;
      if (ui.cat.isNew) { c.k = 'u' + Date.now().toString(36); c.custom = true; state.cats.push(c); }
      buildCats(); save(); closeSheet(); toast(ui.cat.isNew ? c.e + ' ' + c.n + ' added' : 'Saved');
      if (ui.cat.isNew) confetti(40); else hap(1);
      ACT.catBack(ui.cat.isNew ? c.k : null);
    },
    catHide: function () { var c = ui.cat.c; if (!c.hide && ORDER.length <= 2) { toast('Keep at least two in the picker'); return; } c.hide = !c.hide; buildCats(); save(); closeSheet(); toast(c.hide ? 'Hidden. Past spends keep it' : 'Back in the picker'); ACT.catBack(null); },
    catDel: function () {
      if (!ui.catArm) { ui.catArm = true; toast('Tap Delete again to confirm'); setTimeout(function () { ui.catArm = false; }, 4000); return; }
      ui.catArm = false; var c = ui.cat.c; state.cats.splice(state.cats.indexOf(c), 1);
      state.txns.forEach(function (t) { if (t.b === c.k) t.b = 'other'; }); Object.keys(state.rules).forEach(function (r) { if (state.rules[r] === c.k) delete state.rules[r]; });
      buildCats(); save(); closeSheet(); hap(2); toast('Deleted'); ACT.catBack(null);
    },
    catUp: function (k) { var i = state.cats.indexOf(catOf(k)); if (i > 0) { var x = state.cats.splice(i, 1)[0]; state.cats.splice(i - 1, 0, x); buildCats(); save(); hap(0); var st = document.getElementById('full').scrollTop; catsLayer(); document.getElementById('full').scrollTop = st; } },
    catDown: function (k) { var i = state.cats.indexOf(catOf(k)); if (i >= 0 && i < state.cats.length - 1) { var x = state.cats.splice(i, 1)[0]; state.cats.splice(i + 1, 0, x); buildCats(); save(); hap(0); var st = document.getElementById('full').scrollTop; catsLayer(); document.getElementById('full').scrollTop = st; } },
    archOpen: function (mk) { closeSheet(); archMonth(mk); },
    archBack: function () { ui.catSnap = null; archiveLayer(); },
    archCsv: function () { var e = ui.arch; var ok = A.saveToDownloads('Slate-' + e.month + '-archive.csv', 'text/csv', csv(e.txns)); toast(ok ? 'Saved to Downloads' : 'Could not save the file'); },
    archImg: function () { var ok = false; try { ok = A.shareImage('Slate-' + ui.arch.month + '-' + Date.now() + '.png', wrapImage(ui.arch.w)); } catch (x) { } if (!ok) toast('Could not make the picture'); },
    archDel: function () {
      if (!ui.archArm) { ui.archArm = true; toast('Tap again to delete ' + mname(ui.arch.month) + ' for good'); setTimeout(function () { ui.archArm = false; }, 4000); return; }
      ui.archArm = false; state.archive.splice(state.archive.indexOf(ui.arch), 1); save(); hap(2); ACT.archBack(); toast('Deleted');
    },
    keepAsk: function () { sheet('<div class="hd"><b>Keep months for</b><button class="x" data-act="close">✕</button></div><div class="card" style="padding:4px 16px">' + [[6, '6 months'], [12, '1 year'], [24, '2 years'], [0, 'Forever']].map(function (o) { return '<div class="kv" data-act="keepSet" data-v="' + o[0] + '"><b>' + o[1] + '</b><span>' + ((state.keepMonths || 0) === o[0] ? '✓' : '') + '</span></div>'; }).join('') + '</div><p class="mute small" style="margin:4px">Each month takes very little space. Older months beyond this are removed when a new month is archived.</p>', 'keep'); },
    keepSet: function (v) { state.keepMonths = +v; save(); closeSheet(); archiveLayer(); },
    backup: function () { var ok = false; try { ok = A.saveToDownloads('Slate-backup-' + iso(Date.now()) + '.json', 'application/json', JSON.stringify({ app: 'slate', kind: 'backup', at: Date.now(), state: state })); } catch (x) { } toast(ok ? 'Backup saved to Downloads' : 'Could not save the backup'); if (ok) hap(1); },
    restore: function () { try { A.pickBackup(); } catch (x) { toast('Restoring needs the latest Slate'); } },
    importGo: function () {
      var list = ui.importList; if (!list) return; ui.importList = null;
      if (state.onboarded && A.hasSmsPermission()) scan(false);       // read the latest SMS first so more entries match
      var r = importRows(list); save(); closeSheet(); if (ui.layer) closeFull(); renderA(); confetti(80);
      toast(r.matched + ' matched · ' + r.added + ' added' + (r.past ? ' · ' + r.past + ' to the Archive' : '') + (r.cats.length ? ' · ' + r.cats.length + ' new categor' + (r.cats.length === 1 ? 'y' : 'ies') : ''));
    },
    importStart: function () { closeSheet(); try { A.pickBackup(); } catch (x) { toast('Importing needs the latest Slate'); } },
    restoreGo: function () {
      var o = ui.restoreData; if (!o) return; ACT.backup(); ui.restoreData = null;
      for (var k in o) state[k] = o[k]; load2(); rollover(); save(); closeSheet(); closeFull(); applyLook(); renderA(); confetti(90); toast('Restored');
    },
    menu: menuSheet,
    go: function (v) { closeSheet(); ACT.tab(v); },
    goSort: function () { closeSheet(); ACT.sort(); }, goFixed: function () { closeSheet(); fixedLayer(); }, goIou: function () { closeSheet(); iouLayer(); }, goSettings: function () { settingsSheet(); },
    sortOne: function () { ACT.sort(); },
    railDay: function (v) { if (+v > new Date().getDate()) return; ui.selBar = +v; ui.tab = 'month'; renderA(); var b = document.querySelector('.bars'); if (b) b.scrollIntoView({ block: 'center' }); },
    fixed: fixedLayer, iou: iouLayer, bals: balsLayer,
    balOpen: balSheet,
    balHint: function (v) { var e = document.getElementById('balVal'); e.value = Math.round(+v); e.setAttribute('data-exact', v); },
    balSave: function () { var v = parseFloat(document.getElementById('balVal').value); if (isNaN(v)) { toast('Type the amount'); return; } var hb = ui.balHint && ui.balHint.v === v;   // the bank's own figure: count everything after that SMS
      state.accts[ui.bal].base = hb ? { v: +document.getElementById('balVal').getAttribute('data-exact') || v, ts: ui.balHint.ts } : { v: v, ts: Date.now() }; save(); closeSheet(); balsLayer(); toast('Saved. Slate takes it from here'); },
    mergeAsk: function () {
      var from = ui.bal, ty = state.accts[from].type;
      sheet('<div class="hd"><b>Merge ' + esc(from) + '</b><button class="x" data-act="close">✕</button></div><p class="mute" style="margin:0 0 10px">Banks sometimes quote your debit card digits in one message and your account digits in another. Pick the one this really belongs to. Its transactions move there, now and in future.</p><div class="card" style="padding:4px 16px">' +
        Object.keys(state.accts).filter(function (k) { return k !== from && state.accts[k].type === ty; }).map(function (k) { return '<div class="kv" data-act="mergeInto" data-v="' + esc(k) + '"><b>' + esc(k) + '</b><span class="mute">›</span></div>'; }).join('') + '</div>', 'merge');
    },
    mergeInto: function (to) {
      var from = ui.bal; if (!state.accts[to] || !state.accts[from]) return;
      state.alias[from] = to; Object.keys(state.alias).forEach(function (k) { if (state.alias[k] === from) state.alias[k] = to; });
      state.txns.forEach(function (t) { if (t.acct === from) t.acct = to; });
      delete state.accts[from]; save(); closeSheet(); balsLayer(); toast('Merged into ' + to);
    },
    balStop: function () { state.accts[ui.bal].base = null; save(); closeSheet(); balsLayer(); },
    acctAdd: function () {
      ui.newType = 'bank';
      sheet('<div class="hd"><b>Add an account</b><button class="x" data-act="close">✕</button></div><div class="seg2" id="aType"><button data-act="aType" data-v="bank" class="on">Bank account</button><button data-act="aType" data-v="card">Credit card</button></div>' +
        '<label class="f">Name</label><input type="text" id="aName" placeholder="e.g. HDFC Savings"><p class="mute small" style="margin:10px 2px 0">Accounts your bank texts you about appear here on their own. Add one by hand only if it never shows up.</p><div style="margin-top:14px"><button class="btn pri" data-act="acctSave">Add</button></div>', 'acct');
    },
    aType: function (v) { ui.newType = v; var b = document.querySelectorAll('#aType button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === v ? 'on' : ''; },
    acctSave: function () { var nm = document.getElementById('aName').value.trim(); if (!nm) { toast('Give it a name'); return; } if (state.accts[nm]) { toast('That name is already there'); return; } state.accts[nm] = { type: ui.newType, base: null }; save(); closeSheet(); balsLayer(); },
    eAcct: function (k) { ui.draft.acct = k; document.getElementById('eAcct').innerHTML = acctChips(k); },
    fxAdd: function () { fxSheet({ id: 'f' + Date.now(), name: '', amt: 0, day: 0, keys: [], paid: '' }, true); },
    fxOpen: function (id) { var f = state.fixed.filter(function (x) { return x.id === id; })[0]; if (f) fxSheet(f, false); },
    fxSave: function () {
      var f = ui.fx.f, nm = document.getElementById('fName').value.trim(), amt = parseFloat(document.getElementById('fAmt').value), dy = parseInt(document.getElementById('fDay').value, 10);
      if (!nm) { toast('Give it a name'); return; } if (!(amt > 0)) { toast('Enter the amount'); return; }
      f.name = nm; f.amt = amt; f.day = dy >= 1 && dy <= 31 ? dy : 0; if (ui.fx.isNew) state.fixed.push(f);
      save(); closeSheet(); fixedLayer(); toast('Saved');
    },
    fxToggle: function () { var f = ui.fx.f; f.paid = f.paid === state.month ? '' : state.month; save(); fxSheet(f, false); fixedLayer(); hap(0); var fs = fxState(); if (f.paid && fs.nPaid === state.fixed.length && state.fixed.length > 1) confetti(80); },
    fxLink: function (id) { var f = ui.fx.f, t = find(id); if (!t) return; var k = P.merchantKey(t.who); if (!k) return; f.keys = (f.keys || []).concat([k]); if (!state.rules[k]) { state.rules[k] = 'bills'; state.txns.forEach(function (x) { if (!x.edited && P.merchantKey(x.who) === k && x.b === '?') x.b = 'bills'; }); } save(); closeSheet(); fixedLayer(); toast('Linked. It will tick itself from now on'); },
    fxDel: function () { state.fixed.splice(state.fixed.indexOf(ui.fx.f), 1); save(); closeSheet(); fixedLayer(); toast('Deleted'); },
    txFixed: function () { var t = ui.draft.t, k = P.merchantKey(t.who); closeSheet(); var f = { id: 'f' + Date.now(), name: t.who || 'Fixed payment', amt: t.amt, day: new Date(t.ts).getDate(), keys: k ? [k] : [], paid: k ? '' : state.month }; state.fixed.push(f); if (k && !state.rules[k]) state.rules[k] = 'bills'; if (t.b === '?') { t.b = 'bills'; t.edited = true; } save(); renderA(); fixedLayer(); toast('Added to fixed payments'); },
    iouAdd: function () { iouSheet({ id: 'i' + Date.now(), dir: 'lent', who: '', amt: 0, note: '', ts: Date.now(), done: false }, true); },
    iouOpen: function (id) { var x = state.iou.filter(function (y) { return y.id === id; })[0]; if (x) iouSheet(x, false); },
    iDir: function (v) { ui.io.dir = v; var b = document.querySelectorAll('#iDir button'); for (var i = 0; i < b.length; i++) b[i].className = b[i].getAttribute('data-v') === v ? 'on' : ''; },
    iouSave: function () {
      var x = ui.io.x, amt = parseFloat(document.getElementById('iAmt').value), who = document.getElementById('iWho').value.trim();
      if (!(amt > 0)) { toast('Enter the amount'); return; } if (!who) { toast('Who was it?'); return; }
      x.amt = amt; x.who = who; x.note = document.getElementById('iNote').value.trim(); x.dir = ui.io.dir; if (ui.io.isNew) state.iou.unshift(x);
      save(); closeSheet(); iouLayer(); toast('Saved');
    },
    iouDone: function () { var x = ui.io.x; x.done = !x.done; x.doneTs = Date.now(); save(); closeSheet(); iouLayer(); toast(x.done ? 'Settled 🎉' : 'Reopened'); if (x.done) confetti(70); },
    iouDel: function () { state.iou.splice(state.iou.indexOf(ui.io.x), 1); save(); closeSheet(); iouLayer(); toast('Deleted'); },
    iouNudge: function () { var x = ui.io.x, d = new Date(x.ts); A.shareText('Hi ' + x.who.split(' ')[0] + ', hope you are doing well! Just a gentle reminder about the ' + inr(x.amt) + ' from ' + d.getDate() + ' ' + MON[d.getMonth()] + (x.note ? ' (' + x.note + ')' : '') + '. Whenever it is convenient. Thank you!'); },
    txLent: function () { var t = ui.draft.t; closeSheet(); t.b = 'moved'; t.edited = true; state.iou.unshift({ id: 'i' + Date.now(), dir: 'lent', who: t.who || '', amt: t.amt, note: '', ts: t.ts, done: false }); save(); renderA(); iouLayer(); toast('Tracked as lent. Not counted as a spend'); },
    txBorrowed: function () { var t = ui.draft.t; closeSheet(); t.b = 'moved'; t.edited = true; state.iou.unshift({ id: 'i' + Date.now(), dir: 'borrowed', who: t.who || '', amt: t.amt, note: '', ts: t.ts, done: false }); save(); renderA(); iouLayer(); toast('Tracked as borrowed'); },
    fb: function (k) { ui.fb = ui.fb === k ? '' : k; keep(); },
    bar: function (v) { ui.selBar = ui.selBar === +v ? -1 : +v; keep(); },
    wrap: function () { var w = summary(); w.live = true; showWrap(w, true); },
    wrapTxt: function () { A.shareText(wrapText(ui.wrapData)); },
    wrapImg: function () { var ok = false; try { ok = A.shareImage('Slate-' + ui.wrapData.month + '-' + Date.now() + '.png', wrapImage(ui.wrapData)); } catch (e) { } if (!ok) toast('Could not make the picture'); },
    export: function () { if (!state.txns.length) { toast('Nothing to export yet'); return; } var ok = A.saveToDownloads('Slate-' + state.month + '-' + iso(Date.now()) + '.csv', 'text/csv', csv(state.txns)); toast(ok ? 'Saved to Downloads' : 'Could not save the file'); },
    rescan: function () { closeSheet(); scan(true); toast('Up to date'); },
    wipe: function () {
      if (!ui.armed) { ui.armed = true; toast('Tap again to clear this month'); setTimeout(function () { ui.armed = false; }, 4000); return; }
      ui.armed = false; var had = state.txns.length;
      if (had && state.autoCsv !== false) A.saveToDownloads('Slate-' + state.month + '-' + iso(Date.now()) + '.csv', 'text/csv', csv(state.txns));
      if (had) archiveNow(new Date().getDate());
      foldBalances(Date.now()); state.txns.forEach(function (t) { if (/^s/.test(t.id)) state.deleted[t.id] = 1; }); state.txns = []; save(); closeSheet(); renderA(); toast(had ? 'Fresh start. The old entries are in your Archive' : 'Fresh start');
    }
  };
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (!el || el === document.body || !el.getAttribute) return;
    var a = el.getAttribute('data-act'), f = ACT[a];
    if (ui.dock && a !== 'dock' && !/^dk/.test(a)) { ui.dock = false; nav(); }
    if (f) f(el.getAttribute('data-v'));
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { ui.q = e.target.value; document.getElementById('list').innerHTML = listHtml(); }
    else if (e.target.id === 'aq' && ui.arch) { document.getElementById('alist').innerHTML = listHtml(ui.arch.txns, e.target.value, true); }
    else if (e.target.id === 'cEmoIn' && e.target.value.trim()) { document.getElementById('cPrev').textContent = clean(e.target.value); }
  });

  window.onNative = function (what, val) {
    if (what === 'perm') { ui.perm = !!val; ui.denied = !val; if (val) { scan(false); if (!state.budget) budgetSheet(true); } else render(); }
    else if (what === 'restore') { if (val == null) return; if (!val) { toast('Could not open that file'); return; } importFile(val); }
    else if (what === 'backupFile') {
      var o = null; try { o = JSON.parse(val); } catch (x) { }
      if (!o || o.app !== 'slate' || !o.state || !Array.isArray(o.state.txns)) { toast('That is not a Slate backup file'); return; }
      ui.restoreData = o.state; var d = new Date(o.at || Date.now()), ar = (o.state.archive || []).length;
      sheet('<div class="hd"><b>Restore this backup?</b><button class="x" data-act="close">✕</button></div><div class="card"><b>Saved ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + '</b><div class="mute small" style="margin-top:4px">' + o.state.txns.length + ' entries for ' + (o.state.month ? mlong(o.state.month) : 'its month') + ' · ' + ar + ' archived month' + (ar === 1 ? '' : 's') + ' · ' + ((o.state.cats || []).length || 'default') + ' categories</div></div>' +
        '<p class="mute small" style="margin:0 2px 12px">This replaces what is in Slate now. Your current data is backed up to Downloads first, just in case.</p><button class="btn pri" data-act="restoreGo">Restore</button><button class="btn" data-act="close">Cancel</button>', 'restore');
    }
    else if (what === 'notifyPerm') { if (ui.sheet === 'settings') settingsSheet(); }
    else if (what === 'openSms') { if (A.hasSmsPermission()) scan(false); var b0 = norm(val), ot = null; state.txns.forEach(function (t) { if (!ot && t.raw && norm(t.raw) === b0) ot = t; }); if (ot) { closeFull(); editSheet(ot, false); } }
    else if (what === 'resume') { if (ui.layer) return; rollover(); if (state.onboarded && A.hasSmsPermission()) { ui.anim = true; var n = scan(false); if (n) toast(n + ' new'); } if (ui.showWrap && state.wrap) { ui.showWrap = false; showWrap(state.wrap, false); } }
  };
  window.handleBack = function () {
    if (ui.dock) { ui.dock = false; nav(); return true; }
    if (ui.sheet === 'cat') { ACT.catClose(); return true; }
    if (ui.sheet) { closeSheet(); return true; }
    if (ui.layer === 'archMonth') { ACT.archBack(); return true; }
    if (ui.layer) { ACT.closeFull(); return true; }
    if (ui.tab !== 'today') { ACT.tab('today'); return true; }
    return false;
  };

  load(); rollover(); applyLook();
  ui.perm = A.hasSmsPermission();
  render();
  if (state.onboarded && ui.perm) scan(false);
  if (ui.showWrap && state.wrap) { ui.showWrap = false; showWrap(state.wrap, false); }
})();
