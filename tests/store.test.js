import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyDoc, localAdapter, parseBackup, toBackup, normalizeSettings } from '../js/store.js';
import { summarize, DEFAULT_SETTINGS } from '../js/calc.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `expected ${expected}, got ${actual}`);

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

let counter = 0;
const newId = () => `id-${++counter}`;

// A trade exactly as the original v1 saved it: strings, position size, no id, no riskAmount.
const v1Trade = (over = {}) => ({
  pair: 'EURUSD', date: '2026-11-10T10:00', direction: 'Long', riskPercent: '1',
  entry: '1.1', stopLoss: '1.097', takeProfit: '1.109',
  positionSize: '33333.333333333333333333333333', rMultiple: '3',
  setup: 'Breakout', session: 'London', emotion: 5, followedPlan: 'Yes', notes: '', result: 'Win', exitPrice: null,
  ...over,
});

const v1Storage = (trades) => memoryStorage({
  golden_trades: JSON.stringify(trades),
  golden_balance: '10000',
  golden_settings: JSON.stringify({ maxTradesPerDay: 3, maxDailyLossPercent: 2, tiltLossThreshold: 2, tiltBreakMinutes: 30 }),
  golden_streak: JSON.stringify({ currentStreak: 4, lastTradeDate: '2026-11-10', longestStreak: 6 }),
  golden_tilt: JSON.stringify({ isActive: false, consecutiveLosses: 0, breakEndTime: null, activatedAt: null }),
});

test('Podaci iz v1 se preuzimaju: rizik u $ se obnavlja iz Risk % i PnL je tačan', async () => {
  const storage = v1Storage([v1Trade(), v1Trade({ result: 'Loss', date: '2026-11-11T10:00' })]);
  const before = storage.getItem('golden_trades');
  const { doc, skipped, source } = await localAdapter(storage, newId).load();

  assert.equal(source, 'legacy');
  assert.equal(skipped, 0);
  assert.equal(doc.startingBalance, 10000);
  assert.equal(doc.trades.length, 2);
  near(doc.trades[0].riskAmount, 100);
  near(doc.trades[1].riskAmount, 103, 'drugi trade rizikuje 1% od 10.300 $');
  assert.equal(doc.trades[0].followedPlan, true);
  assert.ok(doc.trades[0].id && doc.trades[0].id !== doc.trades[1].id);
  near(summarize(doc.trades, doc.startingBalance).netPnL, 197);
  assert.deepEqual(doc.settings, { maxTradesPerDay: 3, maxDailyLossPercent: 2, tiltLossThreshold: 2, tiltBreakMinutes: 30 });
  assert.equal(storage.getItem('golden_trades'), before, 'v1 podaci ostaju netaknuti');
});

test('v1 trade bez smera se čita kao Sell, kao što ga je v1 računala', async () => {
  const storage = v1Storage([v1Trade({ direction: '', entry: '1.1', stopLoss: '1.105', takeProfit: '1.09', positionSize: '20000', setup: '', session: '' })]);
  const { doc } = await localAdapter(storage, newId).load();
  assert.equal(doc.trades[0].direction, 'Short');
  assert.equal(doc.trades[0].setup, '');
  near(summarize(doc.trades, 10000).netPnL, 200);
});

test('v1 je naduvavala balans: njena veličina pozicije se ne koristi za rizik u $', async () => {
  // What the live v1 really stores: after a 3R win it believed the balance was 110.000 $
  // (10.000 + 3 x 33.333 "units"), so the next 1% trade got a position size of 366.666.
  const storage = v1Storage([
    v1Trade({ date: '2026-11-10T10:00' }),
    v1Trade({ date: '2026-11-11T10:00', result: 'Loss', positionSize: '366666.66666666666666666667' }),
    v1Trade({ date: '2026-11-12T10:00', positionSize: '6666.6666666666666666666667' }),
  ]);
  const { doc } = await localAdapter(storage, newId).load();
  near(doc.trades[0].riskAmount, 100);
  near(doc.trades[1].riskAmount, 103); // not 1.100
  near(doc.trades[2].riskAmount, 101.97); // 1% of 10.197, not 20
  near(summarize(doc.trades, 10000).balance, 10000 + 300 - 103 + 305.91);
});

test('Redosled unosa određuje rizik, ne datum trade-a', async () => {
  // Recorded first but dated later: it still risked 1% of the starting balance.
  const storage = v1Storage([
    v1Trade({ date: '2026-11-20T10:00' }),
    v1Trade({ date: '2026-11-05T10:00', result: 'Loss' }),
  ]);
  const { doc } = await localAdapter(storage, newId).load();
  near(doc.trades[0].riskAmount, 100);
  near(doc.trades[1].riskAmount, 103);
});

test('Posle čuvanja se čita v2 zapis, a ne ponovo v1', async () => {
  const storage = v1Storage([v1Trade()]);
  const adapter = localAdapter(storage, newId);
  const { doc } = await adapter.load();
  doc.trades = [];
  await adapter.save(doc);
  const again = await adapter.load();
  assert.equal(again.source, 'v2');
  assert.equal(again.doc.trades.length, 0);
});

test('Reset ne vraća stare v1 podatke', async () => {
  const storage = v1Storage([v1Trade()]);
  const adapter = localAdapter(storage, newId);
  await adapter.save(emptyDoc());
  const { doc, source } = await adapter.load();
  assert.equal(source, 'v2');
  assert.equal(doc.startingBalance, null);
  assert.equal(doc.trades.length, 0);
});

test('Prazan browser daje prazan dnevnik', async () => {
  const { doc, source } = await localAdapter(memoryStorage(), newId).load();
  assert.equal(source, 'empty');
  assert.deepEqual(doc, emptyDoc());
});

test('Oštećen zapis se ne briše: čuva se kopija i kreće se od praznog dnevnika', async () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
  const { doc, source } = await localAdapter(storage, newId).load();
  assert.equal(source, 'corrupt');
  assert.equal(doc.startingBalance, null);
  assert.equal(storage.getItem(`${STORAGE_KEY}:corrupt`), '{not json');
});

test('Backup iz v1 se učitava', () => {
  const backup = JSON.stringify({
    trades: [v1Trade(), v1Trade({ date: '2026-11-10T10:00' })],
    startingBalance: '10000',
    settings: { maxTradesPerDay: 5, maxDailyLossPercent: 5, tiltLossThreshold: 3, tiltBreakMinutes: 15 },
    streakData: {}, tiltState: { isActive: true, breakEndTime: 123456 }, backupDate: '2026-11-12T00:00:00.000Z',
  });
  const { doc, skipped } = parseBackup(backup, newId);
  assert.equal(skipped, 0);
  assert.equal(doc.trades.length, 2);
  assert.notEqual(doc.trades[0].id, doc.trades[1].id);
  assert.equal(doc.tilt.activeUntil, 123456);
});

test('Backup iz v2 se vraća u isto stanje', () => {
  const { doc } = parseBackup(JSON.stringify({ trades: [v1Trade()], startingBalance: 10000 }), newId);
  const file = JSON.stringify(toBackup(doc, 1_800_000_000_000));
  const restored = parseBackup(file, newId);
  assert.deepEqual(restored.doc, doc);
  assert.equal(JSON.parse(file).app, 'golden-trading-journal');
});

test('Trade bez ispravnih cena ili bez Risk % se preskače i broji, ostali se učitavaju', () => {
  const backup = JSON.stringify({ startingBalance: 10000, trades: [v1Trade(), v1Trade({ entry: 'abc' }), v1Trade({ riskPercent: '' })] });
  const { doc, skipped } = parseBackup(backup, newId);
  assert.equal(doc.trades.length, 1);
  assert.equal(skipped, 2);
});

test('Dupli ID-jevi u backup-u dobijaju nove', () => {
  const backup = JSON.stringify({ startingBalance: 10000, trades: [v1Trade({ id: 'same', riskAmount: '100' }), v1Trade({ id: 'same', riskAmount: '100' })] });
  const { doc } = parseBackup(backup, newId);
  assert.equal(doc.trades[0].id, 'same');
  assert.notEqual(doc.trades[1].id, 'same');
});

test('Neispravan fajl se odbija sa jasnom porukom', () => {
  assert.throws(() => parseBackup('nije json', newId), /nije ispravan JSON/);
  assert.throws(() => parseBackup('{"foo":1}', newId), /nije backup dnevnika/);
  assert.throws(() => parseBackup('{"trades":[]}', newId), /nema početni balans/);
});

test('Podešavanja van granica se vraćaju na podrazumevana', () => {
  assert.deepEqual(normalizeSettings({ maxTradesPerDay: 0, maxDailyLossPercent: -1, tiltLossThreshold: 'x', tiltBreakMinutes: 99999 }), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
});
