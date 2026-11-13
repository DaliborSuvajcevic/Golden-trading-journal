// Journal document: its shape, reading v1 data, backups, and the storage adapter.
//
// The app only talks to an adapter with async load() and save(doc). Today that is
// localStorage; a database adapter with the same two methods can replace it later
// without touching the rest of the code.

import { DEFAULT_SETTINGS, clean, tradePnL } from './calc.js';
import { normalizeTrade } from './trade.js';

export const APP_ID = 'golden-trading-journal';
export const SCHEMA = 2;
export const STORAGE_KEY = 'gtj:v2';

// v1 kept everything under these keys. They are only ever read, never changed.
const LEGACY = {
  trades: 'golden_trades',
  balance: 'golden_balance',
  settings: 'golden_settings',
  tilt: 'golden_tilt',
};

export const emptyDoc = () => ({
  schema: SCHEMA,
  startingBalance: null, // null means the journal has not been started yet
  settings: { ...DEFAULT_SETTINGS },
  tilt: { activeUntil: null, servedLossId: null },
  trades: [],
});

const wholeNumber = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function normalizeSettings(raw = {}) {
  const loss = Number(raw?.maxDailyLossPercent);
  return {
    maxTradesPerDay: wholeNumber(raw?.maxTradesPerDay, DEFAULT_SETTINGS.maxTradesPerDay, 1, 1000),
    maxDailyLossPercent: loss > 0 && loss <= 100 ? loss : DEFAULT_SETTINGS.maxDailyLossPercent,
    tiltLossThreshold: wholeNumber(raw?.tiltLossThreshold, DEFAULT_SETTINGS.tiltLossThreshold, 1, 100),
    tiltBreakMinutes: wholeNumber(raw?.tiltBreakMinutes, DEFAULT_SETTINGS.tiltBreakMinutes, 1, 1440),
  };
}

function normalizeTilt(raw = {}) {
  // v2: { activeUntil }. v1: { isActive, breakEndTime }.
  let activeUntil = Number.isFinite(raw?.activeUntil) ? raw.activeUntil : null;
  if (activeUntil === null && raw?.isActive && Number.isFinite(raw?.breakEndTime)) activeUntil = raw.breakEndTime;
  return {
    activeUntil,
    servedLossId: typeof raw?.servedLossId === 'string' ? raw.servedLossId : null,
  };
}

/**
 * Gives v1 trades their dollars at risk.
 *
 * v1 applied Risk % to "the current balance", but that balance was built from its
 * inflated PnL, so nothing it stored can be used directly. The trades array is in the
 * order the trades were recorded, so we replay it: each trade risks its Risk % of the
 * balance as this version calculates it at that point. That is what v1 meant to do.
 */
function rebuildRisk(trades, startingBalance) {
  let balance = startingBalance ?? 0;
  for (const trade of trades) {
    if (trade.riskAmount === null) {
      trade.riskAmount = Math.max(0, clean((balance * trade.riskPercent) / 100));
    }
    balance = clean(balance + tradePnL(trade));
  }
}

/**
 * Turns saved data (v2 or v1) into a clean v2 document.
 * Returns { doc, skipped }, where `skipped` counts trades that could not be read.
 */
export function normalizeDoc(raw, newId) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.trades)) {
    throw new Error('Fajl nije backup dnevnika.');
  }
  const seen = new Set();
  const trades = [];
  let skipped = 0;
  raw.trades.forEach((item, index) => {
    const trade = normalizeTrade(item, index);
    if (!trade) {
      skipped += 1;
      return;
    }
    if (!trade.id || seen.has(trade.id)) trade.id = newId();
    seen.add(trade.id);
    trades.push(trade);
  });

  const balance = Number(raw.startingBalance);
  const startingBalance = raw.startingBalance != null && balance > 0 ? balance : null;
  rebuildRisk(trades, startingBalance);
  return {
    doc: {
      schema: SCHEMA,
      startingBalance,
      settings: normalizeSettings(raw.settings),
      tilt: normalizeTilt(raw.tilt ?? raw.tiltState),
      trades,
    },
    skipped,
  };
}

/** Wraps the document for download. */
export const toBackup = (doc, now) => ({
  app: APP_ID,
  schema: SCHEMA,
  exportedAt: new Date(now).toISOString(),
  data: doc,
});

/** Reads a backup file made by v2 or by v1. Throws with a message meant for the user. */
export function parseBackup(text, newId) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Fajl nije ispravan JSON.');
  }
  const payload = parsed?.app === APP_ID && parsed.data ? parsed.data : parsed;
  const result = normalizeDoc(payload, newId);
  if (result.doc.startingBalance === null) throw new Error('Backup nema početni balans.');
  return result;
}

function readLegacy(storage, newId) {
  const balance = storage.getItem(LEGACY.balance);
  if (balance === null) return null;
  const parse = (key, fallback) => {
    try {
      return JSON.parse(storage.getItem(key) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  };
  const trades = parse(LEGACY.trades, []);
  return normalizeDoc(
    {
      startingBalance: balance,
      trades: Array.isArray(trades) ? trades : [],
      settings: parse(LEGACY.settings, {}),
      tiltState: parse(LEGACY.tilt, {}),
    },
    newId,
  );
}

/**
 * localStorage adapter.
 * load() resolves to { doc, skipped, source } with source one of:
 * 'v2' (saved by this version), 'legacy' (taken over from v1), 'empty', 'corrupt'.
 */
export function localAdapter(storage, newId) {
  return {
    async load() {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved !== null) {
        try {
          return { ...normalizeDoc(JSON.parse(saved), newId), source: 'v2' };
        } catch {
          // Keep the unreadable data so it can be inspected instead of being overwritten.
          storage.setItem(`${STORAGE_KEY}:corrupt`, saved);
          return { doc: emptyDoc(), skipped: 0, source: 'corrupt' };
        }
      }
      const legacy = readLegacy(storage, newId);
      if (legacy) return { ...legacy, source: 'legacy' };
      return { doc: emptyDoc(), skipped: 0, source: 'empty' };
    },
    async save(doc) {
      storage.setItem(STORAGE_KEY, JSON.stringify(doc));
    },
  };
}
