// "Analitika": results by setup and session, best and worst, emotions.

import { SESSIONS, SETUPS, breakdown, emotionStats, extremes } from '../calc.js';
import { html, percent, signedMoney, tone } from '../format.js';

function groupTable(title, column, groups, id) {
  return html`
    <section class="block">
      <h2>${title}</h2>
      ${groups.length ? html`
        <table class="plain" id="${id}">
          <thead><tr><th>${column}</th><th class="num">Trade-ova</th><th class="num">Win rate</th><th class="num">PnL</th></tr></thead>
          <tbody>
            ${groups.map((group) => html`
              <tr>
                <td>${group.name}</td>
                <td class="num">${group.count}</td>
                <td class="num">${percent(group.winRate)}</td>
                <td class="num ${tone(group.pnl)}">${signedMoney(group.pnl)}</td>
              </tr>`)}
          </tbody>
        </table>` : html`<p class="muted">Nema podataka.</p>`}
    </section>`;
}

const fact = (label, group) => html`
  <div>
    <dt>${label}</dt>
    <dd>${group ? html`${group.name} <span class="num ${tone(group.pnl)}">${signedMoney(group.pnl)}</span>` : '-'}</dd>
  </div>`;

export function renderAnalytics(app, root) {
  const { trades } = app.data;
  if (!trades.length) {
    root.innerHTML = String(html`
      <h1 class="view-title">Analitika</h1>
      <div class="empty">
        <p>Analitika se računa iz unetih trade-ova.</p>
        <a class="btn primary" href="#novi" data-go="novi">Unesi prvi trade</a>
      </div>`);
    return;
  }

  const setups = breakdown(trades, 'setup', SETUPS);
  const sessions = breakdown(trades, 'session', SESSIONS);
  const bySetup = extremes(setups);
  const bySession = extremes(sessions);
  const emotion = emotionStats(trades);
  const average = (value, has) => (has ? `${value.toFixed(1)} / 10` : '-');
  const hasWins = trades.some((trade) => trade.result === 'Win');
  const hasLosses = trades.some((trade) => trade.result === 'Loss');

  root.innerHTML = String(html`
    <h1 class="view-title">Analitika</h1>
    <div class="cols">
      ${groupTable('Po setup-u', 'Setup', setups, 'by-setup')}
      ${groupTable('Po sesiji', 'Sesija', sessions, 'by-session')}
    </div>
    <div class="cols">
      <section class="block">
        <h2>Najbolje i najgore</h2>
        <dl class="facts" id="best-worst">
          ${fact('Najbolja sesija', bySession?.best)}
          ${fact('Najgora sesija', bySession?.worst)}
          ${fact('Najbolji setup', bySetup?.best)}
          ${fact('Najgori setup', bySetup?.worst)}
        </dl>
      </section>
      <section class="block">
        <h2>Emocije i rezultat</h2>
        <dl class="facts" id="emotions">
          <div><dt>Prosek svih trade-ova</dt><dd>${average(emotion.all, true)}</dd></div>
          <div><dt>Prosek kod Win</dt><dd>${average(emotion.wins, hasWins)}</dd></div>
          <div><dt>Prosek kod Loss</dt><dd>${average(emotion.losses, hasLosses)}</dd></div>
        </dl>
      </section>
    </div>`);
}
