const L1_PRIMARY_KEY = 'cashflow_os_v5_primary';
const L1_BACKUP_KEY  = 'cashflow_os_v5_backup';
const IDB_DB_NAME    = 'CASHFLOW_OS_IDB_V5';
const IDB_STORE_NAME = 'ledger_snapshots';
const CUST_PREF_KEY  = 'cashflow_os_ios18_pref_v1';
const MASK_PREF_KEY  = 'cashflow_os_masked_v1';
const PIN_KEY        = 'cashflow_os_pin_v1';
const LAST_BKP_KEY   = 'cashflow_os_last_auto_backup';

// 1. LOCK SCREEN FIRST (Independent — kabhi freeze nahi hoga)
const lockScreen = document.getElementById('lock-screen');
const lockHeading = document.getElementById('lock-heading');
const lockSub = document.getElementById('lock-sub');
const lockErr = document.getElementById('lock-err');
const pinDots = document.querySelectorAll('#pin-dots .pin-dot');
const cmdInput = document.getElementById('cmd-input');

let pinBuffer = '', isSettingPin = false, tempFirstPin = '';

function getSavedPin() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
function updatePinDots() { pinDots.forEach((d, i) => d.classList.toggle('filled', i < pinBuffer.length)); }
function unlockApp() {
  pinBuffer = ''; tempFirstPin = ''; updatePinDots();
  lockScreen.classList.add('unlocked');
  if (typeof syncAutoTransactions === 'function') syncAutoTransactions();
}
window.onNativeUnlock = unlockApp;

function triggerBiometricPrompt() {
  try {
    if (window.AndroidNative && typeof window.AndroidNative.triggerBiometric === 'function') {
      window.AndroidNative.triggerBiometric();
    } else {
      lockErr.textContent = 'Fingerprint available in Android APK';
    }
  } catch (e) {}
}

function engageLock() {
  pinBuffer = ''; tempFirstPin = ''; lockErr.textContent = '';
  if (!getSavedPin()) {
    isSettingPin = true; lockHeading.textContent = 'Set Passcode'; lockSub.textContent = 'Create a 4-digit passcode';
  } else {
    isSettingPin = false; lockHeading.textContent = 'Cash Flow OS'; lockSub.textContent = 'Enter Passcode or Use Fingerprint';
  }
  updatePinDots(); lockScreen.classList.remove('unlocked');
  if (cmdInput) cmdInput.blur();
  if (!isSettingPin) setTimeout(triggerBiometricPrompt, 200);
}

document.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => {
  if (pinBuffer.length >= 4) return;
  pinBuffer += b.getAttribute('data-key'); lockErr.textContent = ''; updatePinDots();
  if (pinBuffer.length === 4) {
    setTimeout(() => {
      if (isSettingPin) {
        if (!tempFirstPin) {
          tempFirstPin = pinBuffer; pinBuffer = ''; updatePinDots();
          lockHeading.textContent = 'Confirm Passcode'; lockSub.textContent = 'Re-enter your 4-digit passcode';
        } else if (pinBuffer === tempFirstPin) {
          try { localStorage.setItem(PIN_KEY, pinBuffer); } catch (e) {}
          unlockApp();
        } else {
          lockErr.textContent = 'Passcodes did not match'; tempFirstPin = ''; pinBuffer = ''; updatePinDots();
          lockHeading.textContent = 'Set Passcode';
        }
      } else if (pinBuffer === getSavedPin()) {
        unlockApp();
      } else {
        lockErr.textContent = 'Incorrect Passcode'; pinBuffer = ''; updatePinDots();
      }
    }, 80);
  }
}));

document.getElementById('btn-biometric').addEventListener('click', triggerBiometricPrompt);
document.getElementById('pin-back').addEventListener('click', () => {
  pinBuffer = pinBuffer.slice(0, -1); lockErr.textContent = ''; updatePinDots();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') engageLock();
  else {
    if (typeof refreshAutoDetectStatus === 'function') refreshAutoDetectStatus();
    if (typeof syncAutoTransactions === 'function') syncAutoTransactions();
  }
});
window.addEventListener('pagehide', engageLock);
engageLock();

// 2. SHARED DOM REFS & UTILS
const outputEl = document.getElementById('output');
const submitBtn = document.getElementById('submit-btn');
const micBtn = document.getElementById('mic-btn');
const maskToggle = document.getElementById('mask-toggle');
const feedTitleLbl = document.getElementById('feed-title-lbl');
const entryCountLbl = document.getElementById('entry-count-lbl');
const deckStage = document.getElementById('deck-stage');
const walletDeckEl = document.getElementById('wallet-deck');
const dateFilterRow = document.getElementById('date-filter-row');
const datePickerInput = document.getElementById('date-picker-input');
const backdateBar = document.getElementById('backdate-bar');
const backdateToggleBtn = document.getElementById('backdate-toggle-btn');
const customEntryDt = document.getElementById('custom-entry-dt');
const clearBackdateBtn = document.getElementById('clear-backdate-btn');
const autoBanner = document.getElementById('auto-banner');
const navAutoDot = document.getElementById('nav-auto-dot');
const autoStatusPill = document.getElementById('auto-status-pill');
const autoDetectToggle = document.getElementById('auto-detect-toggle');

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function escapeHtml(str) { return String(str || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function capitalize(s) { return s.split(/\s+/).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' '); }

// 3. SETTINGS, APPEARANCE & AUTO-DETECT STATUS
const menuBackdrop = document.getElementById('menu-backdrop');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const fontSelect = document.getElementById('font-select');
const pickInBg = document.getElementById('pick-in-bg');
const pickInFg = document.getElementById('pick-in-fg');
const pickOutBg = document.getElementById('pick-out-bg');
const pickOutFg = document.getElementById('pick-out-fg');
const pickCredit = document.getElementById('pick-credit');
const pickDebit = document.getElementById('pick-debit');

const defaultPrefs = {
  dark: false,
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
  customColors: false,
  inBg: '#E5E5EA', inFg: '#000000', outBg: '#FFFFFF', outFg: '#000000',
  credit: '#34C759', debit: '#FF3B30'
};
let prefs = { ...defaultPrefs };
try { const s = JSON.parse(localStorage.getItem(CUST_PREF_KEY) || 'null'); if (s) prefs = { ...defaultPrefs, ...s }; } catch (e) {}

function applyPrefs(save = true) {
  document.body.setAttribute('data-theme', prefs.dark ? 'dark' : 'light');
  darkModeToggle.checked = prefs.dark; fontSelect.value = prefs.font;
  const r = document.documentElement.style;
  r.setProperty('--font-main', prefs.font);
  if (prefs.customColors) {
    r.setProperty('--input-bg', prefs.inBg); r.setProperty('--input-fg', prefs.inFg);
    r.setProperty('--output-bg', prefs.outBg); r.setProperty('--output-fg', prefs.outFg);
    r.setProperty('--green', prefs.credit); r.setProperty('--red', prefs.debit);
  } else {
    ['--input-bg','--input-fg','--output-bg','--output-fg','--green','--red'].forEach(k => r.removeProperty(k));
  }
  pickInBg.value = prefs.customColors ? prefs.inBg : (prefs.dark ? '#2C2C2E' : '#E5E5EA');
  pickInFg.value = prefs.customColors ? prefs.inFg : (prefs.dark ? '#FFFFFF' : '#000000');
  pickOutBg.value = prefs.customColors ? prefs.outBg : (prefs.dark ? '#1C1C1E' : '#FFFFFF');
  pickOutFg.value = prefs.customColors ? prefs.outFg : (prefs.dark ? '#FFFFFF' : '#000000');
  pickCredit.value = prefs.customColors ? prefs.credit : (prefs.dark ? '#30D158' : '#34C759');
  pickDebit.value = prefs.customColors ? prefs.debit : (prefs.dark ? '#FF453A' : '#FF3B30');
  if (save) { try { localStorage.setItem(CUST_PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
}

['open-menu-btn','auto-pill-btn','banner-enable-btn'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => { refreshAutoDetectStatus(); menuBackdrop.classList.add('open'); });
});
document.getElementById('close-menu-btn').addEventListener('click', () => menuBackdrop.classList.remove('open'));
menuBackdrop.addEventListener('click', (e) => { if (e.target === menuBackdrop) menuBackdrop.classList.remove('open'); });
darkModeToggle.addEventListener('change', (e) => { prefs.dark = e.target.checked; prefs.customColors = false; applyPrefs(true); });
fontSelect.addEventListener('change', (e) => { prefs.font = e.target.value; applyPrefs(true); });
[pickInBg, pickInFg, pickOutBg, pickOutFg, pickCredit, pickDebit].forEach(el => el.addEventListener('input', () => {
  prefs.customColors = true;
  prefs.inBg = pickInBg.value; prefs.inFg = pickInFg.value;
  prefs.outBg = pickOutBg.value; prefs.outFg = pickOutFg.value;
  prefs.credit = pickCredit.value; prefs.debit = pickDebit.value;
  applyPrefs(true);
}));
document.getElementById('reset-cust-btn').addEventListener('click', () => { prefs = { ...defaultPrefs, dark: prefs.dark }; applyPrefs(true); });
document.querySelectorAll('[data-menu-cmd]').forEach(btn => {
  btn.addEventListener('click', () => { menuBackdrop.classList.remove('open'); if (typeof runCommand === 'function') runCommand(btn.getAttribute('data-menu-cmd')); });
});

function refreshAutoDetectStatus() {
  const hasBridge = window.AndroidNative && typeof window.AndroidNative.isNotificationAccessEnabled === 'function';
  if (!hasBridge) {
    autoStatusPill.textContent = 'APK Only'; autoStatusPill.classList.remove('active');
    navAutoDot.classList.remove('on'); autoBanner.classList.remove('show'); return;
  }
  const permOn = window.AndroidNative.isNotificationAccessEnabled();
  const userOn = window.AndroidNative.isAutoDetectEnabled();
  autoDetectToggle.checked = userOn;
  if (permOn && userOn) {
    autoStatusPill.textContent = 'Active'; autoStatusPill.classList.add('active');
    navAutoDot.classList.add('on'); autoBanner.classList.remove('show');
  } else if (!permOn) {
    autoStatusPill.textContent = 'Permission Needed'; autoStatusPill.classList.remove('active');
    navAutoDot.classList.remove('on'); autoBanner.classList.add('show');
  } else {
    autoStatusPill.textContent = 'Paused'; autoStatusPill.classList.remove('active');
    navAutoDot.classList.remove('on'); autoBanner.classList.remove('show');
  }
}
window.refreshAutoDetectStatus = refreshAutoDetectStatus;

autoDetectToggle.addEventListener('change', (e) => {
  if (window.AndroidNative && typeof window.AndroidNative.setAutoDetectEnabled === 'function') window.AndroidNative.setAutoDetectEnabled(e.target.checked);
  refreshAutoDetectStatus();
});
document.getElementById('btn-open-notif-access').addEventListener('click', () => {
  if (window.AndroidNative && typeof window.AndroidNative.openNotificationSettings === 'function') window.AndroidNative.openNotificationSettings();
});
document.getElementById('btn-open-app-info').addEventListener('click', () => {
  if (window.AndroidNative && typeof window.AndroidNative.openAppDetailsSettings === 'function') window.AndroidNative.openAppDetailsSettings();
});
document.getElementById('btn-test-auto').addEventListener('click', () => {
  menuBackdrop.classList.remove('open');
  if (window.AndroidNative && typeof window.AndroidNative.simulateTestTransaction === 'function') {
    window.AndroidNative.simulateTestTransaction('CREDIT', 100, 'Test Transfer');
  } else if (typeof ingestAutoList === 'function') {
    ingestAutoList([{ type: 'CREDIT', amount: 100, accountHint: 'UPI', note: 'Received from Test Transfer', tsMs: Date.now() }]);
  }
});
applyPrefs(false);

// 4. BACKDATE, VOICE, MASK & STORAGE
function toDateTimeLocalValue(dateObj) {
  const d = dateObj instanceof Date && !isNaN(dateObj) ? dateObj : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toggleBackdateBar(forceOpen = null) {
  const willOpen = forceOpen !== null ? forceOpen : !backdateBar.classList.contains('show');
  backdateBar.classList.toggle('show', willOpen);
  backdateToggleBtn.classList.toggle('active', willOpen);
  if (willOpen) { if (!customEntryDt.value) customEntryDt.value = toDateTimeLocalValue(new Date()); cmdInput.focus(); }
  else customEntryDt.value = '';
}
backdateToggleBtn.addEventListener('click', () => toggleBackdateBar());
document.getElementById('open-past-entry-btn').addEventListener('click', () => toggleBackdateBar(true));
clearBackdateBtn.addEventListener('click', () => toggleBackdateBar(false));

window.onVoiceResult = function(t) { micBtn.classList.remove('listening'); cmdInput.value = t; cmdInput.focus(); };
window.onVoiceError = function() { micBtn.classList.remove('listening'); if (typeof showNotice === 'function') showNotice('Voice input failed, please try again.', 'warn'); };
micBtn.addEventListener('click', () => {
  micBtn.classList.add('listening');
  if (window.AndroidNative && typeof window.AndroidNative.startVoiceInput === 'function') window.AndroidNative.startVoiceInput();
  else micBtn.classList.remove('listening');
});

let isMasked = false;
try { isMasked = localStorage.getItem(MASK_PREF_KEY) === '1'; } catch (e) {}
maskToggle.textContent = isMasked ? 'Show' : 'Hide';
maskToggle.addEventListener('click', () => {
  isMasked = !isMasked;
  try { localStorage.setItem(MASK_PREF_KEY, isMasked ? '1' : '0'); } catch (e) {}
  maskToggle.textContent = isMasked ? 'Show' : 'Hide';
  if (typeof renderWalletDeck === 'function') renderWalletDeck();
});

function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}
function createDefaultState() { return { setupComplete: false, upiAccounts: [], cashBalance: 0, transactions: [], friends: {}, nextId: 1 }; }
function parseLegacyTsToMs(tsStr, fallbackId = 1) {
  if (!tsStr) return Date.now() - fallbackId * 1000;
  const m = String(tsStr).match(/(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
  if (!m) return Date.now();
  const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const mon = months[m[2].toLowerCase()]; if (mon === undefined) return Date.now();
  let yr = new Date().getFullYear(); if (m[3]) yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  return new Date(yr, mon, parseInt(m[1], 10), parseInt(m[4], 10), parseInt(m[5], 10)).getTime();
}
function formatTsFromDate(d) {
  const dt = d instanceof Date && !isNaN(d) ? d : new Date();
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) + ' ' +
         dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState();
  const upiAccounts = Array.isArray(raw.upiAccounts)
    ? raw.upiAccounts.map((a, idx) => ({ id: a.id || `upi_${idx + 1}`, name: String(a.name || `UPI_${idx + 1}`).trim(), balance: Number(a.balance) || 0 }))
    : [];
  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions.map(t => ({ ...t, tsMs: Number(t.tsMs) || parseLegacyTsToMs(t.ts, t.id) }))
    : [];
  transactions.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  return {
    setupComplete: Boolean(raw.setupComplete && upiAccounts.length > 0), upiAccounts,
    cashBalance: Number(raw.cashBalance) || 0, transactions,
    friends: raw.friends && typeof raw.friends === 'object' ? raw.friends : {},
    nextId: Number(raw.nextId) || 1
  };
}
function computeStateChecksum(st) {
  return fnv1aHash(JSON.stringify({
    setupComplete: st.setupComplete, upiAccounts: st.upiAccounts,
    cashBalance: Number(st.cashBalance.toFixed(2)), transactions: st.transactions,
    friends: st.friends, nextId: st.nextId
  }));
}
function wrapEnvelope(stateObj, rev, source = 'local') {
  const normalized = normalizeState(stateObj);
  return { schema: 5, rev, updatedAt: Date.now(), source, checksum: computeStateChecksum(normalized), payload: normalized };
}
function verifyEnvelope(env) { return Boolean(env && typeof env === 'object' && env.payload && computeStateChecksum(normalizeState(env.payload)) === env.checksum); }

class StorageEngine {
  constructor() { this.db = null; this.currentRev = 0; this.idbReadyPromise = this._openIDB(); }
  _openIDB() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      try {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = (e) => { if (!e.target.result.objectStoreNames.contains(IDB_STORE_NAME)) e.target.result.createObjectStore(IDB_STORE_NAME, { keyPath: 'slot' }); };
        req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  readL1Envelope() {
    const list = [];
    [L1_PRIMARY_KEY, L1_BACKUP_KEY].forEach(k => { try { const raw = localStorage.getItem(k); if (raw) { const p = JSON.parse(raw); if (verifyEnvelope(p)) list.push(p); } } catch (e) {} });
    return list.sort((a, b) => b.rev - a.rev)[0] || null;
  }
  writeL1Envelope(env) {
    try { const prev = localStorage.getItem(L1_PRIMARY_KEY); if (prev) localStorage.setItem(L1_BACKUP_KEY, prev); localStorage.setItem(L1_PRIMARY_KEY, JSON.stringify(env)); } catch (e) {}
  }
  async readL2Envelope() {
    await this.idbReadyPromise; if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const req = this.db.transaction(IDB_STORE_NAME, 'readonly').objectStore(IDB_STORE_NAME).getAll();
        req.onsuccess = () => { resolve((req.result || []).map(r => r.envelope).filter(verifyEnvelope).sort((a, b) => b.rev - a.rev)[0] || null); };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async writeL2Envelope(env) {
    await this.idbReadyPromise; if (!this.db) return;
    return new Promise((resolve) => {
      try { const tx = this.db.transaction(IDB_STORE_NAME, 'readwrite'); tx.objectStore(IDB_STORE_NAME).put({ slot: 'mirror_latest', envelope: env }); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch (e) { resolve(); }
    });
  }
  async loadAndHeal() {
    const l1 = this.readL1Envelope(), l2 = await this.readL2Envelope();
    let chosen = (l1 && l2) ? (l1.rev >= l2.rev ? l1 : l2) : (l1 || l2);
    if (!chosen) chosen = wrapEnvelope(createDefaultState(), 1, 'genesis');
    this.writeL1Envelope(chosen); await this.writeL2Envelope(chosen);
    this.currentRev = chosen.rev; return normalizeState(chosen.payload);
  }
  async commit(stateObj, source = 'mutator') {
    const env = wrapEnvelope(stateObj, this.currentRev + 1, source);
    this.currentRev = env.rev; this.writeL1Envelope(env); await this.writeL2Envelope(env); return env;
  }
}

const storageEngine = new StorageEngine();
let state = createDefaultState();
let activeCardIdx = 0;
let activeFilter = 'all', activeDateQuery = '';

function runDailyAutoBackup(force = false) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (!force && localStorage.getItem(LAST_BKP_KEY) === today) return null;
    const jsonStr = JSON.stringify(state);
    localStorage.setItem('cashflow_os_daily_snapshot_' + today, jsonStr);
    localStorage.setItem(LAST_BKP_KEY, today);
    if (window.AndroidNative && typeof window.AndroidNative.saveDailyBackup === 'function') return window.AndroidNative.saveDailyBackup(jsonStr);
    return 'LocalStorage (' + today + ')';
  } catch (e) { return null; }
}
async function persistState(reason = 'cmd') {
  await storageEngine.commit(state, reason);
  if (typeof renderWalletDeck === 'function') renderWalletDeck();
  runDailyAutoBackup(true);
}
function formatMoney(n, allowMask = false) { return (allowMask && isMasked) ? '₹••••' : ('₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
    
