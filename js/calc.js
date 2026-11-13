// Pure trading math. No DOM and no storage, so every function here is unit-tested.
//
// Model: each trade stores `riskAmount`, the dollars risked when it was recorded.
// That amount is what 1R is worth, so PnL = realized R x riskAmount.

export const SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Range'];
export const SESSIONS = ['Asia', 'London', 'New York', 'Overlap'];
export const RESULTS = ['Win', 'Loss', 'BE'];

export const DEFAULT_SETTINGS = Object.freeze({
  maxTradesPerDay: 5,
  maxDailyLossPercent: 5,
  tiltLossThreshold: 3,
  tiltBreakMinutes: 15,
});

/** Removes binary floating-point noise (0.1 + 0.2) without touching real precision. */
export const clean = (n) => Math.round(n * 1e10) / 1e10;

/** Calendar day of a trade, taken from the local date-time the user typed. */
export const dayOf = (trade) => trade.date.slice(0, 10);

const total = (list, fn) => clean(list.reduce((acc, item) => acc + fn(item), 0));

/** Price move from entry to `price`, in units of the entry-to-stop distance. */
export function rMultiple(entry, stopLoss, price, direction) {
  const risk = Math.abs(entry - stopLoss);
  const move = direction === 'Long' ? price - entry : entry - price;
  return clean(move / risk);
}

export const plannedR = (trade) =>
  rMultiple(trade.entry, trade.stopLoss, trade.takeProfit, trade.direction);

/**
 * R actually booked. With an exit price it is measured to that exit.
 * Without one, a Win is assumed to reach Take Profit and a Loss to hit the stop (-1R).
 * BE is always 0.
 */
export function realizedR(trade) {
  if (trade.result === 'BE') return 0;
  if (trade.exitPrice != null) {
    return rMultiple(trade.entry, trade.stopLoss, trade.exitPrice, trade.direction);
  }
  return trade.result === 'Win' ? plannedR(trade) : -1;
}

/** The single source of truth for a trade's dollar result. */
export const tradePnL = (trade) => clean(realizedR(trade) * trade.riskAmount);

/** Oldest first; trades in the same minute keep the order they were recorded in. */
export const chronological = (trades) =>
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

export function summarize(trades, startingBalance) {
  let balance = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let sumR = 0;
  const curve = [];

  for (const trade of chronological(trades)) {
    const pnl = tradePnL(trade);
    balance = clean(balance + pnl);
    sumR += realizedR(trade);
    if (trade.result === 'Win') wins += 1;
    else if (trade.result === 'Loss') losses += 1;
    else breakevens += 1;

    if (balance > peak) peak = balance;
    const drawdown = clean(peak - balance);
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = peak > 0 ? clean((drawdown / peak) * 100) : 0;
    }
    curve.push({ id: trade.id, date: trade.date, pnl, balance });
  }

  const count = trades.length;
  return {
    count,
    wins,
    losses,
    breakevens,
    balance,
    netPnL: clean(balance - startingBalance),
    winRate: count ? (wins / count) * 100 : 0,
    avgR: count ? clean(sumR / count) : 0,
    maxDrawdown,
    maxDrawdownPercent,
    curve,
  };
}

/** Per-group results, e.g. breakdown(trades, 'session', SESSIONS). Empty groups are left out. */
export function breakdown(trades, key, names) {
  return names
    .map((name) => {
      const group = trades.filter((trade) => trade[key] === name);
      const wins = group.filter((trade) => trade.result === 'Win').length;
      return {
        name,
        count: group.length,
        winRate: group.length ? (wins / group.length) * 100 : 0,
        pnl: total(group, tradePnL),
      };
    })
    .filter((group) => group.count > 0);
}

export function extremes(groups) {
  if (!groups.length) return null;
  const sorted = [...groups].sort((a, b) => b.pnl - a.pnl);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

export function emotionStats(trades) {
  const average = (list) =>
    list.length ? list.reduce((acc, trade) => acc + trade.emotion, 0) / list.length : 0;
  return {
    all: average(trades),
    wins: average(trades.filter((trade) => trade.result === 'Win')),
    losses: average(trades.filter((trade) => trade.result === 'Loss')),
  };
}

/** Map of day -> { pnl, count } for the calendar. */
export function dailyTotals(trades) {
  const days = new Map();
  for (const trade of trades) {
    const day = days.get(dayOf(trade)) ?? { pnl: 0, count: 0 };
    day.pnl = clean(day.pnl + tradePnL(trade));
    day.count += 1;
    days.set(dayOf(trade), day);
  }
  return days;
}

/** Today's progress against the daily limits. Loss % is measured against the balance at the start of the day. */
export function dailyGoals(trades, startingBalance, settings, today) {
  const todays = trades.filter((trade) => dayOf(trade) === today);
  const earlier = trades.filter((trade) => dayOf(trade) < today);
  const dayStartBalance = clean(startingBalance + total(earlier, tradePnL));
  const pnl = total(todays, tradePnL);
  const lossPercent = pnl < 0 && dayStartBalance > 0 ? clean((-pnl / dayStartBalance) * 100) : 0;
  return {
    tradesCount: todays.length,
    maxTrades: settings.maxTradesPerDay,
    tradesLimitReached: todays.length >= settings.maxTradesPerDay,
    lossPercent,
    maxLossPercent: settings.maxDailyLossPercent,
    lossLimitReached: lossPercent >= settings.maxDailyLossPercent,
    planFollowed: todays.filter((trade) => trade.followedPlan).length,
  };
}

/** Losses in a row, counted back from the most recent trade. A Win or BE ends the run. */
export function lossStreak(trades) {
  const ordered = chronological(trades);
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0 && ordered[i].result === 'Loss'; i -= 1) streak += 1;
  return streak;
}

/**
 * Discipline streak: consecutive trading days on which every trade followed the plan.
 * Days without trades do not break it; one off-plan trade does.
 */
export function disciplineStreak(trades) {
  const days = new Map();
  for (const trade of trades) {
    days.set(dayOf(trade), (days.get(dayOf(trade)) ?? true) && trade.followedPlan === true);
  }
  let run = 0;
  let longest = 0;
  for (const day of [...days.keys()].sort()) {
    run = days.get(day) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current: run, longest };
}

/**
 * Tilt protection as a pure state transition.
 *
 * `servedLossId` is the most recent loss at the moment a break ended. While that loss
 * is still the latest one, the same streak does not lock the journal again; the next
 * loss in the streak does. Remembering the trade, not a count, keeps this correct even
 * when many trades arrive at once (restoring a backup).
 *
 * `canActivate` is true only when the user has just recorded or edited a trade.
 * On load, restore or a settings change the streak is marked as served instead,
 * so old data never starts a break out of nowhere.
 */
export function updateTilt(tilt, trades, settings, now, { canActivate = false } = {}) {
  const ordered = chronological(trades);
  const streak = lossStreak(trades);
  const lastLossId = streak > 0 ? ordered[ordered.length - 1].id : null;
  let { activeUntil, servedLossId } = tilt;

  if (activeUntil && now >= activeUntil) {
    activeUntil = null;
    servedLossId = lastLossId;
  }

  const justified = streak >= settings.tiltLossThreshold && lastLossId !== servedLossId;
  if (activeUntil && !justified) {
    activeUntil = null; // the losses were corrected or deleted
  } else if (!activeUntil && justified) {
    if (canActivate) activeUntil = now + settings.tiltBreakMinutes * 60_000;
    else servedLossId = lastLossId;
  }
  return { activeUntil, servedLossId };
}
