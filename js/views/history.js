// "Istorija": searchable list of trades, CSV export, and the edit dialog.

import { chronological, plannedR, realizedR, tradePnL } from '../calc.js';
import { dateTime, html, rValue, signedMoney, tone, tradesWord } from '../format.js';
import { mountTradeForm } from '../trade-form.js';

export const PAGE_SIZE = 50;

// Text cells are quoted, inner quotes doubled, and anything a spreadsheet would run
// as a formula (=, +, -, @) is neutralised. Numbers are written as plain numbers.
const csvText = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export function toCsv(trades) {
  const header = [
    'Date', 'Pair', 'Direction', 'Setup', 'Session', 'Risk %', 'Risk $', 'Entry', 'Stop Loss',
    'Take Profit', 'Exit', 'Planned R', 'Realized R', 'PnL $', 'Result', 'Plan', 'Emotion', 'Notes',
  ];
  const rows = chronological(trades).map((t) => [
    csvText(t.date), csvText(t.pair), csvText(t.direction === 'Long' ? 'Buy' : 'Sell'),
    csvText(t.setup), csvText(t.session),
    t.riskPercent, t.riskAmount.toFixed(2), t.entry, t.stopLoss, t.takeProfit, t.exitPrice ?? '',
    plannedR(t).toFixed(2), realizedR(t).toFixed(2), tradePnL(t).toFixed(2),
    csvText(t.result), csvText(t.followedPlan ? 'Yes' : 'No'), t.emotion, csvText(t.notes),
  ].join(','));
  return `${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

function matches(trade, { query, result }) {
  if (result !== 'all' && trade.result !== result) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [trade.pair, trade.setup, trade.session, trade.notes].some((text) => text.toLowerCase().includes(q));
}

const row = (t) => {
  const r = realizedR(t);
  const pnl = tradePnL(t);
  return html`
    <tr data-id="${t.id}">
      <td data-label="Datum">${dateTime(t.date)}</td>
      <td data-label="Par"><span><span class="pair">${t.pair}</span> <span class="side">${t.direction === 'Long' ? 'Buy' : 'Sell'}</span></span></td>
      <td data-label="Setup">${t.setup || '-'}</td>
      <td data-label="Sesija">${t.session || '-'}</td>
      <td data-label="Rizik" class="num">${t.riskPercent}%</td>
      <td data-label="R" class="num ${tone(r)}">${rValue(r)}</td>
      <td data-label="PnL" class="num ${tone(pnl)}">${signedMoney(pnl)}</td>
      <td data-label="Result"><span class="result ${t.result.toLowerCase()}">${t.result}</span></td>
      <td data-label="Plan">${t.followedPlan ? 'Da' : 'Ne'}</td>
      <td data-label="Emocije" class="num">${t.emotion}</td>
      <td class="row-actions">
        <button type="button" class="link" data-action="edit">Izmeni</button>
        <button type="button" class="link danger" data-action="delete">Obriši</button>
      </td>
    </tr>`;
};

async function deleteTrade(app, trade) {
  const agreed = await app.ui.confirm({
    title: 'Obriši trade?',
    message: `${trade.pair}, ${dateTime(trade.date)}. Brisanje se ne može poništiti.`,
    confirmLabel: 'Obriši trade',
    danger: true,
  });
  if (!agreed) return false;
  app.commit((data) => {
    data.trades = data.trades.filter((item) => item.id !== trade.id);
  });
  app.ui.toast('Trade obrisan.', 'success');
  return true;
}

function openEdit(app, trade) {
  const modal = app.ui.openModal({ title: 'Izmena trade-a', wide: true });
  mountTradeForm(modal.body, app, {
    trade,
    onSaved: () => {
      modal.close();
      app.ui.toast('Izmene sačuvane.', 'success');
    },
    onCancel: modal.close,
    onDelete: async () => {
      if (await deleteTrade(app, trade)) modal.close();
    },
  });
  modal.focusFirst();
}

export function renderHistory(app, root) {
  const { trades } = app.data;
  const filters = app.filters;

  if (!trades.length) {
    root.innerHTML = String(html`
      <h1 class="view-title">Istorija</h1>
      <div class="empty">
        <p>Dnevnik je prazan.</p>
        <a class="btn primary" href="#novi" data-go="novi">Unesi prvi trade</a>
      </div>`);
    return;
  }

  const option = (value, label) => html`<option value="${value}" ${filters.result === value ? html`selected` : ''}>${label}</option>`;
  root.innerHTML = String(html`
    <h1 class="view-title">Istorija</h1>
    <div class="toolbar">
      <label class="sr-only" for="history-search">Pretraga</label>
      <input id="history-search" type="search" placeholder="Par, setup, sesija ili napomena" value="${filters.query}">
      <label class="sr-only" for="history-result">Result</label>
      <select id="history-result">
        ${option('all', 'Svi rezultati')}${option('Win', 'Win')}${option('Loss', 'Loss')}${option('BE', 'BE')}
      </select>
      <button type="button" class="btn push-right" id="history-export">Izvezi CSV</button>
    </div>
    <p class="muted" id="history-count"></p>
    <div class="table-wrap">
      <table class="history">
        <thead>
          <tr>
            <th>Datum</th><th>Par</th><th>Setup</th><th>Sesija</th><th class="num">Rizik</th>
            <th class="num">R</th><th class="num">PnL</th><th>Result</th><th>Plan</th>
            <th class="num">Emocije</th><th><span class="sr-only">Akcije</span></th>
          </tr>
        </thead>
        <tbody id="history-rows"></tbody>
      </table>
    </div>
    <div class="more" id="history-more"></div>`);

  const rows = root.querySelector('#history-rows');
  const count = root.querySelector('#history-count');
  const more = root.querySelector('#history-more');

  function update() {
    const found = chronological(trades).reverse().filter((trade) => matches(trade, filters));
    const shown = found.slice(0, filters.limit);
    rows.innerHTML = String(html`${shown.map(row)}`);
    count.textContent = found.length === trades.length
      ? `${trades.length} ${tradesWord(trades.length)}`
      : `${found.length} od ${trades.length} ${tradesWord(trades.length)}`;
    more.innerHTML = String(found.length > shown.length
      ? html`<button type="button" class="btn" id="history-more-btn">Prikaži još ${Math.min(PAGE_SIZE, found.length - shown.length)}</button>`
      : !found.length ? html`<p class="muted">Nijedan trade ne odgovara pretrazi.</p>` : html``);
  }

  root.querySelector('#history-search').addEventListener('input', (event) => {
    filters.query = event.target.value;
    filters.limit = PAGE_SIZE;
    update();
  });
  root.querySelector('#history-result').addEventListener('change', (event) => {
    filters.result = event.target.value;
    filters.limit = PAGE_SIZE;
    update();
  });
  more.addEventListener('click', (event) => {
    if (!event.target.closest('#history-more-btn')) return;
    filters.limit += PAGE_SIZE;
    update();
  });
  root.querySelector('#history-export').addEventListener('click', () => {
    // The BOM makes Excel read č, ć, š, ž in notes correctly.
    app.ui.download('golden-trading-journal.csv', 'text/csv;charset=utf-8', `﻿${toCsv(trades)}`);
    app.ui.toast('CSV izvezen.', 'success');
  });
  rows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const trade = trades.find((item) => item.id === button.closest('tr').dataset.id);
    if (!trade) return;
    if (button.dataset.action === 'edit') openEdit(app, trade);
    else deleteTrade(app, trade);
  });

  update();
}
