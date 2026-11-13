// Trade records: validating form input, creating and editing trades,
// and reading trades saved by this version or by v1.

import { SETUPS, SESSIONS, RESULTS, clean, rMultiple } from './calc.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_NOTES = 1000;

const toNumber = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return NaN;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
};

const toPlanFlag = (value) => {
  if (value === true || value === 'yes' || value === 'Yes') return true;
  if (value === false || value === 'no' || value === 'No') return false;
  return null;
};

/**
 * Checks raw form values. Returns { ok, errors, values } where `errors` maps a field
 * name to a message and `values` holds the cleaned, typed fields.
 */
export function validateTrade(raw) {
  const errors = {};
  const exitText = String(raw.exitPrice ?? '').trim();
  const values = {
    pair: String(raw.pair ?? '').trim().toUpperCase(),
    date: String(raw.date ?? '').trim(),
    direction: raw.direction,
    riskPercent: toNumber(raw.riskPercent),
    entry: toNumber(raw.entry),
    stopLoss: toNumber(raw.stopLoss),
    takeProfit: toNumber(raw.takeProfit),
    exitPrice: exitText === '' ? null : toNumber(exitText),
    setup: raw.setup,
    session: raw.session,
    emotion: toNumber(raw.emotion),
    followedPlan: toPlanFlag(raw.followedPlan),
    result: raw.result || null,
    notes: String(raw.notes ?? '').trim(),
  };
  const { direction, entry, stopLoss, takeProfit, exitPrice } = values;

  if (!values.pair) errors.pair = 'Unesi par, na primer EURUSD.';
  else if (values.pair.length > 20) errors.pair = 'Par može imati najviše 20 znakova.';

  if (!DATE_PATTERN.test(values.date)) errors.date = 'Unesi datum i vreme.';

  const directionOk = direction === 'Long' || direction === 'Short';
  if (!directionOk) errors.direction = 'Izaberi Buy ili Sell.';

  if (!(values.riskPercent > 0 && values.riskPercent <= 100)) {
    errors.riskPercent = 'Rizik mora biti veći od 0 i najviše 100%.';
  }

  if (!(entry > 0)) errors.entry = 'Unesi Entry cenu veću od nule.';

  if (!(stopLoss > 0)) errors.stopLoss = 'Unesi Stop Loss veći od nule.';
  else if (directionOk && entry > 0) {
    if (direction === 'Long' && stopLoss >= entry) errors.stopLoss = 'Za Buy, Stop Loss mora biti ispod Entry cene.';
    if (direction === 'Short' && stopLoss <= entry) errors.stopLoss = 'Za Sell, Stop Loss mora biti iznad Entry cene.';
  }

  if (!(takeProfit > 0)) errors.takeProfit = 'Unesi Take Profit veći od nule.';
  else if (directionOk && entry > 0) {
    if (direction === 'Long' && takeProfit <= entry) errors.takeProfit = 'Za Buy, Take Profit mora biti iznad Entry cene.';
    if (direction === 'Short' && takeProfit >= entry) errors.takeProfit = 'Za Sell, Take Profit mora biti ispod Entry cene.';
  }

  if (exitPrice !== null && !(exitPrice > 0)) errors.exitPrice = 'Exit Price mora biti veći od nule.';

  if (!SETUPS.includes(values.setup)) errors.setup = 'Izaberi setup.';
  if (!SESSIONS.includes(values.session)) errors.session = 'Izaberi sesiju.';

  if (!(Number.isInteger(values.emotion) && values.emotion >= 1 && values.emotion <= 10)) {
    errors.emotion = 'Emocije su na skali od 1 do 10.';
  }

  if (values.followedPlan === null) errors.followedPlan = 'Označi da li je trade bio po planu.';

  // The result may be left empty only when an exit price lets us read it off the trade.
  const pricesOk = !errors.direction && !errors.entry && !errors.stopLoss && !errors.exitPrice;
  const exitR = pricesOk && exitPrice !== null ? rMultiple(entry, stopLoss, exitPrice, direction) : null;
  if (!values.result) {
    if (exitR === null) errors.result = 'Izaberi Result ili unesi Exit Price.';
    else values.result = exitR > 0 ? 'Win' : exitR < 0 ? 'Loss' : 'BE';
  } else if (!RESULTS.includes(values.result)) {
    errors.result = 'Izaberi Win, Loss ili BE.';
  } else if (exitR !== null) {
    if (values.result === 'Win' && exitR <= 0) errors.result = 'Win se ne slaže sa Exit cenom: izlaz nije u plusu.';
    if (values.result === 'Loss' && exitR >= 0) errors.result = 'Loss se ne slaže sa Exit cenom: izlaz nije u minusu.';
  }

  if (values.notes.length > MAX_NOTES) errors.notes = `Napomena može imati najviše ${MAX_NOTES} znakova.`;

  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** New trade. The dollar risk is fixed here, from the balance at the moment of recording. */
export function createTrade(values, balance, { id, createdAt }) {
  return { id, createdAt, ...values, riskAmount: clean((balance * values.riskPercent) / 100) };
}

/**
 * Edited trade. Changing prices never changes the dollars that were at risk;
 * changing Risk % scales them, which keeps the original balance as the basis.
 */
export function applyEdit(existing, values) {
  const riskAmount = existing.riskPercent > 0
    ? clean((existing.riskAmount * values.riskPercent) / existing.riskPercent)
    : existing.riskAmount;
  return { ...existing, ...values, riskAmount };
}

/**
 * Reads one saved trade (v2 or v1 shape) into the v2 shape.
 * Returns null when the prices are unusable, or when there is neither a stored
 * dollar risk nor a Risk % to rebuild it from: such a trade would corrupt every statistic.
 */
export function normalizeTrade(raw, order = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const entry = toNumber(raw.entry);
  const stopLoss = toNumber(raw.stopLoss);
  const takeProfit = toNumber(raw.takeProfit);
  const date = String(raw.date ?? '');
  if (!(entry > 0) || !(stopLoss > 0) || !(takeProfit > 0) || entry === stopLoss) return null;
  if (!DATE_PATTERN.test(date)) return null;

  // v1 never stored the dollars at risk. Its position size cannot be trusted either,
  // because it came from a balance inflated by v1's own PnL bug. Such trades get
  // riskAmount: null here and the store rebuilds it from Risk % (see rebuildRisk).
  const riskPercent = toNumber(raw.riskPercent);
  const storedRisk = toNumber(raw.riskAmount);
  const riskAmount = storedRisk > 0 ? storedRisk : null;
  if (riskAmount === null && !(riskPercent > 0)) return null;

  const exitPrice = raw.exitPrice == null || raw.exitPrice === '' ? NaN : toNumber(raw.exitPrice);
  const emotion = Math.round(toNumber(raw.emotion));

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : order,
    pair: String(raw.pair ?? '').trim().toUpperCase(),
    date,
    direction: raw.direction === 'Long' ? 'Long' : 'Short', // v1 treated anything else as Short
    riskPercent: riskPercent > 0 ? riskPercent : 0,
    riskAmount,
    entry,
    stopLoss,
    takeProfit,
    exitPrice: exitPrice > 0 ? exitPrice : null,
    setup: SETUPS.includes(raw.setup) ? raw.setup : '',
    session: SESSIONS.includes(raw.session) ? raw.session : '',
    emotion: emotion >= 1 && emotion <= 10 ? emotion : 5,
    followedPlan: toPlanFlag(raw.followedPlan) === true,
    result: RESULTS.includes(raw.result) ? raw.result : 'BE',
    notes: String(raw.notes ?? ''),
  };
}
