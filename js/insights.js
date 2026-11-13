// Short observations shown on the overview. Same rules as v1, in the brand voice.

import { SESSIONS, breakdown, emotionStats, extremes } from './calc.js';
import { money, percent } from './format.js';

export const MIN_TRADES_FOR_INSIGHTS = 5;

/** Returns a list of { level: 'info' | 'warning' | 'ok', text }. */
export function buildInsights(trades, summary) {
  if (trades.length < MIN_TRADES_FOR_INSIGHTS) {
    return [{
      level: 'info',
      text: `Uvidi se pojavljuju posle ${MIN_TRADES_FOR_INSIGHTS} trade-ova. Trenutno: ${trades.length}.`,
    }];
  }

  const insights = [];

  if (summary.winRate < 40) {
    insights.push({ level: 'warning', text: `Win rate je ${percent(summary.winRate)}. Biraj setup-e strože.` });
  } else if (summary.winRate > 60) {
    insights.push({ level: 'ok', text: `Win rate je ${percent(summary.winRate)}. Drži isti proces.` });
  }

  const worst = extremes(breakdown(trades, 'session', SESSIONS))?.worst;
  if (worst && worst.pnl < 0) {
    insights.push({
      level: 'warning',
      text: `${worst.name} sesija je u minusu (${money(worst.pnl)}). Proveri da li u njoj treba da trguješ.`,
    });
  }

  const emotion = emotionStats(trades).all;
  if (emotion > 7) {
    insights.push({
      level: 'warning',
      text: `Prosečna emocija je ${emotion.toFixed(1)}/10. Trguješ pod pritiskom. Smanji rizik ili napravi pauzu.`,
    });
  }

  if (!insights.length) insights.push({ level: 'ok', text: 'Nema upozorenja. Drži se plana.' });
  return insights;
}
