const P = require('../app/src/main/assets/parser.js');
const S = require('./samples.js');
let fail = 0;
S.forEach((s, i) => {
  const r = P.parseSms({ id: i, a: s.a, b: s.b, d: Date.now() }, {});
  const x = s.x, errs = [];
  if (r.kind !== x.kind) errs.push(`kind ${r.kind} != ${x.kind}`);
  else if (r.kind === 'txn') {
    for (const k of Object.keys(x)) {
      if (k === 'kind') continue;
      if (r.txn[k] !== x[k]) errs.push(`${k}: ${JSON.stringify(r.txn[k])} != ${JSON.stringify(x[k])}`);
    }
  } else if (r.kind === 'reminder') {
    if (x.rkind && r.reminder.kind !== x.rkind) errs.push(`rkind ${r.reminder.kind} != ${x.rkind}`);
    if (x.amount != null && r.reminder.amount !== x.amount) errs.push(`amount ${r.reminder.amount} != ${x.amount}`);
    if (x.hasDue && !r.reminder.due) errs.push('due date not parsed');
  }
  if (errs.length) { fail++; console.log(`FAIL #${i} [${s.b.slice(0, 60).replace(/\n/g, ' ')}...]\n   ` + errs.join('\n   ')); }
});
const R = [
  ['SRI KRISHNA SWEETS\nNo 12, Anna Nagar, Chennai\nGSTIN: 33AAAAA0000A1Z5\nBill No: 4521  Date: 10/11/2026\nMysore Pak 250g   1   180.00\nMixture 500g      2   240.00\nSub Total              420.00\nCGST 2.5%               10.50\nSGST 2.5%               10.50\nGrand Total            441.00\nPaid by UPI\nThank you', { amount: 441, merchant: 'Sri Krishna Sweets', category: 'Food & Dining', mode: 'UPI' }],
  ['TAX INVOICE\nApollo Pharmacy\nPh: 044 28290200\nDate 09-Nov-2026 18:22\nDolo 650 Tab   15  30.60\nTotal Items: 1\nTotal 30.60\nCash 50.00\nChange 19.40', { amount: 30.6, merchant: 'Apollo Pharmacy', category: 'Health' }],
  ['INDIAN OIL\nSri Balaji Fuels, Perambur\nNozzle 3  Petrol\nRate 102.63  Volume 9.74 Ltr\nAmount Rs 1,000.00\n11/11/26 08:14', { amount: 1000, category: 'Fuel' }],
  ['Nilgiris Supermarket\nChennai 600011\nRice 5kg 425.00\nOil 1L 189.00\nTotal Qty 2\nTOTAL\n614.00\nYou saved 36.00', { amount: 614, merchant: 'Nilgiris Supermarket', category: 'Groceries' }]
];
R.forEach((c, i) => { const r = P.parseReceipt(c[0], {}); const e = Object.keys(c[1]).filter(k => r[k] !== c[1][k]).map(k => `${k}: ${JSON.stringify(r[k])} != ${JSON.stringify(c[1][k])}`); if (e.length) { fail++; console.log('FAIL bill #' + i + '\n   ' + e.join('\n   ')); } });
console.log(`${S.length + R.length - fail}/${S.length + R.length} passed`);
process.exit(fail ? 1 : 0);
