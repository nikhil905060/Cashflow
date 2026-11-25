let wizard = { active: false, step: null, totalAccounts: 1, currentIdx: 0, tempName: '', collectedAccounts: [] };

const NON_FRIEND = new Set([
  'me','my','mere','mera','both','dono','hum','upi','cash','chai','tea','coffee','food','khana','pizza','burger','lunch','dinner','nashta','milk','paneer','dahi','lassi','grocery','sabzi',
  'auto','bus','train','petrol','diesel','cab','ticket','kiraya','bike','bill','bijli','rent','room','recharge','jio','vi','airtel','shirt','pant','shoes','amazon','flipkart','shopping',
  'friend','dost','paid','for','by','with','and','ke','sath','ko','diye','diya','udhar','loan','credit','credited','received','salary','stipend','income','added','refund','cashback','mila','mile','aaye'
]);

function resolveUpiAccount(lower) {
  if (!state.upiAccounts.length) return { id: 'upi_1', name: 'UPI', balance: 0 };
  if (state.upiAccounts.length === 1) return state.upiAccounts[0];
  for (const acc of state.upiAccounts) { if (new RegExp(`\\b${acc.name.toLowerCase()}\\b`, 'i').test(lower)) return acc; }
  return state.upiAccounts[0];
}
function extractAmount(text) { const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; }
function inferCategory(lower, isCredit) {
  if (isCredit) return 'Income';
  if (/\b(chai|tea|coffee|pizza|burger|food|khana|lunch|dinner|nashta|milk|paneer|grocery|sabzi|zomato|swiggy)\b/.test(lower)) return 'Food';
  if (/\b(auto|bus|train|petrol|diesel|cab|ticket|kiraya|bike|uber|ola|rapido)\b/.test(lower)) return 'Transport';
  if (/\b(recharge|jio|vi|airtel|bill|bijli|rent|room)\b/.test(lower)) return 'Bills';
  if (/\b(shirt|pant|shoes|amazon|flipkart|myntra|shopping)\b/.test(lower)) return 'Shopping';
  return 'General';
}

// AUTO-TRANSACTION INGESTION
async function syncAutoTransactions() {
  if (!state.setupComplete) return;
  if (!window.AndroidNative || typeof window.AndroidNative.consumeAutoTransactions !== 'function') return;
  try {
    const list = JSON.parse(window.AndroidNative.consumeAutoTransactions() || '[]');
    if (Array.isArray(list) && list.length > 0) await ingestAutoList(list);
  } catch (e) {}
}
window.onAutoTransactionsReady = syncAutoTransactions;

async function ingestAutoList(items) {
  let added = 0;
  for (const item of items) {
    const amt = round2(item.amount); if (!amt || amt <= 0) continue;
    const isCredit = item.type === 'CREDIT';
    const hint = String(item.accountHint || 'UPI').toLowerCase();
    const acc = state.upiAccounts.find(a => a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase())) || state.upiAccounts[0];
    if (!acc) continue;
    if (isCredit) acc.balance = round2(acc.balance + amt); else acc.balance = round2(acc.balance - amt);
    const tsMs = Number(item.tsMs) || Date.now();
    const note = String(item.note || (isCredit ? 'Auto Credit' : 'Auto Debit'));
    state.transactions.unshift({
      id: state.nextId++, ts: formatTsFromDate(new Date(tsMs)), tsMs,
      type: isCredit ? 'CREDIT' : 'DEBIT', amount: amt, myShare: isCredit ? 0 : amt,
      perFriendShare: 0, splitFriends: [], fullLoan: false,
      accountName: acc.name, category: inferCategory(note.toLowerCase(), isCredit), note, autoDetected: true
    });
    added++;
  }
  if (added > 0) {
    state.transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
    await persistState('auto_detect');
    renderFeedView();
  }
}

// SETUP WIZARD
function startSetupWizard(isReconfig = false) {
  wizard = { active: true, step: 'COUNT', totalAccounts: 1, currentIdx: 0, tempName: '', collectedAccounts: [] };
  outputEl.innerHTML = ''; feedTitleLbl.textContent = isReconfig ? 'Wallet Re-Setup' : 'Welcome Setup';
  cmdInput.placeholder = 'How many UPI accounts? (1, 2, 3)...';
  showNotice('How many UPI / Bank accounts do you have? (Enter 1, 2, or 3)', 'info');
}

async function handleWizardInput(raw) {
  const text = raw.trim();
  if (wizard.step === 'COUNT') {
    const count = parseInt(text.replace(/[^\d]/g, ''), 10);
    if (!count || count < 1 || count > 10) return showNotice('Enter a number between 1 and 10.', 'debit');
    wizard.totalAccounts = count; wizard.currentIdx = 0; wizard.collectedAccounts = [];
    if (count === 1) { wizard.step = 'ACC_BAL'; wizard.tempName = 'UPI'; showNotice('1 UPI Account selected. Enter current balance (e.g. 2135):', 'info'); cmdInput.placeholder = 'Enter UPI balance...'; }
    else { wizard.step = 'ACC_NAME'; showNotice('Enter Account #1 name (e.g. SBI, Union, Slice):', 'info'); cmdInput.placeholder = 'Account #1 name...'; }
    return;
  }
  if (wizard.step === 'ACC_NAME') {
    const name = text.replace(/[^a-zA-Z0-9 _-]/g, '').trim(); if (!name) return showNotice('Enter a valid name.', 'debit');
    wizard.tempName = name; wizard.step = 'ACC_BAL'; showNotice(`Enter current balance in ${name}:`, 'info'); cmdInput.placeholder = `Balance in ${name}...`; return;
  }
  if (wizard.step === 'ACC_BAL') {
    const num = parseFloat(text.replace(/,/g, '').replace(/[^\d.]/g, '')); if (isNaN(num) || num < 0) return showNotice('Enter a valid amount.', 'debit');
    wizard.collectedAccounts.push({ id: `upi_${wizard.currentIdx + 1}`, name: wizard.tempName, balance: num }); wizard.currentIdx++;
    if (wizard.currentIdx < wizard.totalAccounts) { wizard.step = 'ACC_NAME'; showNotice(`Enter Account #${wizard.currentIdx + 1} name:`, 'info'); cmdInput.placeholder = `Account #${wizard.currentIdx + 1} name...`; }
    else { wizard.step = 'CASH'; showNotice('Enter current Cash in hand (e.g. 0 or 500):', 'info'); cmdInput.placeholder = 'Cash in hand...'; }
    return;
  }
  if (wizard.step === 'CASH') {
    const cash = parseFloat(text.replace(/,/g, '').replace(/[^\d.]/g, '')); if (isNaN(cash) || cash < 0) return showNotice('Enter a valid cash amount.', 'debit');
    state.upiAccounts = wizard.collectedAccounts; state.cashBalance = cash; state.setupComplete = true; wizard.active = false;
    cmdInput.placeholder = '50 chai upi | 353 manish recharge';
    await persistState('setup'); renderFeedView('all'); syncAutoTransactions();
  }
}

// COMMAND ENGINE
async function runCommand(raw) {
  const text = raw.trim(); if (!text) return;
  if (wizard.active) return handleWizardInput(text);
  const lower = text.toLowerCase();

  if (lower === 'setup') return startSetupWizard(true);
  if (lower === 'lock') return engageLock();
  if (lower === 'clear' || lower === 'ls' || lower === 'history') return renderFeedView('all');

  if (lower.startsWith('pin ')) {
    const newPin = text.split(/\s+/)[1] || '';
    if (!/^\d{4}$/.test(newPin)) return showBlock('Usage: pin 1234 (4 digits only)', 'debit');
    try { localStorage.setItem(PIN_KEY, newPin); } catch (e) {}
    return showBlock('Passcode updated successfully.', 'credit');
  }
  if (lower === 'backup') {
    const path = runDailyAutoBackup(true), jsonStr = JSON.stringify(state);
    try { await navigator.clipboard.writeText(jsonStr); } catch (e) {}
    feedTitleLbl.textContent = 'Backup Status';
    return showBlock(`Backup copied to clipboard & saved:\n${path || 'LocalStorage'}`, 'credit');
  }
  if (lower.startsWith('restore ')) {
    try { state = normalizeState(JSON.parse(text.slice(8).trim())); await persistState('restore'); renderFeedView('all'); return; }
    catch (e) { return showBlock('Invalid backup JSON.', 'debit'); }
  }
  if (lower === 'edit' || lower.startsWith('edit ')) {
    if (!state.transactions.length) return showBlock('No entries to edit.', 'dim');
    const arg = lower.split(/\s+/)[1];
    const target = arg ? state.transactions.find(t => t.id === parseInt(arg, 10)) : state.transactions[0];
    return target ? openEditModal(target.id) : showBlock(`Entry #${arg} not found.`, 'debit');
  }
  if (lower === 'undo') {
    if (!state.transactions.length) return showBlock('No entries to undo.', 'dim');
    revertTxEffect(state.transactions[0]); state.transactions.shift();
    await persistState('undo'); return renderFeedView();
  }
  if (lower.startsWith('find ') || lower.startsWith('search ')) {
    const q = lower.replace(/^(?:find|search)\s+/, '').trim();
    if (!q) return showBlock('Usage: find chai | find manish', 'warn');
    const matches = state.transactions.filter(t =>
      t.note.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q)) ||
      (t.accountName && t.accountName.toLowerCase().includes(q)) || (t.payer && t.payer.toLowerCase().includes(q)) ||
      (t.splitFriends && t.splitFriends.some(f => f.toLowerCase().includes(q)))
    );
    feedTitleLbl.textContent = `Search: "${q}"`; outputEl.innerHTML = '';
    const total = matches.reduce((s, t) => s + t.amount, 0);
    entryCountLbl.textContent = `${matches.length} found • ₹${Math.round(total).toLocaleString('en-IN')}`;
    if (!matches.length) return showNotice(`No entries matching "${q}".`, 'dim');
    matches.forEach(t => appendTxRow(t)); return;
  }
  if (lower === 'bal' || lower === 'balance' || (/\b(kitna|bacha|balance)\b/.test(lower) && !extractAmount(text))) {
    feedTitleLbl.textContent = 'Balance Sheet';
    let rec = 0, pay = 0; Object.values(state.friends).forEach(v => { if (v > 0) rec += v; if (v < 0) pay += Math.abs(v); });
    let out = ''; state.upiAccounts.forEach(a => out += `${a.name.padEnd(14)} : ${formatMoney(a.balance, true)}\n`);
    out += `Cash           : ${formatMoney(state.cashBalance, true)}\nLena Hai (+)   : ${formatMoney(rec, true)}\nDena Hai (-)   : ${formatMoney(pay, true)}\n--------------------------------\nNet Worth      : ${formatMoney(getTotalUpiBalance() + state.cashBalance + rec - pay, true)}`;
    return showBlock(out);
  }
  if (lower === 'dues' || lower === 'udhar') {
    feedTitleLbl.textContent = 'Friend Udhar Ledger';
    const list = Object.entries(state.friends).filter(([_, v]) => Math.abs(v) >= 0.01);
    if (!list.length) return showBlock('No pending friend dues.', 'dim');
    let out = ''; list.forEach(([n, v]) => out += `${n.padEnd(14)} : ${v > 0 ? 'LENA HAI +' + formatMoney(v, true) : 'DENA HAI -' + formatMoney(Math.abs(v), true)}\n`);
    out += `\nTip: Type "settle <name>" to clear dues.`; return showBlock(out, 'split');
  }
  if (lower === 'stats') {
    feedTitleLbl.textContent = 'Expense Breakdown';
    const deb = state.transactions.filter(t => (t.type === 'DEBIT' || t.type === 'FRIEND_PAID') && t.myShare > 0);
    if (!deb.length) return showBlock('No personal expenses yet.', 'dim');
    const tot = deb.reduce((s, t) => s + t.myShare, 0), map = {};
    deb.forEach(t => map[t.category] = (map[t.category] || 0) + t.myShare);
    let out = `TOTAL PERSONAL SPEND: ${formatMoney(tot)}\n\n`;
    Object.entries(map).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => { out += `${c.padEnd(13)} : ${formatMoney(v)} (${Math.round((v / tot) * 100)}%)\n`; });
    return showBlock(out);
  }

  const entryDate = (backdateBar.classList.contains('show') && customEntryDt.value) ? new Date(customEntryDt.value) : new Date();
  const tsMs = isNaN(entryDate.getTime()) ? Date.now() : entryDate.getTime(), ts = formatTsFromDate(new Date(tsMs));

  if (lower.startsWith('settle ')) {
    const target = text.slice(7).replace(/\b(upi|cash)\b/gi, '').trim();
    const fKey = Object.keys(state.friends).find(k => k.toLowerCase() === target.toLowerCase());
    if (!fKey || Math.abs(state.friends[fKey]) < 0.01) return showBlock(`No pending dues for ${target}.`, 'dim');
    const val = state.friends[fKey], abs = Math.abs(val), isCash = /\bcash\b/.test(lower), acc = isCash ? null : resolveUpiAccount(lower);
    const txObj = { id: state.nextId++, ts, tsMs, type: val > 0 ? 'SETTLE_IN' : 'SETTLE_OUT', amount: abs, myShare: 0, accountName: isCash ? 'CASH' : acc.name, settleFriend: fKey, category: 'Settlement', note: val > 0 ? `Settled from ${fKey}` : `Paid to ${fKey}` };
    if (val > 0) { if (isCash) state.cashBalance = round2(state.cashBalance + abs); else acc.balance = round2(acc.balance + abs); }
    else { if (isCash) state.cashBalance = round2(state.cashBalance - abs); else acc.balance = round2(acc.balance - abs); }
    state.friends[fKey] = 0; state.transactions.unshift(txObj); state.transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
    await persistState('settle'); toggleBackdateBar(false); return renderFeedView();
  }
  if (lower.startsWith('rm ')) {
    const id = parseInt(lower.split(/\s+/)[1], 10), idx = state.transactions.findIndex(t => t.id === id);
    if (idx === -1) return showBlock(`Entry #${id} not found.`, 'debit');
    revertTxEffect(state.transactions[idx]); state.transactions.splice(idx, 1);
    await persistState('rm'); return renderFeedView();
  }

  const amt = extractAmount(text);
  if (!amt || amt <= 0) return showBlock('Could not find an amount. Example: "50 chai upi" or "353 manish recharge"', 'warn');

  const paidByM = lower.match(/\b(?:paid by|by)\s+([a-zA-Z]+(?:\s+ji)?)/) || lower.match(/^([a-zA-Z]+(?:\s+ji)?)\s+(?:ne|paid)\b/);
  if (paidByM && !NON_FRIEND.has(paidByM[1].split(/\s+/)[0].toLowerCase())) {
    const payer = capitalize(paidByM[1]), myShare = /\b(both|dono|split)\b/.test(lower) ? round2(amt / 2) : amt;
    state.friends[payer] = round2((state.friends[payer] || 0) - myShare);
    state.transactions.unshift({ id: state.nextId++, ts, tsMs, type: 'FRIEND_PAID', amount: amt, myShare, payer, accountName: payer, category: inferCategory(lower, false), note: text });
    state.transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
    await persistState('friend_paid'); toggleBackdateBar(false); return renderFeedView();
  }

  const isCredit = text.startsWith('+') || /\b(credit|credited|received|salary|stipend|income|added|refund|cashback|mila|mile|aaye)\b/.test(lower);
  const isCash = /\bcash\b/.test(lower), acc = isCash ? null : resolveUpiAccount(lower), chan = isCash ? 'CASH' : acc.name;
  const upiNamesSet = new Set(state.upiAccounts.map(a => a.name.toLowerCase()));
  let splitFriends = [], fullLoan = false;
  const withM = lower.match(/\b(?:with|and|ke sath)\s+([a-zA-Z\s,]+)/);

  if (!isCredit && withM) {
    splitFriends = withM[1].split(/[\s,]+/).filter(w => w.length >= 2 && !NON_FRIEND.has(w) && !upiNamesSet.has(w)).map(capitalize);
  } else if (!isCredit) {
    const words = lower.replace(/[\d.,]+/g, ' ').trim().split(/[\s,]+/), directNames = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^[a-zA-Z]{2,}$/.test(w) && !NON_FRIEND.has(w) && !upiNamesSet.has(w) && w !== 'ji') {
        if (words[i + 1] === 'ji') { directNames.push(capitalize(w + ' ji')); i++; } else directNames.push(capitalize(w));
      }
    }
    if (directNames.length > 0) { splitFriends = [directNames[0]]; fullLoan = true; }
  }

  let myShare = amt, perFriendShare = 0;
  if (!isCredit && splitFriends.length > 0) {
    if (fullLoan) { perFriendShare = amt; myShare = 0; }
    else { perFriendShare = round2(amt / (splitFriends.length + 1)); myShare = round2(amt - perFriendShare * splitFriends.length); }
    splitFriends.forEach(f => state.friends[f] = round2((state.friends[f] || 0) + perFriendShare));
  }
  if (isCredit) { if (isCash) state.cashBalance = round2(state.cashBalance + amt); else acc.balance = round2(acc.balance + amt); }
  else { if (isCash) state.cashBalance = round2(state.cashBalance - amt); else acc.balance = round2(acc.balance - amt); }

  state.transactions.unshift({
    id: state.nextId++, ts, tsMs, type: isCredit ? 'CREDIT' : 'DEBIT',
    amount: amt, myShare: isCredit ? 0 : myShare, perFriendShare, splitFriends, fullLoan,
    accountName: chan, category: inferCategory(lower, isCredit), note: text
  });
  state.transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  await persistState('tx'); toggleBackdateBar(false); renderFeedView();
}

submitBtn.addEventListener('click', () => { const v = cmdInput.value; if (v.trim()) runCommand(v); cmdInput.value = ''; cmdInput.focus(); });
cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); } });
document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => runCommand(b.getAttribute('data-cmd'))));
document.querySelectorAll('[data-insert]').forEach(b => b.addEventListener('click', () => {
  cmdInput.value = cmdInput.value.replace(/\s+$/, '') + b.getAttribute('data-insert'); cmdInput.focus();
}));

(async function boot() {
  state = await storageEngine.loadAndHeal();
  renderWalletDeck();
  refreshAutoDetectStatus();
  runDailyAutoBackup(false);
  if (!state.setupComplete) startSetupWizard(false);
  else { renderFeedView('all'); await syncAutoTransactions(); }
})();
  
