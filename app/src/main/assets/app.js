/* Slate: one month of spending, a fresh start every month. Everything stays on the phone. */
(function () {
  'use strict';
  var P = window.SmsParser, A = window.Android, DAY = 86400000;
  var B = { // buckets
    food: ['🍽️', 'Food'], groceries: ['🛒', 'Groceries'], travel: ['🚕', 'Travel'], shopping: ['🛍️', 'Shopping'], bills: ['💡', 'Bills & home'],
    health: ['💊', 'Health'], fun: ['🎬', 'Fun'], people: ['🤝', 'People'], cash: ['💵', 'Cash'], other: ['✨', 'Other'], moved: ['🔁', 'Not a spend']
  };
  var ORDER = ['food', 'groceries', 'travel', 'shopping', 'bills', 'health', 'fun', 'people', 'cash', 'other'];
  var MAP = { 'Food & Dining': 'food', 'Groceries': 'groceries', 'Shopping': 'shopping', 'Transport': 'travel', 'Fuel': 'travel', 'Travel': 'travel', 'Bills & Utilities': 'bills', 'Rent & Housing': 'bills',
    'EMI & Loans': 'bills', 'Insurance': 'bills', 'Education': 'bills', 'Fees & Charges': 'bills', 'Health': 'health', 'Entertainment': 'fun', 'Family & Personal': 'people', 'Charity & Donations': 'people', 'Transfers': 'people',
    'Cash withdrawal': 'cash', 'Investments': 'moved', 'Card bill payment': 'moved', 'Self transfer': 'moved', 'Business': 'other', 'Other': 'other' };
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var state = { v: 1, month: '', txns: [], rules: {}, deleted: {}, budget: 0, notify: false, lastScan: 0, wrap: null, onboarded: false, fixed: [], iou: [], accts: {} };
  var ui = { tab: 'today', perm: true, denied: false, q: '', fb: '', selBar: -1, layer: null, sheet: null, anim: true };

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
    if (state.budget > 0) {
      o.allow = Math.max((state.budget - fx.reserve - (spentMonth - spentToday)) / daysLeft, 0);
      o.leftToday = o.allow - spentToday; o.leftMonth = state.budget - spentMonth - fx.reserve;
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
    var cats = ORDER.filter(function (k) { return by[k]; }).map(function (k) { return [k, by[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var fav = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    return { month: state.month, spent: c.spentMonth, budget: state.budget, n: sp.length, cats: cats, top: cats[0] ? cats[0][0] : '', big: big ? { who: big.who || 'Unknown', amt: big.amt } : null,
      fav: fav && cnt[fav] > 1 ? { who: fav, n: cnt[fav] } : null, zero: c.zero, best: c.best, avg: c.spentMonth / Math.max(c.day, 1), moneyIn: c.moneyIn, days: c.day };
  }

  // ---------- storage ----------
  function load() { try { var s = A.loadData(); if (s) { var o = JSON.parse(s); for (var k in o) state[k] = o[k]; } } catch (e) { } if (!state.rules) state.rules = {}; if (!state.deleted) state.deleted = {}; if (!Array.isArray(state.fixed)) state.fixed = []; if (!Array.isArray(state.iou)) state.iou = []; if (!state.accts) state.accts = {}; if (!state.alias) state.alias = {}; ensureAccts(); }
  var saveT;
  function pushLive() {
    var c = calc(), n = new Date(), known = P.KNOWN_WORDS.concat(Object.keys(state.rules)).filter(function (w) { return w.length >= 4; });
    var fixed = state.fixed.filter(function (f) { return !fxPaid(f) && f.keys && f.keys.length; }).map(function (f) { return f.keys[0] + '\t' + f.name.replace(/[\t\n]/g, ' ') + '\t' + f.amt; });
    try { A.setLive(JSON.stringify({ notify: !!state.notify, budget: state.budget || 0, month: state.month, day: n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(), spentMonth: c.spentMonth, spentToday: c.spentToday,
      reserve: c.reserve || 0, known: known.join('\n'), fixed: fixed.join('\n'), top: topBuckets().map(function (k) { return k + '\t' + B[k][0] + ' ' + B[k][1]; }).join('\n') })); } catch (e) { }
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { try { A.saveData(JSON.stringify(state)); } catch (e) { toast('Could not save'); } pushLive(); }, 120); }

  // ---------- a fresh start every month ----------
  function csv(list) {
    var rows = [['Date', 'Time', 'Type', 'Amount', 'Paid to / from', 'Category', 'Account', 'Note']];
    list.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (t) { rows.push([iso(t.ts), time(t.ts), t.dir === 'out' ? 'Spent' : 'Received', t.amt, t.who, t.b === '?' ? 'Unsorted' : B[t.b][1], t.acct || '', t.note || '']); });
    return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); if (/^[=+\-@]/.test(c) && isNaN(c)) c = "'" + c; return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
  }
  function rollover() {
    var cur = mkey();
    if (!state.month) { state.month = cur; return; }
    if (state.month === cur) return;
    try { if (state.lastScan && A.hasSmsPermission()) ingest(state.lastScan - 5 * 60000, monthStart(), false); } catch (e) { }   // last few days of the old month
    foldBalances(monthStart() - 1);
    if (state.txns.length) {
      var w = summary(); w.saved = false;
      try { w.saved = !!A.saveToDownloads('Slate-' + state.month + '.csv', 'text/csv', csv(state.txns)); } catch (e) { }
      state.wrap = w; ui.showWrap = true;
    }
    state.txns = []; state.deleted = {}; state.lastScan = 0; state.month = cur;
    save();
  }

  // ---------- reading SMS ----------
  function acctName(t) { return t.bank + (t.acctType === 'credit_card' ? ' Card' : '') + (t.last4 ? ' ••' + t.last4 : ''); }
  function bucketFor(t) { var k = P.merchantKey(t.merchant); if (k && state.rules[k]) return state.rules[k]; return MAP[t.category] || '?'; }
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
      if (have[id]) state.txns[state.txns.indexOf(have[id])] = t; else { state.txns.push(t); n++; }
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
    document.getElementById('nav').innerHTML = !ui.perm || !state.onboarded ? '' : '<button class="add" data-act="add" aria-label="Add a spend">+</button>';
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
      row('goIou', '', '🤝', 'Lent & borrowed', io.n ? io.n + ' open' : 'Track who owes whom') + row('goSettings', '', '⚙️', 'Settings', 'Limit, notifications, export') + '</div>', 'menu');
  }
  function pc(t) {       // a spend as a card
    var q = t.b === '?';
    return '<div class="pc" data-act="edit" data-v="' + esc(t.id) + '"><div class="row"><span class="em' + (q ? ' q' : '') + '">' + (q ? '?' : B[t.b][0]) + '</span><b class="grow ell">' + (q ? 'Tap to sort' : B[t.b][1]) + '</b></div>' +
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
      tab('today', 'Today') + tab('bals', 'Balances') + tab('month', mname(state.month)) + '<button class="add" data-act="add" aria-label="Add a spend">+</button>';
  }
  function viewTodayClassic() {
    var c = calc(), n = new Date(), ts = toSort(), h;
    h = '<div class="top"><div><h1>Slate</h1><div class="sub">' + DOW[n.getDay()] + ', ' + n.getDate() + ' ' + mname(state.month) + '</div></div><button class="icon" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24">' + IC.gear + '</svg></button></div>';
    h += hero(c);
    h += '<div class="facts"><div class="fact"><div class="k">Today</div><div class="v num">' + inr(c.spentToday) + '</div></div><div class="fact"><div class="k">Per day so far</div><div class="v num">' + inr(c.spentMonth / c.day) + '</div></div>' +
      '<div class="fact"><div class="k">' + (state.budget > 0 ? 'Streak' : 'No-spend days') + '</div><div class="v">' + (state.budget > 0 ? (c.streak ? '🔥 ' + c.streak + ' day' + (c.streak === 1 ? '' : 's') : '—') : c.zero) + '</div></div></div>';
    if (ts.length) h += '<button class="sortpill" data-act="sort"><span class="n">' + ts.length + '</span><span class="grow"><b>Sort ' + (ts.length === 1 ? 'this spend' : 'these spends') + '</b><span class="s">One tap each. Slate remembers for next time.</span></span><span>›</span></button>';
    var bt = balTotals();
    h += '<button class="slim" data-act="tab" data-v="bals"><span class="grow">' + (bt.set ? '💰 <b class="num">' + inr(bt.have) + '</b> in hand' + (bt.owe ? ' · <b class="num">' + inr(bt.owe) + '</b> on cards' : '') : '💰 Enter your balances once and Slate keeps them current') + '</span><span>›</span></button>';
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
    try { A.setChrome(bg, dark); } catch (e) { }
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

  function txRow(t) {
    var q = t.b === '?';
    return '<div class="tx" data-act="edit" data-v="' + esc(t.id) + '"><div class="em' + (q ? ' q' : '') + '">' + (q ? '?' : B[t.b][0]) + '</div><div class="grow"><div class="who ell">' + esc(t.who || (t.dir === 'in' ? 'Money in' : 'Unknown')) + '</div>' +
      '<div class="meta ell">' + (q ? 'Tap to sort' : B[t.b][1]) + ' · ' + time(t.ts) + (t.acct ? ' · ' + esc(t.acct) : '') + '</div></div><div class="amt num' + (t.dir === 'in' ? ' in' : '') + '">' + (t.dir === 'in' ? '+' : '') + inr(t.amt) + '</div></div>';
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
    h += '<div class="tl">' + rail(c) + '<div class="col">';
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
    if (s.cats.length) {
      h += '<div class="card"><h2>Where it went</h2>' + s.cats.map(function (k) {
        return '<div class="cat' + (ui.fb === k[0] ? ' on' : '') + '" data-act="fb" data-v="' + k[0] + '"><div class="l"><span>' + B[k[0]][0] + ' ' + B[k[0]][1] + '</span><span class="num"><b>' + inr(k[1]) + '</b> <span class="mute">' + Math.round(k[1] / s.spent * 100) + '%</span></span></div><div class="trk"><i style="width:' + (k[1] / s.cats[0][1] * 100).toFixed(1) + '%"></i></div></div>';
      }).join('') + '</div>';
      var max = 0; for (i = 1; i <= c.dim; i++) if ((c.per[i] || 0) > max) max = c.per[i];
      var tip = ui.selBar > 0 ? '<b>' + inr(c.per[ui.selBar] || 0) + '</b> on the ' + ui.selBar + nth(ui.selBar) : 'Tap a bar to see that day';
      h += '<div class="card"><h2>Day by day</h2><div class="tip">' + tip + '</div><div class="bars">';
      for (i = 1; i <= c.dim; i++) { var v = c.per[i] || 0; h += '<div class="b' + (v ? '' : ' zero') + (i === c.day ? ' today' : '') + (i === ui.selBar ? ' sel' : '') + '" data-act="bar" data-v="' + i + '"><i style="height:' + (max ? Math.max(v / max * 100, v ? 3 : 0) : 0).toFixed(1) + '%;--i:' + i + '"></i></div>'; }
      h += '</div><div class="xl">'; for (i = 1; i <= c.dim; i++) h += '<span>' + (i === 1 || i % 5 === 0 ? i : '') + '</span>'; h += '</div></div>';
    }
    h += '<div class="row" style="margin-bottom:12px"><button class="btn dark" style="margin:0" data-act="wrap">' + mname(state.month) + ' so far ✨</button><button class="btn" style="margin:0" data-act="export">Export</button></div>';
    h += '<input type="search" id="q" placeholder="Search" value="' + esc(ui.q) + '">' + (ui.fb ? '<div class="quick"><button data-act="fb" data-v="' + ui.fb + '">' + B[ui.fb][0] + ' ' + B[ui.fb][1] + ' ✕</button></div>' : '') + '<div id="list">' + listHtml() + '</div>';
    return h;
  }
  function nth(d) { return d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'; }
  function listHtml() {
    var q = ui.q.trim().toLowerCase(), list = state.txns.filter(function (t) { return (!ui.fb || t.b === ui.fb) && (!q || ((t.who || '') + ' ' + t.amt + ' ' + (t.note || '') + ' ' + (B[t.b] ? B[t.b][1] : '')).toLowerCase().indexOf(q) >= 0); });
    if (!list.length) return '<div class="empty">Nothing to show.</div>';
    var h = '', i = 0;
    while (i < list.length) {
      var d0 = sod(list[i].ts), j = i, tot = 0, d = new Date(d0);
      while (j < list.length && sod(list[j].ts) === d0) { if (list[j].dir === 'out' && list[j].b !== 'moved') tot += list[j].amt; j++; }
      h += '<div class="day"><span>' + (d0 === sod(Date.now()) ? 'Today' : DOW[d.getDay()] + ' ' + d.getDate()) + '</span><span class="num">' + (tot ? inr(tot) : '') + '</span></div><div class="card" style="padding:4px 14px;margin:6px 0 0">' + list.slice(i, j).map(txRow).join('') + '</div>';
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
      '<ul><li><b>Zero typing.</b> Slate reads your bank SMS on this phone.</li><li><b>A clean slate every month.</b> Details are exported, then cleared on the 1st.</li><li><b>Private by design.</b> No account, no cloud, no internet permission.</li></ul>' +
      '<button class="btn pri" data-act="start">Get started</button></div>';
  }
  function render() {
    nav();
    var v = document.getElementById('view');
    v.className = state.onboarded && ui.perm && ui.tab === 'today' && look() === 'sway' ? 'bleed' : '';
    v.innerHTML = !state.onboarded ? viewWelcome() : !ui.perm ? viewPerm() : ui.tab === 'today' ? viewToday() : ui.tab === 'bals' ? viewBals() : viewMonth();
    if (ui.anim) {
      void v.offsetWidth; v.classList.add('anim');
      var els = v.querySelectorAll('[data-count]'), i;
      for (i = 0; i < els.length; i++) tween(els[i], +els[i].getAttribute('data-count'));
      setTimeout(function () { var f = v.querySelector('.ring .f, .ringhero .f'); if (f) f.setAttribute('stroke-dashoffset', f.getAttribute('data-to')); var b = v.querySelector('.hero .bar i'); if (b) b.style.width = b.getAttribute('data-w') + '%'; }, 60);
    }
    ui.anim = false;
  }
  function renderA() { ui.anim = true; render(); }
  function keep() { var v = document.getElementById('view'), st = v.scrollTop; render(); v.scrollTop = st; }
  function tween(el, to) {
    if (!(to > 0) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var t0 = null; function step(ts) { if (t0 == null) t0 = ts; var k = Math.min((ts - t0) / 650, 1), e = 1 - Math.pow(1 - k, 3); if (!el.isConnected) return; el.textContent = inr(to * e); if (k < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  // ---------- layers ----------
  function sheet(html, kind) { ui.sheet = kind; var s = document.getElementById('sheet'); s.innerHTML = html; s.scrollTop = 0; document.body.classList.add('sheet'); }
  function closeSheet() { ui.sheet = null; document.body.classList.remove('sheet'); }
  function full(html, kind) { ui.layer = kind; var f = document.getElementById('full'); f.innerHTML = html; f.scrollTop = 0; document.body.classList.add('full'); }
  function closeFull() { ui.layer = null; document.body.classList.remove('full'); }
  function find(id) { for (var i = 0; i < state.txns.length; i++) if (state.txns[i].id === id) return state.txns[i]; return null; }
  function picks(cur, act) { return '<div class="grid">' + ORDER.concat(['moved']).map(function (k) { return '<button class="pick' + (cur === k ? ' on' : '') + '" data-act="' + act + '" data-v="' + k + '"><span>' + B[k][0] + '</span>' + B[k][1] + '</button>'; }).join('') + '</div>'; }
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
    if (!list.length) { closeFull(); renderA(); toast(all.length ? all.length + ' left for later' : 'All sorted 🎉'); return; }
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
      (w.top ? cell('Most went on', B[w.top][0] + ' ' + B[w.top][1]) : '') + (w.big ? cell('Biggest spend', esc(w.big.who) + ' ' + inr(w.big.amt)) : '') +
      (w.fav ? cell('Regular haunt', esc(w.fav.who) + ' ×' + w.fav.n) : cell('Spends', w.n)) + cell('Per day', inr(w.avg)) + cell('No-spend days', w.zero) + (w.budget > 0 ? cell('Best streak', w.best + ' day' + (w.best === 1 ? '' : 's')) : cell('Money in', inr(w.moneyIn))) +
      '</div><div class="f">Slate · tracked privately on my phone</div></div>';
  }
  function showWrap(w, live) {
    ui.wrapData = w;
    full('<div class="row"><b class="grow" style="font-size:18px">' + (live ? 'Your month so far' : 'A clean slate') + '</b><button class="x" data-act="closeFull">✕</button></div>' + wrapHtml(w, live) +
      (live ? '' : '<p class="mute" style="margin:0 2px 16px">' + mname(w.month) + ' is cleared for a fresh start.' + (w.saved ? ' Every transaction was saved to your Downloads folder as Slate-' + w.month + '.csv.' : '') + '</p>') +
      '<button class="btn pri" data-act="wrapImg">Share as a picture</button><button class="btn" data-act="wrapTxt">Share as text</button>', 'wrap');
  }
  function wrapText(w) {
    var L = ['My ' + mname(w.month) + ' with Slate', 'Spent: ' + inr(w.spent) + (w.budget > 0 ? ' of ' + inr(w.budget) : '')];
    w.cats.slice(0, 5).forEach(function (c) { L.push(B[c[0]][0] + ' ' + B[c[0]][1] + ': ' + inr(c[1])); });
    L.push('No-spend days: ' + w.zero); return L.join('\n');
  }
  function wrapImage(w) {
    var c = document.createElement('canvas'); c.width = 1080; c.height = 1350; var g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 1080, 1350); gr.addColorStop(0, '#0d9668'); gr.addColorStop(0.7, '#064d47'); gr.addColorStop(1, '#0b2b33'); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.arc(120, 1300, 380, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    g.globalAlpha = .8; g.font = '700 38px system-ui, sans-serif'; g.fillText(mname(w.month).toUpperCase() + (w.live ? '  SO FAR' : ',  WRAPPED'), 90, 110);
    g.globalAlpha = 1; g.font = '800 150px system-ui, sans-serif'; g.fillText(inr(w.spent), 84, 180);
    var saved = w.budget > 0 ? w.budget - w.spent : null;
    g.font = '500 46px system-ui, sans-serif'; g.globalAlpha = .92; g.fillText(saved == null ? w.n + ' spends across ' + w.days + ' days' : saved >= 0 ? 'Stayed ' + inr(saved) + ' under my limit' : inr(-saved) + ' over my limit', 90, 370);
    var cells = []; if (w.top) cells.push(['Most went on', B[w.top][1]]); if (w.big) cells.push(['Biggest spend', inr(w.big.amt)]); cells.push(['Per day', inr(w.avg)]); cells.push(['No-spend days', String(w.zero)]);
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
    h += '<div class="duo"><div class="tile"><span class="k">In bank and cash</span><b class="num" style="font-size:22px;color:var(--accent)">' + (bt.set ? inr(bt.have) : '—') + '</b></div><div class="tile"><span class="k">Owed on cards</span><b class="num" style="font-size:22px">' + (bt.set ? inr(bt.owe) : '—') + '</b></div></div>';
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
      '<div class="kv" data-act="budget"><span><b>Monthly limit</b><br><span class="mute small">' + (state.budget ? inr(state.budget) : 'Not set') + '</span></span><span class="mute">›</span></div>' +
      '<div class="kv"><span><b>Tell me after each spend</b><br><span class="mute small">' + (state.notify && !ready ? 'Needs notification and SMS permission. Tap the switch again.' : 'What is left for today, and one tap to sort a spend Slate does not recognise') + '</span></span><button class="sw' + (state.notify ? ' on' : '') + '" data-act="notify" aria-label="Spend notifications"></button></div></div>' +
      '<div class="card" style="padding:4px 16px"><div class="kv" data-act="export"><span><b>Export this month</b><br><span class="mute small">A spreadsheet file in your Downloads folder</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="rescan"><span><b>Read my messages again</b><br><span class="mute small">Your own changes are kept</span></span><span class="mute">›</span></div>' +
      '<div class="kv" data-act="wipe"><span><b style="color:var(--red)">Start the month over</b><br><span class="mute small">Exports first, then clears everything</span></span><span class="mute">›</span></div></div>' +
      '<p class="mute small" style="margin:4px 4px 0">Slate keeps one month at a time. On the 1st it saves the month to Downloads and starts clean. It has no internet access, so nothing leaves this phone.</p>', 'settings');
  }

  // ---------- actions ----------
  var ACT = {
    tab: function (v) { ui.tab = v; ui.selBar = -1; renderA(); document.getElementById('view').scrollTop = 0; },
    start: function () { state.onboarded = true; save(); ui.perm = A.hasSmsPermission(); if (ui.perm) { scan(false); if (!state.budget) budgetSheet(true); } else render(); },
    askPerm: function () { A.requestSmsPermission(); },
    appSettings: function () { A.openAppSettings(); },
    settings: settingsSheet, close: closeSheet, closeFull: function () { closeFull(); renderA(); },
    budget: function () { budgetSheet(false); },
    bQuick: function (v) { document.getElementById('bVal').value = v; },
    bSave: function () { state.budget = Math.max(parseFloat(document.getElementById('bVal').value) || 0, 0); save(); closeSheet(); renderA(); toast(state.budget ? 'Limit set' : 'Limit removed'); },
    notify: function () { var ready = false; try { ready = A.notifyReady(); } catch (e) { } if (state.notify && ready) state.notify = false; else { state.notify = true; if (!ready) A.requestNotifyPermissions(); } save(); settingsSheet(); },
    add: function () { editSheet({ id: 'm' + Date.now(), ts: Date.now(), amt: 0, dir: 'out', who: '', b: '', acct: 'Cash', note: '', edited: true }, true); setTimeout(function () { var e = document.getElementById('eAmt'); if (e) e.focus(); }, 250); },
    edit: function (id) { var t = find(id); if (t) editSheet(t, false); },
    eB: function (k) { ui.draft.b = k; document.getElementById('ePick').innerHTML = picks(k, 'eB'); },
    saveTx: function () {
      var d = ui.draft, t = d.t, amt = parseFloat(document.getElementById('eAmt').value);
      if (!(amt > 0)) { toast('Enter the amount'); return; }
      if (!d.b) { toast('Pick what it was'); return; }
      if (/^m/.test(t.id)) t.acct = d.acct;
      t.amt = amt; t.who = document.getElementById('eWho').value.trim(); t.note = document.getElementById('eNote').value.trim(); t.b = d.b; t.edited = true;
      if (d.isNew) state.txns.push(t);
      var n = learn(t); state.txns.sort(function (a, b) { return b.ts - a.ts; });
      save(); closeSheet(); renderA(); toast(n ? 'Saved · ' + n + ' more sorted the same way' : 'Saved');
    },
    delTx: function () { var t = ui.draft.t; snapshot(); state.txns.splice(state.txns.indexOf(t), 1); if (/^s/.test(t.id)) state.deleted[t.id] = 1; save(); closeSheet(); renderA(); toast('Removed', true); },
    undo: function () { if (!ui.undo) return; var o = JSON.parse(ui.undo); state.txns = o.txns; state.rules = o.rules; state.deleted = o.deleted; ui.undo = null; save(); renderA(); toast('Back again'); },
    sort: function () { ui.sortTotal = toSort().length; ui.skipped = {}; sortNext(); },
    sortB: function (k) { var t = find(ui.sorting); if (!t) return; t.b = k; t.edited = true; learn(t); save(); sortNext(); },
    sortSkip: function () { ui.skipped[ui.sorting] = 1; sortNext(); },
    looks: lookSheet,
    setLook: function (k) { state.look = k; save(); applyLook(); closeSheet(); renderA(); toast(LOOKS[k][0] + ' it is'); },
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
    fxToggle: function () { var f = ui.fx.f; f.paid = f.paid === state.month ? '' : state.month; save(); fxSheet(f, false); fixedLayer(); },
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
    iouDone: function () { var x = ui.io.x; x.done = !x.done; x.doneTs = Date.now(); save(); closeSheet(); iouLayer(); toast(x.done ? 'Settled 🎉' : 'Reopened'); },
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
      ui.armed = false; if (state.txns.length) A.saveToDownloads('Slate-' + state.month + '-' + iso(Date.now()) + '.csv', 'text/csv', csv(state.txns));
      foldBalances(Date.now()); state.txns.forEach(function (t) { if (/^s/.test(t.id)) state.deleted[t.id] = 1; }); state.txns = []; save(); closeSheet(); renderA(); toast('Cleared. A copy is in Downloads');
    }
  };
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !(el.getAttribute && el.getAttribute('data-act'))) el = el.parentNode;
    if (!el || el === document.body || !el.getAttribute) return;
    var f = ACT[el.getAttribute('data-act')]; if (f) f(el.getAttribute('data-v'));
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'q') { ui.q = e.target.value; document.getElementById('list').innerHTML = listHtml(); } });

  window.onNative = function (what, val) {
    if (what === 'perm') { ui.perm = !!val; ui.denied = !val; if (val) { scan(false); if (!state.budget) budgetSheet(true); } else render(); }
    else if (what === 'notifyPerm') { if (ui.sheet === 'settings') settingsSheet(); }
    else if (what === 'openSms') { if (A.hasSmsPermission()) scan(false); var b0 = norm(val), ot = null; state.txns.forEach(function (t) { if (!ot && t.raw && norm(t.raw) === b0) ot = t; }); if (ot) { closeFull(); editSheet(ot, false); } }
    else if (what === 'resume') { if (ui.layer) return; rollover(); if (state.onboarded && A.hasSmsPermission()) { ui.anim = true; var n = scan(false); if (n) toast(n + ' new'); } if (ui.showWrap && state.wrap) { ui.showWrap = false; showWrap(state.wrap, false); } }
  };
  window.handleBack = function () {
    if (ui.sheet) { closeSheet(); return true; }
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
