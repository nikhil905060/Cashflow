const UPI_CARD_THEMES = ['card-blue', 'card-indigo', 'card-teal', 'card-slate'];
const CAT_COLORS = { Food: '#AF52DE', Transport: '#007AFF', Bills: '#FF9500', Shopping: '#FF3B30', General: '#34C759' };

function getTotalUpiBalance() { return state.upiAccounts.reduce((s, a) => s + (Number(a.balance) || 0), 0); }
function displayBal(val) { return isMasked ? '₹••••' : `₹${Number(val).toLocaleString('en-IN')}`; }

function buildDeckItems() {
  const totalUpi = getTotalUpiBalance();
  let rec = 0, pay = 0;
  Object.values(state.friends).forEach(v => { if (v > 0) rec += v; if (v < 0) pay += Math.abs(v); });
  const udharTxt = isMasked ? 'Udhar ••••' : `Udhar: +₹${Math.round(rec)} / -₹${Math.round(pay)}`;
  const items = [{
    label: 'Total Net Balance', sub: `${state.upiAccounts.length} UPI + Cash`,
    bal: totalUpi + state.cashBalance, meta: udharTxt, theme: 'card-obsidian'
  }];
  state.upiAccounts.forEach((acc, i) => {
    const count = state.transactions.filter(t => String(t.accountName || '').toLowerCase() === acc.name.toLowerCase()).length;
    items.push({
      label: acc.name, sub: 'Bank / UPI', bal: acc.balance,
      meta: `${count} entries • Swipe to switch`, theme: UPI_CARD_THEMES[i % UPI_CARD_THEMES.length]
    });
  });
  const cashCount = state.transactions.filter(t => t.accountName === 'CASH').length;
  items.push({
    label: 'Cash Wallet', sub: 'In Hand', bal: state.cashBalance,
    meta: `${cashCount} entries • Physical Cash`, theme: 'card-emerald'
  });
  return items;
}

function shiftCard(dir) {
  const items = buildDeckItems();
  if (items.length <= 1) return;
  activeCardIdx = (activeCardIdx + dir + items.length) % items.length;
  renderWalletDeck();
}

function renderWalletDeck() {
  const items = buildDeckItems();
  if (activeCardIdx >= items.length) activeCardIdx = 0;
  const visibleCount = Math.min(3, items.length);
  let html = '';

  for (let pos = visibleCount - 1; pos >= 0; pos--) {
    const idx = (activeCardIdx + pos) % items.length;
    const c = items[idx];
    const dotsHtml = pos === 0
      ? `<div class="wc-dots">${items.map((_, di) => `<span class="wc-dot ${di === activeCardIdx ? 'active' : ''}"></span>`).join('')}</div>`
      : '';
    const actionHtml = pos === 0
      ? `<div class="wc-actions">
           <button type="button" class="wc-icon-btn" id="deck-next-btn" aria-label="Next Card">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
           </button>
           <button type="button" class="wc-icon-btn" id="deck-add-acc-btn" aria-label="Add Account">
             <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
           </button>
         </div>`
      : `<span class="wc-sub">${escapeHtml(c.sub)}</span>`;

    html += `
      <div class="w-card ${c.theme}" data-pos="${pos}" data-card-idx="${idx}">
        <div class="wc-top">
          <div>
            <div class="wc-name">${escapeHtml(c.label)}</div>
            ${pos === 0 ? `<div class="wc-sub">${escapeHtml(c.sub)}</div>` : ''}
          </div>
          ${actionHtml}
        </div>
        <div class="wc-bal tabular">${displayBal(c.bal)}</div>
        <div class="wc-foot">
          <span class="wc-meta tabular">${escapeHtml(c.meta)}</span>
          ${dotsHtml}
        </div>
      </div>`;
  }
  deckStage.innerHTML = html;

  deckStage.querySelectorAll('.w-card[data-pos="1"], .w-card[data-pos="2"]').forEach(el => {
    el.addEventListener('click', () => { activeCardIdx = parseInt(el.getAttribute('data-card-idx'), 10) || 0; renderWalletDeck(); });
  });
  const nextBtn = document.getElementById('deck-next-btn');
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); shiftCard(1); });
  const addBtn = document.getElementById('deck-add-acc-btn');
  if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddAccountModal(); });

  renderSpendingStrip();
}

let touchStartX = 0, touchStartY = 0;
walletDeckEl.addEventListener('touchstart', (e) => {
  if (!e.touches.length) return;
  touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
}, { passive: true });
walletDeckEl.addEventListener('touchend', (e) => {
  if (!e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) shiftCard(dx < 0 ? 1 : -1);
}, { passive: true });

function renderSpendingStrip() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  document.getElementById('sp-month-lbl').textContent = `Spent in ${now.toLocaleDateString('en-IN', { month: 'long' })}`;
  const deb = state.transactions.filter(t => {
    if ((t.type !== 'DEBIT' && t.type !== 'FRIEND_PAID') || !(t.myShare > 0)) return false;
    const d = new Date(t.tsMs || parseLegacyTsToMs(t.ts, t.id));
    return `${d.getFullYear()}-${d.getMonth()}` === monthKey;
  });
  const total = deb.reduce((s, t) => s + t.myShare, 0);
  document.getElementById('sp-total-lbl').textContent = isMasked ? '₹••••' : `₹${Math.round(total).toLocaleString('en-IN')}`;
  const barEl = document.getElementById('sp-bar');
  const legEl = document.getElementById('sp-legend');
  if (!total) { barEl.innerHTML = ''; legEl.innerHTML = '<span>No expenses logged this month</span>'; return; }

  const map = {};
  deb.forEach(t => { const c = CAT_COLORS[t.category] ? t.category : 'General'; map[c] = (map[c] || 0) + t.myShare; });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  barEl.innerHTML = sorted.map(([c, v]) => `<div class="sp-seg" style="flex:${v}; background:${CAT_COLORS[c] || '#34C759'};"></div>`).join('');
  legEl.innerHTML = sorted.slice(0, 4).map(([c, v]) =>
    `<span class="sp-leg-item"><span class="sp-leg-dot" style="background:${CAT_COLORS[c] || '#34C759'};"></span>${c} ${Math.round((v / total) * 100)}%</span>`
  ).join('');
}
document.getElementById('spending-strip').addEventListener('click', () => { if (typeof runCommand === 'function') runCommand('stats'); });

// ADD ACCOUNT MODAL
const addAccBackdrop = document.getElementById('add-acc-backdrop');
const newAccNameEl = document.getElementById('new-acc-name');
const newAccBalEl = document.getElementById('new-acc-bal');
function openAddAccountModal() {
  newAccNameEl.value = ''; newAccBalEl.value = '';
  addAccBackdrop.classList.add('open');
  setTimeout(() => newAccNameEl.focus(), 100);
}
document.getElementById('add-acc-cancel').addEventListener('click', () => addAccBackdrop.classList.remove('open'));
addAccBackdrop.addEventListener('click', (e) => { if (e.target === addAccBackdrop) addAccBackdrop.classList.remove('open'); });
document.getElementById('add-acc-save').addEventListener('click', async () => {
  const name = newAccNameEl.value.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  const bal = parseFloat(newAccBalEl.value || '0');
  if (!name) return alert('Enter account name.');
  if (isNaN(bal) || bal < 0) return alert('Enter valid balance.');
  state.upiAccounts.push({ id: `upi_${Date.now()}`, name, balance: round2(bal) });
  state.setupComplete = true;
  activeCardIdx = state.upiAccounts.length;
  await persistState('add_account');
  addAccBackdrop.classList.remove('open');
  renderFeedView();
});

// FEED VIEW & FILTERS
function showNotice(text, cls = '') { const d = document.createElement('div'); d.className = `msg-line ${cls}`; d.textContent = text; outputEl.appendChild(d); }
function showBlock(text, cls = '') { outputEl.innerHTML = ''; const d = document.createElement('div'); d.className = `box-block ${cls}`; d.textContent = text; outputEl.appendChild(d); }

function renderFeedView(filterType = activeFilter, customDateStr = activeDateQuery) {
  activeFilter = filterType; activeDateQuery = customDateStr; outputEl.innerHTML = '';
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  let list = state.transactions;

  if (filterType === 'today') {
    feedTitleLbl.textContent = "Today's Entries";
    list = list.filter(t => { const d = new Date(t.tsMs || parseLegacyTsToMs(t.ts, t.id)); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey; });
  } else if (filterType === 'month') {
    feedTitleLbl.textContent = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    list = list.filter(t => { const d = new Date(t.tsMs || parseLegacyTsToMs(t.ts, t.id)); return `${d.getFullYear()}-${d.getMonth()}` === monthKey; });
  } else if (filterType === 'date' && customDateStr) {
    const picked = new Date(customDateStr + 'T00:00:00');
    feedTitleLbl.textContent = picked.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const targetKey = `${picked.getFullYear()}-${picked.getMonth()}-${picked.getDate()}`;
    list = list.filter(t => { const d = new Date(t.tsMs || parseLegacyTsToMs(t.ts, t.id)); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === targetKey; });
  } else { feedTitleLbl.textContent = 'Recent Activity'; }

  const periodSpend = list.filter(t => t.type === 'DEBIT' || t.type === 'FRIEND_PAID').reduce((s, t) => s + (t.myShare || 0), 0);
  entryCountLbl.textContent = `${list.length} entries • Spend ₹${Math.round(periodSpend).toLocaleString('en-IN')}`;
  if (!list.length) { showNotice('No transactions found. Tap any entry to edit.', 'dim'); return; }
  list.forEach(t => appendTxRow(t));
}

document.querySelectorAll('#seg-control .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#seg-control .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.getAttribute('data-hfilter');
    if (mode === 'date') {
      dateFilterRow.classList.add('show');
      if (!datePickerInput.value) { const d = new Date(); datePickerInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
      renderFeedView('date', datePickerInput.value);
    } else { dateFilterRow.classList.remove('show'); renderFeedView(mode, ''); }
  });
});
datePickerInput.addEventListener('change', (e) => { if (e.target.value) renderFeedView('date', e.target.value); });

function appendTxRow(t) {
  const isPositive = t.type === 'CREDIT' || t.type === 'SETTLE_IN';
  const isUdhar = t.splitFriends && t.splitFriends.length > 0;
  const isFriendPaid = t.type === 'FRIEND_PAID';
  const iconCls = isPositive ? 'credit' : (isUdhar ? 'udhar' : (isFriendPaid ? 'owe' : 'debit'));
  const iconSvg = isPositive
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>'
    : (isUdhar || isFriendPaid)
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';

  let titleText = t.note;
  if (isUdhar) titleText = `${t.fullLoan ? 'Udhar' : 'Split'} • ${t.splitFriends.join(', ')} — ${t.note}`;
  else if (isFriendPaid) titleText = `${t.payer} Paid — ${t.note}`;
  const sign = isPositive ? '+' : '-';
  const amtCls = isPositive ? 'credit' : (isUdhar ? 'split' : (isFriendPaid ? 'owe' : 'debit'));
  const autoBadge = t.autoDetected ? '<span class="auto-tag">Auto</span>' : '';

  const row = document.createElement('div');
  row.className = 'tx-row tap-item';
  row.innerHTML = `
    <div class="tx-icon-wrap ${iconCls}">${iconSvg}</div>
    <div class="tx-body">
      <div class="tx-title-row"><div class="tx-title">${escapeHtml(titleText)}</div>${autoBadge}</div>
      <div class="tx-sub tabular">${escapeHtml(t.ts)} • ${escapeHtml(t.accountName)} • ${escapeHtml(t.category || 'General')}</div>
    </div>
    <div class="tx-right">
      <span class="tx-amt tabular ${amtCls}">${sign}₹${Number(t.amount).toLocaleString('en-IN')}</span>
      <span class="tx-chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
    </div>`;
  row.addEventListener('click', () => openEditModal(t.id));
  outputEl.appendChild(row);
}

// EDIT MODAL
const editBackdrop = document.getElementById('edit-backdrop');
const editTxIdEl = document.getElementById('edit-tx-id');
const editTypeEl = document.getElementById('edit-type');
const editAmtEl = document.getElementById('edit-amount');
const editAccEl = document.getElementById('edit-account');
const editAccRow = document.getElementById('edit-account-row');
const editFriendEl = document.getElementById('edit-friend');
const editFriendRow = document.getElementById('edit-friend-row');
const editCatEl = document.getElementById('edit-category');
const editDtEl = document.getElementById('edit-datetime');
const editNoteEl = document.getElementById('edit-note');

function syncEditModalFields() {
  const v = editTypeEl.value;
  editFriendRow.style.display = (v === 'UDHAR_FULL' || v === 'UDHAR_SPLIT' || v === 'FRIEND_PAID') ? 'flex' : 'none';
  editAccRow.style.display = v === 'FRIEND_PAID' ? 'none' : 'flex';
}
editTypeEl.addEventListener('change', syncEditModalFields);

function openEditModal(txId) {
  const tx = state.transactions.find(t => t.id === txId); if (!tx) return;
  editTxIdEl.value = tx.id;
  document.getElementById('edit-sheet-title').textContent = `Edit Entry #${tx.id}`;
  editAccEl.innerHTML = state.upiAccounts.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('') + `<option value="CASH">CASH</option>`;
  if (tx.type === 'CREDIT') editTypeEl.value = 'CREDIT';
  else if (tx.type === 'FRIEND_PAID') editTypeEl.value = 'FRIEND_PAID';
  else if (tx.splitFriends && tx.splitFriends.length > 0) editTypeEl.value = tx.fullLoan ? 'UDHAR_FULL' : 'UDHAR_SPLIT';
  else editTypeEl.value = 'DEBIT';

  editAmtEl.value = tx.amount;
  editAccEl.value = tx.accountName === 'CASH' ? 'CASH' : (state.upiAccounts.some(a => a.name === tx.accountName) ? tx.accountName : (state.upiAccounts[0]?.name || 'CASH'));
  editFriendEl.value = tx.type === 'FRIEND_PAID' ? (tx.payer || '') : ((tx.splitFriends || []).join(', '));
  editCatEl.value = tx.category || 'General';
  editDtEl.value = toDateTimeLocalValue(new Date(tx.tsMs || parseLegacyTsToMs(tx.ts, tx.id)));
  editNoteEl.value = tx.note || '';
  syncEditModalFields(); editBackdrop.classList.add('open');
}
document.getElementById('edit-cancel-btn').addEventListener('click', () => editBackdrop.classList.remove('open'));
editBackdrop.addEventListener('click', (e) => { if (e.target === editBackdrop) editBackdrop.classList.remove('open'); });

function revertTxEffect(tx) {
  const acc = state.upiAccounts.find(a => a.name.toLowerCase() === String(tx.accountName || '').toLowerCase()) || state.upiAccounts[0];
  if (tx.type === 'DEBIT') {
    if (tx.accountName === 'CASH') state.cashBalance = round2(state.cashBalance + tx.amount); else if (acc) acc.balance = round2(acc.balance + tx.amount);
    (tx.splitFriends || []).forEach(f => { state.friends[f] = round2((state.friends[f] || 0) - (tx.perFriendShare || 0)); });
  } else if (tx.type === 'FRIEND_PAID') { state.friends[tx.payer] = round2((state.friends[tx.payer] || 0) + (tx.myShare || 0)); }
  else if (tx.type === 'CREDIT') { if (tx.accountName === 'CASH') state.cashBalance = round2(state.cashBalance - tx.amount); else if (acc) acc.balance = round2(acc.balance - tx.amount); }
  else if (tx.type === 'SETTLE_IN') {
    if (tx.accountName === 'CASH') state.cashBalance = round2(state.cashBalance - tx.amount); else if (acc) acc.balance = round2(acc.balance - tx.amount);
    if (tx.settleFriend) state.friends[tx.settleFriend] = round2((state.friends[tx.settleFriend] || 0) + tx.amount);
  } else if (tx.type === 'SETTLE_OUT') {
    if (tx.accountName === 'CASH') state.cashBalance = round2(state.cashBalance + tx.amount); else if (acc) acc.balance = round2(acc.balance + tx.amount);
    if (tx.settleFriend) state.friends[tx.settleFriend] = round2((state.friends[tx.settleFriend] || 0) - tx.amount);
  }
}

document.getElementById('edit-save-btn').addEventListener('click', async () => {
  const id = parseInt(editTxIdEl.value, 10), idx = state.transactions.findIndex(t => t.id === id);
  if (idx === -1) return;
  const amt = parseFloat(editAmtEl.value); if (isNaN(amt) || amt <= 0) return alert('Enter a valid amount.');
  const oldTx = state.transactions[idx]; revertTxEffect(oldTx);
  const mode = editTypeEl.value;
  const dtObj = editDtEl.value ? new Date(editDtEl.value) : new Date(oldTx.tsMs || Date.now());
  const tsMs = isNaN(dtObj.getTime()) ? Date.now() : dtObj.getTime();
  const chosenAccName = editAccEl.value || 'CASH', isCash = chosenAccName === 'CASH';
  const acc = isCash ? null : (state.upiAccounts.find(a => a.name === chosenAccName) || state.upiAccounts[0]);
  const friendList = editFriendEl.value.split(',').map(s => s.trim()).filter(Boolean).map(capitalize);

  let newTx = {
    id: oldTx.id, ts: formatTsFromDate(new Date(tsMs)), tsMs, amount: amt,
    category: editCatEl.value || 'General', note: editNoteEl.value.trim() || oldTx.note,
    accountName: isCash ? 'CASH' : (acc ? acc.name : 'UPI'),
    type: 'DEBIT', myShare: amt, perFriendShare: 0, splitFriends: [], fullLoan: false, autoDetected: Boolean(oldTx.autoDetected)
  };
  if (mode === 'CREDIT') {
    newTx.type = 'CREDIT'; newTx.myShare = 0;
    if (isCash) state.cashBalance = round2(state.cashBalance + amt); else if (acc) acc.balance = round2(acc.balance + amt);
  } else if (mode === 'FRIEND_PAID') {
    const payer = friendList[0] || 'Friend';
    newTx.type = 'FRIEND_PAID'; newTx.payer = payer; newTx.accountName = payer; newTx.myShare = amt;
    state.friends[payer] = round2((state.friends[payer] || 0) - amt);
  } else if (mode === 'UDHAR_FULL' && friendList.length > 0) {
    newTx.splitFriends = friendList; newTx.fullLoan = true; newTx.perFriendShare = round2(amt / friendList.length); newTx.myShare = 0;
    if (isCash) state.cashBalance = round2(state.cashBalance - amt); else if (acc) acc.balance = round2(acc.balance - amt);
    friendList.forEach(f => state.friends[f] = round2((state.friends[f] || 0) + newTx.perFriendShare));
  } else if (mode === 'UDHAR_SPLIT' && friendList.length > 0) {
    newTx.splitFriends = friendList; newTx.fullLoan = false; newTx.perFriendShare = round2(amt / (friendList.length + 1)); newTx.myShare = round2(amt - newTx.perFriendShare * friendList.length);
    if (isCash) state.cashBalance = round2(state.cashBalance - amt); else if (acc) acc.balance = round2(acc.balance - amt);
    friendList.forEach(f => state.friends[f] = round2((state.friends[f] || 0) + newTx.perFriendShare));
  } else {
    if (isCash) state.cashBalance = round2(state.cashBalance - amt); else if (acc) acc.balance = round2(acc.balance - amt);
  }
  state.transactions[idx] = newTx;
  state.transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  await persistState('edit_save'); editBackdrop.classList.remove('open'); renderFeedV
