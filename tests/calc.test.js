import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, tradePnL, realizedR, plannedR, summarize, breakdown, dailyGoals,
  dailyTotals, lossStreak, disciplineStreak, updateTilt, SESSIONS,
} from '../js/calc.js';
import { validateTrade, createTrade, applyEdit } from '../js/trade.js';
import { buildInsights } from '../js/insights.js';

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `expected ${expected}, got ${actual}`);

let seq = 0;
const trade = (over = {}) => ({
  id: `t${++seq}`, createdAt: seq, pair: 'EURUSD', date: '2026-11-10T10:00', direction: 'Long',
  riskPercent: 1, riskAmount: 100, entry: 1.1, stopLoss: 1.097, takeProfit: 1.109, exitPrice: null,
  setup: 'Breakout', session: 'London', emotion: 5, followedPlan: true, result: 'Win', notes: '',
  ...over,
});
const loss = (date, over = {}) => trade({ result: 'Loss', date, ...over });

// --- PnL ---------------------------------------------------------------------

test('Win 3R na 1% od 10.000 $ je +300 $', () => {
  near(plannedR(trade()), 3);
  near(tradePnL(trade()), 300);
});

test('Loss bez Exit cene je -1R, to jest -100 $', () => {
  near(tradePnL(trade({ result: 'Loss' })), -100);
});

test('BE je uvek 0 $', () => {
  near(tradePnL(trade({ result: 'BE', exitPrice: 1.1002 })), 0);
});

test('Sell: Win 2R na 200 $ rizika je +400 $', () => {
  const t = trade({ direction: 'Short', riskAmount: 200, entry: 1.1, stopLoss: 1.105, takeProfit: 1.09 });
  near(tradePnL(t), 400);
});

test('Exit cena ima prednost: delimičan gubitak je -0.5R, ranije zatvoren Win je 2R', () => {
  near(realizedR(trade({ result: 'Loss', exitPrice: 1.0985 })), -0.5);
  near(tradePnL(trade({ result: 'Loss', exitPrice: 1.0985 })), -50);
  near(tradePnL(trade({ result: 'Win', exitPrice: 1.106 })), 200);
});

// --- Summary -------------------------------------------------------------------

test('Zbir: balans, win rate, prosečan R i drawdown, bez obzira na redosled unosa', () => {
  const trades = [
    loss('2026-11-12T10:00'),
    trade({ date: '2026-11-10T10:00' }),
    loss('2026-11-11T10:00'),
    trade({ date: '2026-11-13T10:00', result: 'BE' }),
  ];
  const s = summarize(trades, 10000);
  near(s.netPnL, 100);
  near(s.balance, 10100);
  near(s.winRate, 25);
  near(s.avgR, (3 - 1 - 1 + 0) / 4);
  near(s.maxDrawdown, 200);
  near(s.maxDrawdownPercent, (200 / 10300) * 100);
  assert.deepEqual(s.curve.map((p) => p.balance), [10300, 10200, 10100, 10100]);
  assert.equal(s.wins + s.losses + s.breakevens, s.count);
});

test('Prazan dnevnik: sve je nula i balans je početni', () => {
  const s = summarize([], 5000);
  assert.deepEqual([s.count, s.netPnL, s.winRate, s.avgR, s.maxDrawdown, s.balance], [0, 0, 0, 0, 0, 5000]);
});

test('Analitika po sesiji daje isti zbir kao ukupan PnL', () => {
  const trades = [trade(), loss('2026-11-10T12:00', { session: 'Asia' }), trade({ result: 'BE', session: 'Asia' })];
  const groups = breakdown(trades, 'session', SESSIONS);
  near(groups.reduce((sum, g) => sum + g.pnl, 0), summarize(trades, 10000).netPnL);
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Asia', 2], ['London', 1]]);
});

// --- Days ----------------------------------------------------------------------

test('Trade u 00:30 pripada svom danu', () => {
  const totals = dailyTotals([trade({ date: '2026-11-10T00:30' })]);
  assert.deepEqual([...totals.keys()], ['2026-11-10']);
});

test('Dnevni gubitak se meri prema balansu na početku dana', () => {
  const trades = [trade({ date: '2026-11-09T10:00' }), loss('2026-11-10T09:00'), loss('2026-11-10T11:00', { followedPlan: false })];
  const g = dailyGoals(trades, 10000, DEFAULT_SETTINGS, '2026-11-10');
  assert.equal(g.tradesCount, 2);
  near(g.lossPercent, (200 / 10300) * 100);
  assert.equal(g.planFollowed, 1);
  assert.equal(g.lossLimitReached, false);
  assert.equal(g.tradesLimitReached, false);
});

test('Dani discipline: dan bez trade-ova ne prekida niz, trade van plana prekida', () => {
  const days = [
    trade({ date: '2026-11-06T10:00' }), // petak
    trade({ date: '2026-11-09T10:00' }), // ponedeljak, vikend ne prekida
    trade({ date: '2026-11-10T10:00' }),
  ];
  assert.deepEqual(disciplineStreak(days), { current: 3, longest: 3 });
  const broken = [...days, trade({ date: '2026-11-11T10:00' }), trade({ date: '2026-11-11T15:00', followedPlan: false })];
  assert.deepEqual(disciplineStreak(broken), { current: 0, longest: 3 });
});

// --- Tilt ----------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const BREAK = DEFAULT_SETTINGS.tiltBreakMinutes * 60_000;
const idle = { activeUntil: null, servedLossId: null };
const threeLosses = () => [loss('2026-11-10T10:00'), loss('2026-11-10T11:00'), loss('2026-11-10T12:00')];
const tilt = (state, trades, now, canActivate) => updateTilt(state, trades, DEFAULT_SETTINGS, now, { canActivate });

test('Tilt: tri gubitka zaredom zaključavaju unos', () => {
  const trades = threeLosses();
  assert.equal(lossStreak(trades), 3);
  assert.equal(tilt(idle, trades, NOW, true).activeUntil, NOW + BREAK);
  assert.equal(tilt(idle, trades.slice(0, 2), NOW, true).activeUntil, null);
});

test('Tilt: pauza ističe i ista serija ne zaključava ponovo', () => {
  const trades = threeLosses();
  const active = tilt(idle, trades, NOW, true);
  assert.equal(tilt(active, trades, NOW + BREAK - 1, false).activeUntil, NOW + BREAK, 'pre isteka ostaje aktivna');
  const after = tilt(active, trades, NOW + BREAK, false);
  assert.equal(after.activeUntil, null);
  assert.equal(tilt(after, trades, NOW + BREAK + 1, true).activeUntil, null);
});

test('Tilt: posle pauze sledeći gubitak odmah zaključava', () => {
  const trades = threeLosses();
  let state = tilt(idle, trades, NOW, true);
  state = tilt(state, trades, NOW + BREAK, false);
  state = tilt(state, [...trades, loss('2026-11-10T14:00')], NOW + BREAK + 1, true);
  assert.equal(state.activeUntil, NOW + BREAK + 1 + BREAK);
});

test('Tilt: Win prekida seriju, nova serija opet traži tri gubitka', () => {
  const first = threeLosses();
  let state = tilt(idle, first, NOW, true);
  state = tilt(state, first, NOW + BREAK, false);
  const two = [...first, trade({ date: '2026-11-10T14:00' }), loss('2026-11-10T15:00'), loss('2026-11-10T16:00')];
  state = tilt(state, two, NOW + BREAK + 1, true);
  assert.equal(state.activeUntil, null, 'dva gubitka posle Win-a ne zaključavaju');
  state = tilt(state, [...two, loss('2026-11-10T17:00')], NOW + BREAK + 2, true);
  assert.equal(state.activeUntil, NOW + BREAK + 2 + BREAK, 'treći gubitak nove serije zaključava');
});

test('Tilt: stari podaci pri učitavanju ne pokreću pauzu, a nevezana izmena kasnije takođe ne', () => {
  const trades = threeLosses();
  const loaded = tilt(idle, trades, NOW, false);
  assert.equal(loaded.activeUntil, null);
  assert.equal(tilt(loaded, trades, NOW + 1, true).activeUntil, null);
});

test('Tilt: ispravka pogrešno unetog gubitka skida pauzu', () => {
  const trades = threeLosses();
  const active = tilt(idle, trades, NOW, true);
  assert.equal(tilt(active, trades.slice(0, 2), NOW + 1000, true).activeUntil, null);
});

// --- Validation ------------------------------------------------------------------

const form = (over = {}) => ({
  pair: ' eurusd ', date: '2026-11-10T10:00', direction: 'Long', riskPercent: '1', entry: '1.1000',
  stopLoss: '1.0970', takeProfit: '1.1090', exitPrice: '', setup: 'Breakout', session: 'London',
  emotion: '5', followedPlan: 'yes', result: 'Win', notes: '', ...over,
});

test('Ispravan unos prolazi i čisti vrednosti', () => {
  const { ok, values } = validateTrade(form());
  assert.equal(ok, true);
  assert.equal(values.pair, 'EURUSD');
  assert.equal(values.entry, 1.1);
  assert.equal(values.exitPrice, null);
  assert.equal(values.followedPlan, true);
});

test('Bez smera, setup-a, sesije i plana unos se odbija', () => {
  const { ok, errors } = validateTrade(form({ direction: undefined, setup: undefined, session: undefined, followedPlan: undefined }));
  assert.equal(ok, false);
  assert.deepEqual(Object.keys(errors).sort(), ['direction', 'followedPlan', 'session', 'setup']);
});

test('Stop Loss i Take Profit moraju biti na pravoj strani, za Buy i za Sell', () => {
  assert.ok(validateTrade(form({ stopLoss: '1.1050' })).errors.stopLoss);
  assert.ok(validateTrade(form({ takeProfit: '1.0900' })).errors.takeProfit);
  const sell = { direction: 'Short', stopLoss: '1.1050', takeProfit: '1.0900' };
  assert.equal(validateTrade(form(sell)).ok, true);
  assert.ok(validateTrade(form({ ...sell, stopLoss: '1.0950' })).errors.stopLoss);
  assert.ok(validateTrade(form({ ...sell, takeProfit: '1.1100' })).errors.takeProfit);
});

test('Result se ne pogađa: bez Result-a i bez Exit cene unos se odbija', () => {
  assert.ok(validateTrade(form({ result: '' })).errors.result);
});

test('Result se čita iz Exit cene kada nije izabran', () => {
  assert.equal(validateTrade(form({ result: '', exitPrice: '1.1060' })).values.result, 'Win');
  assert.equal(validateTrade(form({ result: '', exitPrice: '1.0980' })).values.result, 'Loss');
  assert.equal(validateTrade(form({ result: '', exitPrice: '1.1000' })).values.result, 'BE');
});

test('Result koji se ne slaže sa Exit cenom se odbija', () => {
  assert.ok(validateTrade(form({ result: 'Win', exitPrice: '1.0980' })).errors.result);
  assert.ok(validateTrade(form({ result: 'Loss', exitPrice: '1.1060' })).errors.result);
});

test('Rizik, emocije i cene imaju granice', () => {
  assert.ok(validateTrade(form({ riskPercent: '0' })).errors.riskPercent);
  assert.ok(validateTrade(form({ riskPercent: '101' })).errors.riskPercent);
  assert.ok(validateTrade(form({ emotion: '11' })).errors.emotion);
  assert.ok(validateTrade(form({ entry: '' })).errors.entry);
  assert.ok(validateTrade(form({ exitPrice: '-1' })).errors.exitPrice);
});

// --- Creating and editing ----------------------------------------------------------

test('Novi trade fiksira rizik u $ prema balansu u trenutku unosa', () => {
  const t = createTrade(validateTrade(form()).values, 10300, { id: 'a', createdAt: 1 });
  near(t.riskAmount, 103);
  near(tradePnL(t), 309);
});

test('Izmena cena ne menja rizik u $, izmena Risk % ga srazmerno menja', () => {
  const original = createTrade(validateTrade(form()).values, 10000, { id: 'a', createdAt: 1 });
  const moved = applyEdit(original, validateTrade(form({ entry: '1.2000', stopLoss: '1.1940', takeProfit: '1.2180' })).values);
  near(moved.riskAmount, 100);
  near(tradePnL(moved), 300);
  const doubled = applyEdit(original, validateTrade(form({ riskPercent: '2' })).values);
  near(doubled.riskAmount, 200);
  assert.equal(doubled.id, 'a');
});

// --- Insights ----------------------------------------------------------------------

test('Uvidi: ispod 5 trade-ova samo obaveštenje, zatim pravila iz v1', () => {
  assert.equal(buildInsights([trade()], summarize([trade()], 10000))[0].level, 'info');
  const losing = [loss('2026-11-01T10:00'), loss('2026-11-02T10:00'), loss('2026-11-03T10:00'), loss('2026-11-04T10:00'), trade({ date: '2026-11-05T10:00', emotion: 9 })]
    .map((t) => ({ ...t, emotion: 9 }));
  const texts = buildInsights(losing, summarize(losing, 10000)).map((i) => i.text).join(' ');
  assert.match(texts, /Win rate je 20\.0%/);
  assert.match(texts, /London sesija je u minusu/);
  assert.match(texts, /Prosečna emocija je 9\.0\/10/);
});
