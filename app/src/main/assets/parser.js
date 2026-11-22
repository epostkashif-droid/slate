/* SMS parser: turns bank SMS into transactions / reminders. Pure functions, no DOM.
   Tuned for ICICI and Axis formats, with generic fallbacks for other Indian banks. */
(function (root) {
  'use strict';

  var BANKS = [
    ['ICICI', /ICICI/i], ['Axis', /AXIS/i], ['HDFC', /HDFC/i], ['SBI', /\bSBI|SBIINB|SBICRD|SBIUPI|SBIPSG|State Bank/i],
    ['Kotak', /KOTAK/i], ['IDFC First', /IDFC/i], ['IndusInd', /INDUS/i], ['Yes Bank', /YESB|YES BANK/i],
    ['PNB', /\bPNB|PUNJAB NATIONAL/i], ['Bank of Baroda', /\bBOB|BARODA/i], ['Canara', /CANARA|CANBNK/i],
    ['Federal', /FEDERAL|FEDBNK/i], ['IOB', /\bIOB|INDIAN OVERSEAS/i], ['Indian Bank', /INDIAN BANK|INDBNK/i],
    ['Union Bank', /UNION BANK|UBOI/i], ['Amex', /AMEX|AMERICAN EXPRESS/i], ['AU Bank', /AUBANK|AU SMALL/i],
    ['RBL', /\bRBL/i], ['HSBC', /HSBC/i], ['Standard Chartered', /STANCHART|SCBANK|STANDARD CHARTERED/i],
    ['OneCard', /ONECARD|ONECRD/i], ['Paytm', /PAYTM/i]
  ];

  var CATEGORIES = [
    'Food & Dining', 'Groceries', 'Shopping', 'Transport', 'Fuel', 'Bills & Utilities', 'Rent & Housing',
    'Health', 'Entertainment', 'Travel', 'Education', 'Investments', 'EMI & Loans', 'Insurance',
    'Cash withdrawal', 'Fees & Charges', 'Family & Personal', 'Charity & Donations', 'Business', 'Transfers', 'Card bill payment', 'Self transfer',
    'Salary & Income', 'Refunds & Cashback', 'Other', 'Uncategorised'
  ];
  // Not counted as spend or income (money moving between your own accounts)
  var EXCLUDED = { 'Card bill payment': 1, 'Self transfer': 1 };

  function kw(list) {
    return new RegExp('(?:^|[^a-z0-9])(?:' + list.join('|') + ')(?![a-z])', 'i');
  }
  // Order matters: specific before generic.
  var CAT_RULES = [
    ['Card bill payment', kw(['credit card payment', 'card bill', 'cred club', 'cred', 'cc payment', 'creditcard', 'credit card'])],
    ['Insurance', kw(['lic', 'insurance', 'policybazaar', 'star health', 'hdfc ergo', 'lombard', 'icici pru', 'max life', 'tata aia', 'bajaj allianz', 'acko'])],
    ['EMI & Loans', kw(['emi', 'loan', 'bajaj fin', 'bajajfin', 'hdfcltd', 'home loan', 'homeloan', 'lichfl', 'tatacapital'])],
    ['Investments', kw(['zerodha', 'groww', 'mutual fund', 'sip', 'upstox', 'kuvera', 'nps', 'ppf', 'indmoney', 'smallcase', 'bse star', 'bsestar', 'iccl', 'nse clearing', 'mf utility', 'cams', 'coin'])],
    ['Groceries', kw(['bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'd mart', 'avenue supermart', 'grofers', 'supermarket', 'super market', 'grocer\\w*', 'big bazaar', 'reliance fresh', 'reliance smart', 'more retail', 'nilgiris', 'licious', 'freshtohome', 'jiomart', 'provision', 'kirana', 'vegetables', 'milk', 'aavin'])],
    ['Food & Dining', kw(['zomato', 'swiggy', 'restaurant', 'cafe', 'coffee', 'domino\\w*', 'pizza', 'kfc', 'mcdonald\\w*', 'burger', 'starbucks', 'biryani', 'eatclub', 'bakery', 'bakers', 'sweets', 'tea', 'dine', 'dining', 'food\\w*', 'kitchen', 'mess', 'juice', 'saravana bhavan', 'a2b', 'adyar ananda', 'hotel'])],
    ['Fuel', kw(['petrol\\w*', 'diesel', 'fuel\\w*', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'indianoil', 'bharat petroleum', 'hindustan petroleum', 'shell', 'hp pay', 'filling station', 'fuels'])],
    ['Travel', kw(['makemytrip', 'mmt', 'goibibo', 'cleartrip', 'indigo', 'air india', 'airindia', 'vistara', 'akasa', 'spicejet', 'airbnb', 'oyo', 'booking\\.com', 'irctc', 'yatra', 'agoda', 'ixigo', 'redbus', 'abhibus', 'airlines', 'resort'])],
    ['Transport', kw(['uber', 'ola', 'rapido', 'metro', 'cmrl', 'bmrcl', 'fastag', 'toll', 'parking', 'namma yatri', 'cab\\w*', 'auto', 'mtc'])],
    ['Entertainment', kw(['netflix', 'hotstar', 'jiohotstar', 'prime video', 'spotify', 'youtube', 'bookmyshow', 'pvr', 'inox', 'sonyliv', 'sony liv', 'zee5', 'google play', 'playstore', 'apple\\.com', 'apple services', 'gaming', 'steam', 'audible'])],
    ['Bills & Utilities', kw(['electricity', 'tneb', 'tangedco', 'tnpdcl', 'bescom', 'airtel', 'jio', 'vodafone', 'vi', 'bsnl', 'act fibernet', 'actfibernet', 'broadband', 'recharge', 'dth', 'tata play', 'tataplay', 'gas', 'indane', 'water', 'cmwssb', 'bill ?pay\\w*', 'billdesk', 'bbps', 'postpaid', 'prepaid', 'utility', 'property tax'])],
    ['Health', kw(['pharmac\\w*', 'apollo', 'medplus', 'hospital\\w*', 'clinic\\w*', '1mg', 'pharmeasy', 'netmeds', 'diagnostic\\w*', 'lab', 'labs', 'medical\\w*', 'dental', 'health\\w*', 'dr', 'practo'])],
    ['Education', kw(['school', 'college', 'tuition', 'udemy', 'coursera', 'byju\\w*', 'academy', 'university', 'vidyalaya', 'matric', 'education'])],
    ['Shopping', kw(['amazon', 'amzn', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'croma', 'decathlon', 'ikea', 'lifestyle', 'westside', 'trends', 'tata cliq', 'tatacliq', 'pantaloons', 'max fashion', 'zudio', 'reliance digital', 'firstcry', 'textiles?', 'silks', 'stores?', 'mart', 'retail', 'shopp\\w*', 'mall'])],
    ['Charity & Donations', kw(['charity', 'charitable', 'donation\\w*', 'donate', 'zakat', 'sadaqah', 'orphanage', 'relief fund', 'welfare', 'masjid', 'temple', 'church', 'giveindia', 'ketto', 'milaap'])],
    ['Rent & Housing', kw(['rent', 'nobroker', 'maintenance', 'society', 'apartment', 'housing'])],
    ['Cash withdrawal', kw(['atm', 'cash withdrawal', 'cash wdl', 'nfs', 'withdrawn'])],
    ['Fees & Charges', kw(['charges?', 'fee', 'fees', 'gst', 'penalty', 'annual fee', 'interest', 'late payment', 'finance charge', 'markup'])]
  ];
  var CREDIT_RULES = [
    ['Refunds & Cashback', kw(['refund\\w*', 'reversal', 'reversed', 'cashback', 'chargeback'])],
    ['Salary & Income', kw(['salary', 'payroll', 'sal', 'autodesk', 'relx', 'elsevier', 'dividend', 'interest', 'int\\.?pd'])]
  ];

  var RE_AMT = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  var RE_OTP = /\b(otp|one[- ]time password|verification code|do not share|don't share|cvv)\b/i;
  var RE_DEBIT = /\b(debited|spent|debit|withdrawn|paid|deducted|purchase|sent|charged)\b/i;
  var RE_CREDIT = /\b(credited|received|deposited|refunded|refund|reversed|credit of)\b/i;
  var RE_FUTURE = /\b(will be (auto[- ]?)?(debited|deducted|charged|presented)|is due|are due|due (on|by|date|dt|amt|amount)|total (amt |amount )?due|min(imum)?\.? (amt |amount )?due|overdue|past due|statement|upcoming|scheduled (for|on)|pay by|payment reminder|reminder|low balance|below (the )?(minimum|min)|insufficient (funds|balance)|bounced|dishonou?red|returned unpaid|could not be processed|declined|failed|unsuccessful|not successful|maintain (sufficient )?balance|e-?mandate|standing instruction (set|registered)|autopay (is )?(set|registered|activated))\b/i;
  var RE_DONE_AUTO = /\b(debited|deducted|successfully (processed|debited)|has been processed)\b/i;
  var RE_PROMO = /\b(pre-?approved|offer|loan up to|apply now|upgrade|win |voucher|eligible|congratulations|limited period|cashback up to|t&c|tnc|subscribe|download the app|kyc)\b/i;
  var RE_REQUEST = /\b(has requested|requested money|collect request|request(ed)? (of|for) (rs|inr))\b/i;
  var RE_ACCT_REF = /(?:a\/c|acct?\.?|account|card)(?:\s*(?:no\.?|number|ending(?:\s+(?:with|in))?))?[\s:.#-]*(?:[xX*]+|\.{2,})\s*-?(\d{3,6})\b/i;

  function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

  function detectBank(sender, body) {
    var i;
    for (i = 0; i < BANKS.length; i++) if (BANKS[i][1].test(sender)) return BANKS[i][0];
    // body: prefer the bank named last ("... ICICI Bank - Axis Bank" is signed by Axis)
    var best = null, pos = -1;
    for (i = 0; i < BANKS.length; i++) {
      var re = new RegExp(BANKS[i][1].source, 'gi'), m;
      while ((m = re.exec(body))) { if (m.index > pos) { pos = m.index; best = BANKS[i][0]; } }
    }
    return best;
  }

  function findAmount(body) {
    RE_AMT.lastIndex = 0;
    var m, first = null;
    while ((m = RE_AMT.exec(body))) {
      var before = body.slice(Math.max(0, m.index - 28), m.index);
      if (/(bal|balance|limit|lmt|outstanding|due)[^a-z]*$/i.test(before)) continue;
      var v = num(m[1]);
      if (!isNaN(v) && v > 0) { first = v; break; }
    }
    return first;
  }

  function findBalance(body) {
    var m = /(?:avl|avbl|avail(?:able)?)\.?\s*(?:bal(?:ance)?|limit|lmt)[^0-9]{0,16}([\d,]+(?:\.\d{1,2})?)/i.exec(body);
    return m ? num(m[1]) : null;
  }

  function direction(body) {
    var d = RE_DEBIT.exec(body), c = RE_CREDIT.exec(body);
    if (d && c) return d.index <= c.index ? 'debit' : 'credit';
    if (d) return 'debit';
    if (c) return 'credit';
    return null;
  }

  function accountInfo(body) {
    var isDebitCard = /debit card/i.test(body);
    // "Card XX1234", "Card ending 1234", "Credit Card Account 4xxx1234"
    var cardM = /(?:credit\s+card|bank\s+card|card)(?:\s+a\/?c(?:count)?)?(?:\s*(?:no\.?|number|ending(?:\s+(?:with|in))?))?[\s:.#-]*(?:\d{0,6}[xX*]+|\.{2,})?\s*-?(\d{4})\b/i.exec(body);
    var acctM = /(?:a\/c|acct?\.?|account)(?:\s*(?:no\.?|number|ending(?:\s+(?:with|in))?))?[\s:.#-]*(?:[xX*]+|\.{2,})?\s*-?(\d{3,6})\b/i.exec(body);
    // A bank account debited to pay a card bill ("Acct XX687 debited ...; Credit Card XX1234 credited") belongs to the bank account
    var cardAt = body.search(/credit\s+card|bank\s+card|\bcard\b/i);
    var acctFirst = !!acctM && (cardAt < 0 || acctM.index < cardAt) && !/avl\.? ?(limit|lmt)|available (credit )?limit|spent (on|using|via)/i.test(body);
    var looksCard = !acctFirst && (/credit card|avl\.? ?(limit|lmt)|available (credit )?limit|bank card|card no/i.test(body) || (!!cardM && !acctM));
    if (looksCard && !isDebitCard) return { type: 'credit_card', last4: cardM ? cardM[1] : '' };
    if (acctM) return { type: 'savings', last4: acctM[1] };
    if (isDebitCard) return { type: 'savings', last4: cardM ? cardM[1] : '' };
    return { type: 'unknown', last4: '' };
  }

  function cleanMerchant(s) {
    if (!s) return '';
    s = s.replace(/\s+/g, ' ').replace(/^[\s:;,.*\/-]+|[\s:;,.*\/-]+$/g, '');
    s = s.replace(/^(ACH[- ]?DR|NACH[- ]?DR|ACH[- ]?D|UPI|NEFT|IMPS|RTGS|NACH|ACH|ECS|MMT|BIL|INFT|INF|VPS|IPS|POS)[\s*\/:-]+/i, '');
    s = s.replace(/[\s*\/_-]+\d{4,}\s*$/, '').replace(/[\s\/-]*(\d{9,})\s*$/, '');   // trailing reference numbers
    s = s.replace(/\s+(pvt|private)\.?\s+(ltd|limited)\.?$/i, '').replace(/\s+(ltd|limited)\.?$/i, '');
    s = s.replace(/^[\s:;,.*\/-]+|[\s:;,.*\/-]+$/g, '');
    if (s.length > 40) s = s.slice(0, 40).trim();
    if (/^[\d\s.-]*$/.test(s)) return '';
    if (/@/.test(s)) return s.toLowerCase();              // UPI ID
    return s.toLowerCase().replace(/(^|[\s.&'\/-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function findMerchant(body, dir) {
    var lines = body.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean), m, i;
    // Axis multi-line layout: line with a date/time, the next line is the narration
    if (lines.length >= 4) {
      for (i = 1; i < lines.length - 1; i++) {
        if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(lines[i])) {
          var nar = lines[i + 1];
          if (/^(avl|not you|sms|call|bal)/i.test(nar)) break;
          if (/^UPI\//i.test(nar)) {
            var p = nar.split('/');
            return cleanMerchant(p[3] || p[2] || '');
          }
          return cleanMerchant(nar.replace(/\s*-\s*Axis Bank\s*$/i, ''));
        }
      }
    }
    var flat = body.replace(/\s+/g, ' ');
    if ((m = /UPI\/P2[AM]\/\d+\/([^\/\n]+)/i.exec(body))) return cleanMerchant(m[1]);
    if ((m = /;\s*([^;.]{2,45}?)\s+credited\b/i.exec(flat))) return cleanMerchant(m[1]);              // ICICI UPI debit
    if ((m = /\bInfo[:\s-]*([A-Za-z0-9*\/ ._&-]{2,45}?)(?=\.\s|\.$|\s+Avl|\s+Avail|\s+The |$)/.exec(flat))) return cleanMerchant(m[1]);
    if ((m = /\bon\s+\d{1,2}[-\/ ][A-Za-z0-9]{2,3}[-\/ ]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s+(?:on|at)\s+(.{2,45}?)(?=\.\s|\.$|\s+Avl|\s+Avail|,|$)/i.exec(flat))) return cleanMerchant(m[1]);
    if (dir === 'credit' && (m = /\bfrom\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,40}?)(?=\.\s|\.$|\s+UPI|\s+on\b|\s+Ref|\s+via|\s*-\s*ICICI|,|$)/.exec(flat))) return cleanMerchant(m[1]);
    if ((m = /\b(?:at|towards|for)\s+([A-Z0-9][A-Za-z0-9 .&'*@_-]{1,40}?)(?=\.\s|\.$|\s+on\b|\s+Avl|\s+Avail|\s+Ref|\s+UPI|\s+via|\s+AutoPay|\s+using|,|$)/.exec(flat))) return cleanMerchant(m[1]);
    if (dir === 'debit' && (m = /\b(?:to|trf to|transfer to)\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,40}?)(?=\.\s|\.$|\s+on\b|\s+Ref|\s+UPI|\s+via|,|$)/.exec(flat))) {
      if (!/^(a\/c|acct|account|your|the)\b/i.test(m[1])) return cleanMerchant(m[1]);
    }
    if ((m = /\bVPA\s+([a-z0-9._-]+@[a-z0-9]+)/i.exec(flat))) return cleanMerchant(m[1]);
    return '';
  }

  function findMode(body, acct) {
    if (/(?:\b|Info)(ACH|NACH|ECS)\b|\b(auto[- ]?pay|auto[- ]?debit|e-?mandate|standing instruction|SI txn|mandate)\b/i.test(body)) return 'Auto-debit';
    if (/\bUPI\b|VPA/i.test(body)) return 'UPI';
    if (/\bATM\b|cash withdrawal|cash wdl/i.test(body)) return 'ATM';
    if (/\bNEFT\b/i.test(body)) return 'NEFT';
    if (/\bIMPS\b|MMT\//i.test(body)) return 'IMPS';
    if (/\bRTGS\b/i.test(body)) return 'RTGS';
    if (/\b(cheque|chq)\b/i.test(body)) return 'Cheque';
    if (acct.type === 'credit_card' || /\bcard\b/i.test(body)) return 'Card';
    return 'Other';
  }

  function categorise(merchant, body, dir, mode, acct, userRules) {
    var key = merchantKey(merchant);
    if (userRules && key && userRules[key]) return userRules[key];
    var hay = merchant || '', i;
    if (dir === 'credit') {
      if (acct.type === 'credit_card' && /payment/i.test(body) && !/refund|revers/i.test(body)) return 'Card bill payment';
      for (i = 0; i < CREDIT_RULES.length; i++) if (CREDIT_RULES[i][1].test(hay + ' ' + narration(body))) return CREDIT_RULES[i][0];
      if (acct.type === 'credit_card') return 'Refunds & Cashback';
      return 'Uncategorised';
    }
    if (mode === 'ATM') return 'Cash withdrawal';
    for (i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i][1].test(hay)) return CAT_RULES[i][0];
    // fall back to the narration part of the SMS (not the bank boilerplate)
    var nar = narration(body);
    for (i = 0; i < CAT_RULES.length; i++) {
      if (CAT_RULES[i][0] === 'Fees & Charges' || CAT_RULES[i][0] === 'Card bill payment') continue;
      if (CAT_RULES[i][1].test(nar)) return CAT_RULES[i][0];
    }
    return 'Uncategorised';
  }

  // strip boilerplate so "call ... for dispute / SMS BLOCK" text never drives the category
  function narration(body) {
    return body.replace(/\s+/g, ' ')
      .replace(/(not you|if not you|if not done by you|call |sms block|to dispute|for dispute|avl|available).*$/i, '')
      .replace(/\b(ICICI|Axis|HDFC|SBI|Kotak)\s+Bank\b/gi, '')
      .replace(/\b(credit|debit|bank)\s+card\b/gi, '');
  }

  function merchantKey(m) { return (m || '').toLowerCase().replace(/[^a-z0-9@]+/g, ' ').trim(); }

  function parseDate(s) {
    var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var m = /(\d{1,2})[-\/ .]([A-Za-z]{3})[A-Za-z]*[-\/ .,]*(\d{2,4})/.exec(s), d, mo, y;
    if (m && MON[m[2].toLowerCase()] != null) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; }
    else if ((m = /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s))) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; }
    else return null;
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 0 || mo > 11) return null;
    return new Date(y, mo, d, 9, 0, 0).getTime();
  }

  function reminderKind(body) {
    if (/\b(declined|failed|unsuccessful|not successful|could not be processed|bounced|dishonou?red|returned unpaid)\b/i.test(body)) return 'failed';
    if (/\b(will be (auto[- ]?)?(debited|deducted|charged|presented)|upcoming|scheduled (for|on))\b/i.test(body)) return 'upcoming_debit';
    if (/\b(low balance|insufficient|below (the )?(minimum|min))\b/i.test(body)) return 'low_balance';
    if (/\b(overdue|past due)\b/i.test(body)) return 'overdue';
    if (/\b(is due|are due|due (on|by|date|dt|amt|amount)|total (amt |amount )?due|min(imum)?\.? (amt |amount )?due|pay by|payment reminder)\b/i.test(body)) return 'bill_due';
    if (/\bstatement\b/i.test(body)) return 'statement';
    if (/\b(e-?mandate|standing instruction|autopay)\b/i.test(body)) return 'mandate';
    return 'other';
  }

  /** sms: {id, a: sender, b: body, d: epoch ms}. Returns {kind:'txn'|'reminder'|'ignore', ...}. */
  function parseSms(sms, userRules) {
    var body = String(sms.b || ''), sender = String(sms.a || '');
    var flat = body.replace(/\s+/g, ' ').trim();
    if (!flat) return { kind: 'ignore', why: 'empty' };
    if (RE_OTP.test(flat)) return { kind: 'ignore', why: 'otp' };
    var bank = detectBank(sender, flat);
    var hasRef = RE_ACCT_REF.test(flat);
    if (!bank && !hasRef) return { kind: 'ignore', why: 'not financial' };
    if (RE_REQUEST.test(flat)) return { kind: 'ignore', why: 'collect request' };

    var amount = findAmount(flat);
    var dir = direction(flat);
    var future = RE_FUTURE.test(flat);
    var failed = /\b(declined|failed|unsuccessful|not successful|could not be processed|bounced|dishonou?red|returned unpaid)\b/i.test(flat);
    var isTxn = amount != null && dir && (hasRef || bank) && !failed;
    if (isTxn && future) {
      // "will be debited" / "is due" style = reminder, unless it also clearly reports a completed movement
      var completed = RE_DONE_AUTO.test(flat) && !/\bwill be\b/i.test(flat) && !/\b(is|are) due|due (on|by|date)|statement|reminder|low balance\b/i.test(flat);
      if (!completed) isTxn = false;
    }
    if (isTxn && RE_PROMO.test(flat) && !hasRef) isTxn = false;

    if (isTxn) {
      var acct = accountInfo(flat);
      var mode = findMode(flat, acct);
      var merchant = findMerchant(body, dir);
      var category = categorise(merchant, flat, dir, mode, acct, userRules);
      var bankName = bank || 'Unknown';
      var t = {
        id: 'sms:' + sms.id, ts: sms.d, amount: amount, dir: dir,
        bank: bankName, acctType: acct.type, last4: acct.last4,
        acctKey: bankName + '|' + acct.type + '|' + acct.last4,
        merchant: merchant, category: category, mode: mode, auto: mode === 'Auto-debit',
        balance: findBalance(flat), sender: sender, raw: body, edited: false, note: ''
      };
      if (!merchant) t.merchant = category === 'Cash withdrawal' ? 'ATM withdrawal' : category === 'Card bill payment' ? 'Card payment' : '';
      t.needsReview = category === 'Uncategorised' || acct.type === 'unknown';
      return { kind: 'txn', txn: t };
    }

    if (bank && (future || failed) && !(RE_PROMO.test(flat) && !hasRef && !/\bdue\b/i.test(flat))) {
      var kind = reminderKind(flat);
      var dm = /(?:due (?:on|by|date|dt)|pay by|debited on|deducted on|presented on|on or before|scheduled (?:for|on))[\s:-]*(?:is\s+)?([0-9]{1,2}[-\/ .][A-Za-z0-9]{2,9}[-\/ .,]*[0-9]{2,4})/i.exec(flat);
      var acct2 = accountInfo(flat);
      var amt2 = null, am = /(?:total (?:amt |amount )?due|bill of|amount of|total of|payment of|emi of)[^0-9]{0,12}([\d,]+(?:\.\d{1,2})?)/i.exec(flat);
      if (am) amt2 = num(am[1]);
      if (amt2 == null) { RE_AMT.lastIndex = 0; var fm = RE_AMT.exec(flat); if (fm) amt2 = num(fm[1]); }
      return {
        kind: 'reminder',
        reminder: {
          id: 'sms:' + sms.id, ts: sms.d, bank: bank, kind: kind, amount: amt2,
          due: dm ? parseDate(dm[1]) : null, acctType: acct2.type, last4: acct2.last4,
          text: body, sender: sender, done: false
        }
      };
    }
    return { kind: 'ignore', why: 'no match' };
  }

  // ---------- bills / receipts (text read from a photo) ----------
  function nums(line) {
    var out = [], re = /(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g, m;
    var clean = line.replace(/(\d)\s*[.,]\s*(\d{2})(?!\d)/g, '$1.$2');     // "1,250. 00" / "1250 .00"
    while ((m = re.exec(clean))) {
      var raw = m[1].replace(/,/g, ''), v = parseFloat(raw);
      if (raw.split('.')[0].length > 7 || !(v > 0)) continue;              // phone numbers, ids
      out.push({ v: v, dec: /\.\d{1,2}$/.test(raw) });
    }
    return out;
  }
  function parseReceipt(text, userRules) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var EXC = /sub\s*-?\s*total|total\s*(qty|quantity|items?|savings?|saved|discount|tax|gst|cgst|sgst|pcs|pieces|nos?)\b|taxable|you (have )?saved|\bqty\b.*\btotal\b/i;
    var NOISE = /gstin|gst\s*no|fssai|phone|ph\s*[:.]|tel\s*[:.]|mob|invoice\s*no|bill\s*no|order\s*(no|id)|\bdate\b|\btime\b|pin\s*code|\btable\b|\btoken\b|upi\s*ref|txn\s*id|\bcard\s*no/i;
    var TIERS = [
      /grand\s*total|net\s*(amount|payable|amt|total)|amount\s*(payable|paid|due)|total\s*(amount|payable|due|amt|inr|rs)|bill\s*(amount|total|amt)|round(ed)?\s*(off\s*)?total|\bto\s*pay\b|total\s*to\s*pay|you\s*pa(y|id)|\bpaid\b/i,
      /\btotal\b/i,
      /\bamount\b|\bcash\b|\bupi\b|\bcard\b/i
    ];
    var amount = null, i, t;
    for (t = 0; t < TIERS.length && amount == null; t++) {
      var best = null;
      for (i = 0; i < lines.length; i++) {
        if (!TIERS[t].test(lines[i]) || EXC.test(lines[i]) || (t > 0 && NOISE.test(lines[i]))) continue;
        var n = nums(lines[i].replace(/\d+(\.\d+)?\s*%/g, ''));
        if (!n.length && i + 1 < lines.length && !/[a-z]{4,}/i.test(lines[i + 1])) n = nums(lines[i + 1]);
        if (!n.length) continue;
        var v = n[n.length - 1].v;
        if (best == null || (t === 0 ? true : v > best)) best = v;       // tier 0: last match wins; others: largest
      }
      if (best != null) amount = best;
    }
    if (amount == null) {
      lines.forEach(function (l) { if (NOISE.test(l) || EXC.test(l)) return; nums(l).forEach(function (x) { if (x.dec && x.v < 1e6 && (amount == null || x.v > amount)) amount = x.v; }); });
    }
    var merchant = '';
    var SKIP = /tax\s*invoice|^invoice|^bill\b|receipt|gstin|cash\s*memo|welcome|original|duplicate|customer\s*copy|phone|^tel|^ph\b|date|www\.|@|thank|^no[.:]|^\W*$/i;
    for (i = 0; i < Math.min(lines.length, 7); i++) {
      var L = lines[i], letters = (L.match(/[A-Za-z]/g) || []).length;
      if (letters >= 3 && letters / L.length > 0.55 && !SKIP.test(L)) { merchant = cleanMerchant(L.replace(/[^A-Za-z0-9 .&'-]/g, ' ')); if (merchant) break; }
    }
    var ts = null, now = Date.now();
    for (i = 0; i < lines.length && !ts; i++) {
      var dm = /(\d{1,2}[-\/.](?:\d{1,2}|[A-Za-z]{3,9})[-\/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4})/.exec(lines[i]);
      if (dm) { var d = parseDate(dm[1]); if (d && d <= now + 86400000 && d > now - 400 * 86400000) ts = d; }
    }
    var mode = /\bupi\b|gpay|phonepe|paytm/i.test(text) ? 'UPI' : /\b(credit|debit)\s*card\b|\bcard\b.*\b(x{2,}|\*{2,})\d{4}|\bvisa\b|mastercard|rupay/i.test(text) ? 'Card' : /\bcash\b/i.test(text) ? 'Cash' : '';
    var category = 'Uncategorised', key = merchantKey(merchant), head = lines.slice(0, 6).join(' '), SKIPCAT = { 'Fees & Charges': 1, 'Card bill payment': 1, 'Cash withdrawal': 1, 'Bills & Utilities': 1, 'EMI & Loans': 1, 'Investments': 1 };
    if (userRules && key && userRules[key]) category = userRules[key];
    else {
      for (i = 0; i < CAT_RULES.length && category === 'Uncategorised'; i++) if (!SKIPCAT[CAT_RULES[i][0]] && CAT_RULES[i][1].test(merchant)) category = CAT_RULES[i][0];
      for (i = 0; i < CAT_RULES.length && category === 'Uncategorised'; i++) if (!SKIPCAT[CAT_RULES[i][0]] && CAT_RULES[i][1].test(head)) category = CAT_RULES[i][0];
      if (category === 'Uncategorised') {
        if (/petrol|diesel|\bltrs?\b|litres?|nozzle/i.test(text)) category = 'Fuel';
        else if (/pharmac|medical|chemist|\bmrp\b.*\bbatch\b|\bbatch\b|\btab(let)?s?\b/i.test(text)) category = 'Health';
        else if (/restaurant|biryani|dine|\bkot\b|parcel|swiggy|zomato/i.test(text)) category = 'Food & Dining';
      }
    }
    return { amount: amount, merchant: merchant, ts: ts, mode: mode, category: category };
  }

  // Words that mean "the app already knows what this spend is" (used to decide whether to ask in a notification)
  var KNOWN_WORDS = (function () {
    var out = [], skip = { 'Card bill payment': 1, 'Fees & Charges': 1, 'Cash withdrawal': 1 };
    CAT_RULES.forEach(function (r) {
      if (skip[r[0]]) return;
      var src = r[1].source, a = src.indexOf('(?:', 5), b = src.lastIndexOf(')(?!');
      src.slice(a + 3, b).split('|').forEach(function (w) { w = w.replace(/\\w\*|\\\.|\?/g, '').trim(); if (/^[a-z0-9 ]{5,}$/.test(w)) out.push(w); });
    });
    return out;
  })();
  // A few plain words a person might type when asked "what was this for?"
  var REPLY_WORDS = [
    ['Food & Dining', /\b(food|lunch|dinner|breakfast|snacks?|tiffin|eating|restaurant|coffee|chai|tea|biryani|dining)\b/i],
    ['Groceries', /\b(grocer\w*|vegetables?|veg|fruits?|milk|provisions?|kirana|supermarket|meat|chicken|mutton|fish|eggs?)\b/i],
    ['Transport', /\b(auto|cab|taxi|bus|train|metro|uber|ola|rapido|parking|toll|transport)\b/i],
    ['Fuel', /\b(petrol|diesel|fuel)\b/i],
    ['Health', /\b(medicines?|doctor|hospital|pharmacy|medical|clinic|health|dentist|tablets?)\b/i],
    ['Shopping', /\b(shopping|clothes|dress|shoes|gift|amazon|flipkart|toys?)\b/i],
    ['Bills & Utilities', /\b(bill|electricity|eb|recharge|internet|wifi|broadband|gas|water|phone)\b/i],
    ['Rent & Housing', /\b(rent|maintenance|repair|plumber|electrician|carpenter)\b/i],
    ['Education', /\b(school|fees|tuition|books?|college|class|course)\b/i],
    ['Entertainment', /\b(movie|cinema|netflix|game|outing|fun)\b/i],
    ['Travel', /\b(trip|travel|flight|hotel|ticket|tour)\b/i],
    ['Charity & Donations', /\b(charity|donation|zakat|sadaqah|sadaqa)\b/i],
    ['Family & Personal', /\b(family|maid|salon|haircut|personal|pocket money|home)\b/i],
    ['Business', /\b(business|shop|stock|supplier|office|work)\b/i],
    ['Investments', /\b(invest\w*|sip|gold|shares?|stocks|mutual)\b/i],
    ['EMI & Loans', /\b(emi|loan)\b/i],
    ['Insurance', /\b(insurance|premium|lic)\b/i],
    ['Self transfer', /\b(self|own account|my account)\b/i],
    ['Transfers', /\b(lent|loan to|gave|transfer|friend|borrowed|returned)\b/i]
  ];
  function guessCategory(text) {
    var t = String(text || '').toLowerCase().trim(), i;
    if (!t) return '';
    for (i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i] !== 'Other' && CATEGORIES[i] !== 'Uncategorised' && t === CATEGORIES[i].toLowerCase()) return CATEGORIES[i];
    for (i = 0; i < REPLY_WORDS.length; i++) if (REPLY_WORDS[i][1].test(t)) return REPLY_WORDS[i][0];
    for (i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i][0] !== 'Fees & Charges' && CAT_RULES[i][1].test(t)) return CAT_RULES[i][0];
    return '';
  }

  var api = {
    parseSms: parseSms, parseReceipt: parseReceipt, guessCategory: guessCategory, KNOWN_WORDS: KNOWN_WORDS, categorise: categorise, merchantKey: merchantKey, parseDate: parseDate,
    CATEGORIES: CATEGORIES, EXCLUDED: EXCLUDED, cleanMerchant: cleanMerchant
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SmsParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
