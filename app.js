// ── CONFIG ────────────────────────────────────────────────────────────────────
const CFG_KEY = '51main_config';
const QUEUE_KEY = '51main_queue';
const BILLS_CACHE_KEY = '51main_bills';

function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}
function saveCfg(obj) { localStorage.setItem(CFG_KEY, JSON.stringify(obj)); }

// ── CANONICAL CATEGORIES (from your decisions) ────────────────────────────────
const BILL_CATEGORIES = [
  'Charity','Communication','Contingency Fund - Emergency','Contingency Fund - Rainy Day',
  'Financial Service','Fuel & Gas','Groceries','Grocery+','Housing','Investments',
  'Loans/Credit','Paramedicine','Savings','Sinking Fund','Technology','Transportation',
  'Utilities'
];

const EXPENSE_CATEGORIES = [
  'Activities, Sports','Alcohol','Appliances','Charity','Cleaning','Communication',
  'Contingency Fund - Emergency','Contingency Fund - Rainy Day','Cosmetics',
  'Eating Outside','Electronics','Entertainment, Board Games','Fashion',
  'Financial Service','Fines','Fuel & Gas','Furniture','Gardening','Gifts',
  'Groceries','Grocery+','Home Improvement: Paint, Bath, Electrical, Decor, Storage Total',
  'Housing','Investments','Kitchen','Learning','Life Insurance','Loans/Credit',
  'Medicine & Medical Equipment','Party Items','Paramedicine','Repair','Salons',
  'Savings','Services','Sinking Fund','Stationary','Supplies Only','Technology',
  'Toiletries','Tools','Transportation','Unaccounted','Utilities',
  'Vacation: Activity/Entertainment','Vacation: Communication','Vacation: Eating Outside',
  'Vacation: Gifts','Vacation: Grocery','Vacation: Housing','Vacation: Purchases',
  'Vacation: Stationary/Souvenirs','Vacation: Transportation','Windfall'
];

const INCOME_CATEGORIES = ['Salary','Refund','Sale (Revenue)','Windfall'];

const ACCOUNTS = [
  'Chequing','Savings','Sinking Fund Account','Wallet - Lavi','Wallet - Warren',
  'Credit Card - Visa - CIBC','Credit Card - Visa - TD',
  'Credit Card - Mastercard - Tangerine','Credit Card - Mastercard - PC',
  'Credit Card - Mastercard - CanTire','Credit Card - ppMastercard - EQ',
  'Credit Card - ppMastercard - WealthSimple','Home','Mom','Gift Card',
  'Backup','QuickSilver'
];

// Vendors known to be in bills tracker (auto-expected detection)
// This list is seeded from your Bills Tracker; after setup it's fetched live from Sheets
let KNOWN_BILL_VENDORS = [
  'fidelity mutal funds','equitable life insurance','green p','city of brampton',
  'groceries stores','petro canada','canadian tire gas bar','sts peter and paul church',
  'grassroots charity','apple storage','franklin templeton','caa','first national',
  'industrial alliance','rogers','bell','enbridge','brampton hydro','peel region water',
  'rogers communications','telus'
];

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentScreen = 'bills';
let billsViewMonth = new Date();
let billsViewMonth_str = '';
let receiptsAttached = []; // {name, dataUrl, type}
let expectedState = 'auto'; // 'expected' | 'unexpected' | 'override' | 'auto'
let autoDetectedExpected = null;
let summaryTab = 'category';
let cachedBills = [];
let cachedExpenses = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  populateSelects();
  loadSettings();
  updateHeaderMonth();
  renderBillsMonth();
  renderSummary();
  loadCachedData();
});

function initDate() {
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  document.getElementById('f-date').value =
    `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
}

function populateSelects() {
  // Categories
  const catSel = document.getElementById('f-category');
  EXPENSE_CATEGORIES.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  // Accounts
  ['f-acct-from','f-acct-to'].forEach(id => {
    const sel = document.getElementById(id);
    ACCOUNTS.forEach(a => {
      const o = document.createElement('option'); o.value = a; o.textContent = a;
      sel.appendChild(o);
    });
  });
}

function loadSettings() {
  const cfg = getCfg();
  if (cfg.scriptUrl) document.getElementById('cfg-url').value = cfg.scriptUrl;
  if (cfg.defaultBehalf) {
    document.getElementById('cfg-default-behalf').value = cfg.defaultBehalf;
    document.getElementById('f-behalf').value = cfg.defaultBehalf;
  }
}

function saveSettings() {
  const cfg = {
    scriptUrl: document.getElementById('cfg-url').value.trim(),
    defaultBehalf: document.getElementById('cfg-default-behalf').value.trim()
  };
  saveCfg(cfg);
  if (cfg.defaultBehalf) document.getElementById('f-behalf').value = cfg.defaultBehalf;
  showToast('Settings saved', 'success');
  flushQueue();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  currentScreen = name;
  if (name === 'summary') renderSummary();
  if (name === 'bills') renderBillsMonth();
}

function onTypeChange() {
  const t = document.getElementById('f-type').value;
  document.getElementById('expense-fields').style.display =
    t === 'Expense (Debit)' ? 'block' : 'none';
}

// ── MONTH NAVIGATION ──────────────────────────────────────────────────────────
function changeMonth(dir) {
  billsViewMonth = new Date(billsViewMonth.getFullYear(), billsViewMonth.getMonth() + dir, 1);
  renderBillsMonth();
}

function updateHeaderMonth() {
  const now = new Date();
  document.getElementById('header-month').textContent =
    now.toLocaleDateString('en-CA', {month:'long', year:'numeric'}).toUpperCase();
}

// ── BILLS SCREEN ──────────────────────────────────────────────────────────────
function renderBillsMonth() {
  const yr = billsViewMonth.getFullYear();
  const mo = billsViewMonth.getMonth();
  const label = billsViewMonth.toLocaleDateString('en-CA', {month:'long', year:'numeric'});
  document.getElementById('bills-month-label').textContent = label;

  const monthBills = cachedBills.filter(b => {
    if (!b.monthYear) return false;
    const d = new Date(b.monthYear);
    return d.getFullYear() === yr && d.getMonth() === mo;
  });

  const today = new Date();
  let totalDue = 0, totalPaid = 0;
  const unpaid = [], paid = [];

  monthBills.forEach(b => {
    const amt = parseFloat(b.amount) || 0;
    const paidAmt = parseFloat(b.paidAmount) || 0;
    totalDue += amt;
    if (b.paidDate) {
      totalPaid += paidAmt || amt;
      paid.push(b);
    } else {
      unpaid.push(b);
    }
  });

  const stillOwe = Math.max(0, totalDue - totalPaid);
  document.getElementById('s-total-due').textContent = fmt(totalDue);
  document.getElementById('s-total-paid').textContent = fmt(totalPaid);
  document.getElementById('s-still-owe').textContent = fmt(stillOwe);

  const list = document.getElementById('bills-list');

  if (monthBills.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px;">
      No bills loaded for ${label}.<br><br>
      <span style="font-size:10px;">Connect your Google Sheet in Settings → Sync to load bills.</span>
    </div>`;
    return;
  }

  let html = '';

  if (unpaid.length > 0) {
    html += `<div class="bills-section">
      <div class="bills-section-hdr">Unpaid · ${unpaid.length} bills · ${fmt(unpaid.reduce((s,b)=>s+(parseFloat(b.amount)||0),0))} remaining</div>`;
    unpaid.forEach(b => { html += billRowHTML(b, today); });
    html += '</div>';
  }

  if (paid.length > 0) {
    html += `<div class="bills-section">
      <div class="bills-section-hdr">Paid · ${paid.length} bills</div>`;
    paid.forEach(b => { html += billRowHTML(b, today); });
    html += '</div>';
  }

  list.innerHTML = html;
}

function billRowHTML(b, today) {
  const icon = categoryIcon(b.category);
  const amt = parseFloat(b.amount) || 0;
  const paidAmt = parseFloat(b.paidAmount) || amt;
  const isPaid = !!b.paidDate;
  const dueDay = b.issueDate || b.dueDate || '';

  let statusClass = 'status-unpaid', statusLabel = 'UNPAID';
  if (isPaid) { statusClass = 'status-paid'; statusLabel = 'PAID'; }

  const amtDisplay = isPaid && paidAmt !== amt
    ? `<div style="font-size:10px;color:var(--text3);text-decoration:line-through;">${fmt(amt)}</div><div class="bill-amount" style="color:var(--green)">${fmt(paidAmt)}</div>`
    : `<div class="bill-amount" style="color:${isPaid?'var(--green)':'var(--orange)'};">${fmt(amt)}</div>`;

  return `<div class="bill-row">
    <div class="bill-icon" style="background:${categoryBg(b.category)}">${icon}</div>
    <div class="bill-info">
      <div class="bill-name">${b.vendorName || b.category}</div>
      <div class="bill-meta">${b.category}${b.subCategory?' · '+b.subCategory:''}${dueDay?' · Due '+dueDay:''}</div>
      ${b.paymentType ? `<div class="bill-meta">${b.paymentType}</div>` : ''}
    </div>
    <div class="bill-right">
      ${amtDisplay}
      <span class="bill-status ${statusClass}">${statusLabel}</span>
      ${isPaid && b.paidDate ? `<div style="font-size:9px;color:var(--text3);margin-top:2px;">${b.paidDate}</div>` : ''}
    </div>
  </div>`;
}

// ── RECEIPT HANDLING ──────────────────────────────────────────────────────────
function handleReceipts(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      receiptsAttached.push({ name: file.name, dataUrl: e.target.result, type: file.type });
      renderReceiptPreviews();
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function renderReceiptPreviews() {
  const preview = document.getElementById('receipts-preview');
  preview.innerHTML = receiptsAttached.map((r, i) => {
    if (r.type.startsWith('image/')) {
      return `<div class="receipt-thumb">
        <img src="${r.dataUrl}" alt="${r.name}">
        <button class="receipt-thumb-remove" onclick="removeReceipt(${i})">×</button>
      </div>`;
    } else {
      return `<div class="receipt-file-pill">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span>
        <button onclick="removeReceipt(${i})">×</button>
      </div>`;
    }
  }).join('');
  const zone = document.getElementById('receipt-zone');
  zone.querySelector('.receipt-zone-text').style.display = receiptsAttached.length ? 'none' : 'block';
}

function removeReceipt(idx) {
  receiptsAttached.splice(idx, 1);
  renderReceiptPreviews();
}

// ── EXPECTED AUTO-DETECTION ───────────────────────────────────────────────────
function autoDetectExpected() {
  const vendor = (document.getElementById('f-vendor').value || '').trim().toLowerCase();
  const category = document.getElementById('f-category').value;
  const amount = parseFloat(document.getElementById('f-amount').value) || 0;

  const vendorMatch = vendor && KNOWN_BILL_VENDORS.some(v => vendor.includes(v) || v.includes(vendor));
  const catMatch = BILL_CATEGORIES.includes(category);

  let detected = null;
  let reason = '';

  if (vendorMatch) {
    detected = 'expected';
    reason = `Vendor matches your Bills Tracker`;
  } else if (catMatch && amount > 0) {
    detected = 'expected';
    reason = `Category "${category}" is in your Bills Tracker`;
  } else if (vendor && category) {
    detected = 'unexpected';
    reason = `Vendor not found in Bills Tracker`;
  }

  autoDetectedExpected = detected;

  if (expectedState === 'auto' || expectedState === 'override') {
    if (detected === 'expected') setExpectedUI('expected', reason);
    else if (detected === 'unexpected') setExpectedUI('unexpected', reason);
    else resetExpectedUI();
  }
}

function setExpected(state) {
  expectedState = state;
  if (state === 'expected') setExpectedUI('expected', 'Manual — expected');
  else if (state === 'unexpected') setExpectedUI('unexpected', 'Manual — unexpected');
  else if (state === 'override') {
    autoDetectExpected();
    expectedState = 'override';
  }
}

function setExpectedUI(state, reason) {
  ['expected','unexpected','override'].forEach(s => {
    document.getElementById('exp-'+s).classList.toggle('active', s === state);
  });
  document.getElementById('expected-reason').textContent = reason || '';
}

function resetExpectedUI() {
  ['expected','unexpected','override'].forEach(s => {
    document.getElementById('exp-'+s).classList.remove('active');
  });
  document.getElementById('expected-reason').textContent = 'Enter vendor and category to auto-detect';
}

// ── SUBMIT EXPENSE ────────────────────────────────────────────────────────────
async function submitExpense() {
  const btn = document.getElementById('submit-btn');
  const vendor = document.getElementById('f-vendor').value.trim();
  const amount = document.getElementById('f-amount').value;
  const date = document.getElementById('f-date').value;
  const type = document.getElementById('f-type').value;

  if (!date) { showToast('Date is required', 'error'); return; }
  if (!amount || parseFloat(amount) <= 0) { showToast('Amount is required', 'error'); return; }

  const activeExpBtn = document.querySelector('.exp-btn.active');
  const expFlag = activeExpBtn ? activeExpBtn.textContent.trim() :
    (autoDetectedExpected === 'expected' ? 'Expected' : 'Unexpected');

  const payload = {
    timestamp: new Date().toISOString(),
    date,
    transactionType: type,
    vendor,
    expenseCategory: document.getElementById('f-category').value,
    amountCAD: parseFloat(amount) || 0,
    amountNonCAD: parseFloat(document.getElementById('f-amount-foreign').value) || 0,
    accountFrom: document.getElementById('f-acct-from').value,
    accountTo: document.getElementById('f-acct-to').value,
    expectedFlag: expFlag,
    occasion: document.getElementById('f-occasion').value.trim(),
    onBehalfOf: document.getElementById('f-behalf').value.trim(),
    taxReceipt: document.getElementById('f-tax').value,
    vendorLocation: document.getElementById('f-location').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    receipts: receiptsAttached.map(r => ({ name: r.name, dataUrl: r.dataUrl, type: r.type }))
  };

  btn.disabled = true;
  btn.textContent = 'SUBMITTING...';

  const cfg = getCfg();
  if (cfg.scriptUrl) {
    try {
      await postToScript(cfg.scriptUrl, { action: 'logExpense', data: payload });
      showToast('Entry saved to Google Sheets', 'success');
      resetForm();
    } catch(e) {
      queueEntry(payload);
      showToast('Saved offline — will sync when connected', '');
    }
  } else {
    queueEntry(payload);
    showToast('Saved offline — add Script URL in Settings to sync', '');
    resetForm();
  }

  btn.disabled = false;
  btn.textContent = 'SUBMIT ENTRY';
}

function resetForm() {
  ['f-vendor','f-amount','f-amount-foreign','f-occasion','f-notes','f-location'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-category').value = '';
  document.getElementById('f-type').value = 'Expense (Debit)';
  receiptsAttached = [];
  renderReceiptPreviews();
  resetExpectedUI();
  expectedState = 'auto';
  autoDetectedExpected = null;
  initDate();
  const cfg = getCfg();
  if (cfg.defaultBehalf) document.getElementById('f-behalf').value = cfg.defaultBehalf;
}

// ── OFFLINE QUEUE ─────────────────────────────────────────────────────────────
function queueEntry(payload) {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  q.push(payload);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

async function flushQueue() {
  const cfg = getCfg();
  if (!cfg.scriptUrl) return;
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  if (q.length === 0) return;
  const synced = [];
  for (const entry of q) {
    try {
      await postToScript(cfg.scriptUrl, { action: 'logExpense', data: entry });
      synced.push(entry);
    } catch {}
  }
  if (synced.length > 0) {
    const remaining = q.filter(e => !synced.includes(e));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    showToast(`Synced ${synced.length} offline ${synced.length===1?'entry':'entries'}`, 'success');
  }
}

async function syncNow() {
  const btn = document.getElementById('sync-btn');
  btn.textContent = 'SYNCING';
  btn.classList.add('syncing');
  const cfg = getCfg();
  if (!cfg.scriptUrl) {
    showToast('Add Script URL in Settings first', 'error');
    btn.textContent = 'SYNC'; btn.classList.remove('syncing'); return;
  }
  try {
    await flushQueue();
    const res = await postToScript(cfg.scriptUrl, { action: 'getBills' });
    if (res && res.bills) {
      cachedBills = res.bills;
      localStorage.setItem(BILLS_CACHE_KEY, JSON.stringify(cachedBills));
    }
    if (res && res.expenses) {
      cachedExpenses = res.expenses;
    }
    if (res && res.vendors) {
      KNOWN_BILL_VENDORS = res.vendors.map(v => v.toLowerCase());
    }
    renderBillsMonth();
    renderSummary();
    showToast('Synced successfully', 'success');
  } catch(e) {
    showToast('Sync failed — check connection', 'error');
  }
  btn.textContent = 'SYNC'; btn.classList.remove('syncing');
}

function loadCachedData() {
  const cached = localStorage.getItem(BILLS_CACHE_KEY);
  if (cached) {
    cachedBills = JSON.parse(cached);
    renderBillsMonth();
  }
}

// ── POSTING TO APPS SCRIPT ────────────────────────────────────────────────────
async function postToScript(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// ── SUMMARY SCREEN ────────────────────────────────────────────────────────────
function switchSummaryTab(tab, el) {
  summaryTab = tab;
  document.querySelectorAll('.summary-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderSummary();
}

function renderSummary() {
  const container = document.getElementById('summary-content');
  const expenses = cachedExpenses.filter(e => e.transactionType === 'Expense (Debit)');
  if (expenses.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px;">
      No expense data loaded yet.<br><span style="font-size:10px;">Sync from Google Sheets to see summaries.</span></div>`;
    return;
  }

  if (summaryTab === 'category') renderCategorySummary(container, expenses);
  else if (summaryTab === 'expunexp') renderExpUnexpSummary(container, expenses);
  else renderVendorSummary(container, expenses);
}

function renderCategorySummary(container, expenses) {
  const grouped = {};
  expenses.forEach(e => {
    const cat = e.expenseCategory || 'Unaccounted';
    grouped[cat] = (grouped[cat] || 0) + (parseFloat(e.amountCAD) || 0);
  });
  const sorted = Object.entries(grouped).sort((a,b) => b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;
  const total = sorted.reduce((s,[,v])=>s+v,0);
  const colors = ['#4f8ef7','#34d399','#fb923c','#a78bfa','#2dd4bf','#fbbf24','#f87171','#ec4899'];
  let html = `<div style="font-size:10px;color:var(--text3);margin-bottom:12px;letter-spacing:0.5px;">
    ${sorted.length} categories · ${fmt(total)} total</div>`;
  sorted.forEach(([cat, val], i) => {
    const pct = Math.round(val/max*100);
    const color = colors[i % colors.length];
    html += `<div class="chart-bar-row">
      <div class="chart-bar-label">${cat}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${pct}%;background:${color}">
          <span class="chart-bar-val">${fmt(val)}</span>
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function renderExpUnexpSummary(container, expenses) {
  let expAmt = 0, unexpAmt = 0, expCount = 0, unexpCount = 0;
  expenses.forEach(e => {
    const amt = parseFloat(e.amountCAD) || 0;
    if (e.expectedFlag === 'Expected') { expAmt += amt; expCount++; }
    else { unexpAmt += amt; unexpCount++; }
  });
  const total = expAmt + unexpAmt;
  const expPct = total > 0 ? Math.round(expAmt/total*100) : 0;
  const unexpPct = 100 - expPct;

  container.innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:6px;">
        <span>Expected</span><span>Unexpected</span>
      </div>
      <div style="background:var(--surface2);border-radius:6px;height:24px;overflow:hidden;display:flex;">
        <div style="width:${expPct}%;background:var(--green);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:10px;color:#fff;font-weight:500;">${expPct}%</span>
        </div>
        <div style="flex:1;background:var(--orange);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:10px;color:#fff;font-weight:500;">${unexpPct}%</span>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
      <div class="summary-card">
        <div class="label">EXPECTED</div>
        <div class="value green">${fmt(expAmt)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;">${expCount} transactions</div>
      </div>
      <div class="summary-card">
        <div class="label">UNEXPECTED</div>
        <div class="value orange">${fmt(unexpAmt)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;">${unexpCount} transactions</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--text3);letter-spacing:0.8px;margin-bottom:10px;">UNEXPECTED BREAKDOWN</div>`;

  const unexpected = expenses.filter(e => e.expectedFlag !== 'Expected');
  const byCat = {};
  unexpected.forEach(e => {
    const cat = e.expenseCategory || 'Unaccounted';
    byCat[cat] = (byCat[cat]||0) + (parseFloat(e.amountCAD)||0);
  });
  const sorted = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max = sorted[0]?.[1]||1;
  sorted.forEach(([cat, val]) => {
    const pct = Math.round(val/max*100);
    container.innerHTML += `<div class="chart-bar-row">
      <div class="chart-bar-label">${cat}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${pct}%;background:var(--orange)">
          <span class="chart-bar-val">${fmt(val)}</span>
        </div>
      </div>
    </div>`;
  });
}

function renderVendorSummary(container, expenses) {
  const grouped = {};
  expenses.forEach(e => {
    const v = e.vendor || 'Unknown';
    if (!grouped[v]) grouped[v] = { total: 0, count: 0, category: e.expenseCategory };
    grouped[v].total += parseFloat(e.amountCAD) || 0;
    grouped[v].count++;
  });
  const sorted = Object.entries(grouped).sort((a,b)=>b[1].total-a[1].total).slice(0,25);
  const total = sorted.reduce((s,[,v])=>s+v.total,0);

  let html = `<div style="font-size:10px;color:var(--text3);margin-bottom:12px;letter-spacing:0.5px;">
    Top ${sorted.length} vendors · ${fmt(total)} total</div>`;
  sorted.forEach(([vendor, data]) => {
    html += `<div class="vendor-row">
      <div>
        <div class="vendor-name">${vendor}</div>
        <div class="vendor-meta">${data.category || ''} · ${data.count} txn${data.count!==1?'s':''}</div>
      </div>
      <div class="vendor-amt">${fmt(data.total)}</div>
    </div>`;
  });
  container.innerHTML = html;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + (parseFloat(n)||0).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function categoryIcon(cat) {
  const map = {
    'Housing':'🏠','Utilities':'💡','Fuel & Gas':'⛽','Groceries':'🛒','Grocery+':'🛒',
    'Communication':'📡','Technology':'💻','Transportation':'🚗','Investments':'📈',
    'Savings':'🏦','Financial Service':'💼','Charity':'❤️','Paramedicine':'💊',
    'Sinking Fund':'🪣','Loans/Credit':'💳','Contingency Fund - Emergency':'🚨',
    'Contingency Fund - Rainy Day':'☂️','Entertainment, Board Games':'🎮',
  };
  return map[cat] || '📋';
}

function categoryBg(cat) {
  const map = {
    'Housing':'#1a2e1a','Utilities':'#1a1f2e','Fuel & Gas':'#2e1a0a',
    'Groceries':'#1a2e1a','Grocery+':'#1a2e1a','Communication':'#1a1a2e',
    'Technology':'#1a1a2e','Transportation':'#1a2535','Investments':'#0a2e1a',
    'Savings':'#0a2e1a','Financial Service':'#1a1a2e','Charity':'#2e0a1a',
    'Paramedicine':'#2e1a1a',
  };
  return map[cat] || '#1a1a2e';
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (type||'');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 3000);
}

// Flush offline queue on load if connected
window.addEventListener('online', flushQueue);
flushQueue();
