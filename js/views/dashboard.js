// "Pregled": result, equity curve, daily limits, outcome split, calendar and insights.

import { dailyGoals, dailyTotals } from '../calc.js';
import { MONTHS, html, money, percent, rValue, signedMoney, tone, tradesWord } from '../format.js';
import { buildInsights } from '../insights.js';

const WEEKDAYS = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];

const stat = (label, value, id, note) => html`
  <div>
    <dt>${label}</dt>
    <dd id="${id}">${value}${note ? html` <small>${note}</small>` : ''}</dd>
  </div>`;

/** Balance after every trade as a single line. The dashed line marks the starting balance. */
function equityChart(summary, startingBalance) {
  if (!summary.count) {
    return html`<p class="chart-empty">Kriva kapitala se crta od prvog trade-a.</p>`;
  }
  const values = [startingBalance, ...summary.curve.map((point) => point.balance)];
  const low = values.reduce((a, b) => Math.min(a, b));
  const high = values.reduce((a, b) => Math.max(a, b));
  const W = 800;
  const H = 220;
  const PAD = 10;
  const span = high - low || 1;
  const x = (i) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const y = (value) => PAD + (1 - (value - low) / span) * (H - 2 * PAD);
  const points = values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const base = y(startingBalance).toFixed(1);
  const label = `Kriva kapitala kroz ${summary.count} ${tradesWord(summary.count)}: od ${money(startingBalance)} do ${money(summary.balance)}.`;

  return html`
    <figure class="equity">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${label}">
        <line class="equity-base" x1="0" x2="${W}" y1="${base}" y2="${base}"></line>
        <polyline class="equity-line" points="${points}"></polyline>
      </svg>
      <figcaption>
        <span>Početni balans <b>${money(startingBalance)}</b></span>
        <span>Najviše <b>${money(high)}</b></span>
        <span>Najniže <b>${money(low)}</b></span>
      </figcaption>
    </figure>`;
}

function limits(goals) {
  const row = (label, text, value, max, variant, id) => html`
    <div class="limit">
      <div class="limit-head"><span>${label}</span><span class="num" id="${id}">${text}</span></div>
      <progress class="${variant}" max="${max}" value="${Math.min(value, max)}" aria-label="${label}"></progress>
    </div>`;
  const reached = goals.tradesLimitReached || goals.lossLimitReached;
  return html`
    ${row('Trade-ova danas', `${goals.tradesCount} / ${goals.maxTrades}`, goals.tradesCount, goals.maxTrades, goals.tradesLimitReached ? 'over' : '', 'goal-trades')}
    ${row('Dnevni gubitak', `${percent(goals.lossPercent)} / ${percent(goals.maxLossPercent)}`, goals.lossPercent, goals.maxLossPercent, goals.lossLimitReached ? 'over' : '', 'goal-loss')}
    ${row('Po planu danas', `${goals.planFollowed} / ${goals.tradesCount}`, goals.planFollowed, Math.max(goals.tradesCount, 1), 'plan', 'goal-plan')}
    ${reached ? html`<p class="limit-note" id="limit-note">Dnevni limit je dostignut. Za danas je dosta.</p>` : ''}`;
}

function outcomes(summary) {
  if (!summary.count) return html`<p class="muted">Još nema unetih trade-ova.</p>`;
  const share = (n) => (n / summary.count) * 100;
  const win = share(summary.wins);
  const be = share(summary.breakevens);
  const loss = share(summary.losses);
  const item = (name, kind, count) => html`
    <div><dt><i class="dot ${kind}"></i>${name}</dt><dd>${count}</dd></div>`;
  return html`
    <svg class="outcome-bar" width="100%" height="8" role="img"
      aria-label="Win ${summary.wins}, BE ${summary.breakevens}, Loss ${summary.losses}">
      <rect class="win" x="0" y="0" height="8" width="${win.toFixed(3)}%"></rect>
      <rect class="be" x="${win.toFixed(3)}%" y="0" height="8" width="${be.toFixed(3)}%"></rect>
      <rect class="loss" x="${(win + be).toFixed(3)}%" y="0" height="8" width="${loss.toFixed(3)}%"></rect>
    </svg>
    <dl class="legend" id="outcomes">
      ${item('Win', 'win', summary.wins)}
      ${item('BE', 'be', summary.breakevens)}
      ${item('Loss', 'loss', summary.losses)}
    </dl>`;
}

function calendar(app) {
  const { year, month } = app.month;
  const totals = dailyTotals(app.data.trades);
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // week starts on Monday
  const days = new Date(year, month + 1, 0).getDate();
  const today = app.today();
  const pad = (n) => String(n).padStart(2, '0');

  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(html`<span class="day blank"></span>`);
  for (let day = 1; day <= days; day += 1) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    const entry = totals.get(key);
    const kind = !entry ? '' : entry.pnl > 0.005 ? 'profit' : entry.pnl < -0.005 ? 'loss' : 'flat';
    const title = entry
      ? `${day}. ${MONTHS[month]}: ${signedMoney(entry.pnl)}, ${entry.count} ${tradesWord(entry.count)}`
      : `${day}. ${MONTHS[month]}: bez trade-ova`;
    cells.push(html`<span class="day ${kind}${key === today ? ' today' : ''}" data-day="${key}" title="${title}">${day}</span>`);
  }

  return html`
    <div class="cal-head">
      <h2>Kalendar</h2>
      <div class="cal-nav">
        <button type="button" class="link" data-month="-1">Prethodni</button>
        <span id="cal-month">${MONTHS[month]} ${year}</span>
        <button type="button" class="link" data-month="1">Sledeći</button>
      </div>
    </div>
    <div class="cal">
      ${WEEKDAYS.map((name) => html`<span class="weekday">${name}</span>`)}
      ${cells}
    </div>
    <dl class="legend">
      <div><dt><i class="dot win"></i>Dan u plusu</dt></div>
      <div><dt><i class="dot be"></i>Na nuli</dt></div>
      <div><dt><i class="dot loss"></i>Dan u minusu</dt></div>
    </dl>`;
}

export function renderDashboard(app, root) {
  const { trades, startingBalance, settings } = app.data;
  const summary = app.summary();
  const goals = dailyGoals(trades, startingBalance, settings, app.today());
  const drawdownNote = summary.maxDrawdown > 0 ? percent(summary.maxDrawdownPercent) : '';

  root.innerHTML = String(html`
    <h1 class="view-title">Pregled</h1>
    <section class="hero" aria-label="Rezultat">
      <div class="hero-head">
        <div>
          <p class="label">Net PnL</p>
          <p class="hero-figure ${tone(summary.netPnL)}" id="stat-net-pnl">${signedMoney(summary.netPnL)}</p>
        </div>
        <dl class="stats">
          ${stat('Win rate', percent(summary.winRate), 'stat-win-rate')}
          ${stat('Prosečan R', rValue(summary.avgR), 'stat-avg-r')}
          ${stat('Trade-ova', summary.count, 'stat-count')}
          ${stat('Max drawdown', money(summary.maxDrawdown), 'stat-drawdown', drawdownNote)}
        </dl>
      </div>
      ${equityChart(summary, startingBalance)}
    </section>

    <div class="cols">
      <section class="block"><h2>Dnevni limiti</h2>${limits(goals)}</section>
      <section class="block"><h2>Odnos ishoda</h2>${outcomes(summary)}</section>
    </div>

    <div class="cols">
      <section class="block">${calendar(app)}</section>
      <section class="block">
        <h2>Uvidi</h2>
        <ul class="insights" id="insights">
          ${buildInsights(trades, summary).map((insight) => html`<li class="${insight.level}">${insight.text}</li>`)}
        </ul>
      </section>
    </div>`);

  for (const button of root.querySelectorAll('[data-month]')) {
    button.addEventListener('click', () => {
      const step = Number(button.dataset.month);
      const moved = new Date(app.month.year, app.month.month + step, 1); // the 1st never overflows
      app.month = { year: moved.getFullYear(), month: moved.getMonth() };
      renderDashboard(app, root);
      root.querySelector(`[data-month="${step}"]`).focus();
    });
  }
}
