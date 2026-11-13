// The trade form. One form serves both recording a new trade and editing an old one,
// so every field (including date, risk and direction) can be corrected later.

import { RESULTS, SESSIONS, SETUPS, rMultiple } from './calc.js';
import { html, localInputValue, money } from './format.js';
import { applyEdit, createTrade, validateTrade } from './trade.js';

const DIRECTIONS = [['Long', 'Buy'], ['Short', 'Sell']];
const PLAN = [['yes', 'Da'], ['no', 'Ne']];
const same = (list) => list.map((item) => [item, item]);

const error = (name) => html`<p class="field-error" data-error="${name}" hidden></p>`;
const checked = (yes) => (yes ? html`checked` : '');

function choices(prefix, name, label, options, current) {
  return html`
    <div class="field" role="radiogroup" aria-labelledby="${prefix}-${name}-label">
      <span class="field-label" id="${prefix}-${name}-label">${label}</span>
      <div class="seg">
        ${options.map(([value, text]) => html`
          <label class="seg-option">
            <input type="radio" name="${name}" value="${value}" ${checked(current === value)}>
            <span>${text}</span>
          </label>`)}
      </div>
      ${error(name)}
    </div>`;
}

function price(prefix, name, label, value, hint) {
  return html`
    <div class="field">
      <label class="field-label" for="${prefix}-${name}">${label}</label>
      <input id="${prefix}-${name}" name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${value ?? ''}">
      ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
      ${error(name)}
    </div>`;
}

function formHtml(prefix, t, editing) {
  const plan = t.followedPlan === true ? 'yes' : t.followedPlan === false ? 'no' : '';
  return html`
    <form class="trade-form" id="${prefix}-form" novalidate>
      <div class="cols">
        <fieldset>
          <legend>Pozicija</legend>
          <div class="field-row pair-date stack-sm">
            <div class="field">
              <label class="field-label" for="${prefix}-pair">Par</label>
              <input id="${prefix}-pair" name="pair" type="text" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="EURUSD" value="${t.pair}">
              ${error('pair')}
            </div>
            <div class="field">
              <label class="field-label" for="${prefix}-date">Datum i vreme</label>
              <input id="${prefix}-date" name="date" type="datetime-local" value="${t.date}">
              ${error('date')}
            </div>
          </div>
          <div class="field-row">
            ${choices(prefix, 'direction', 'Smer', DIRECTIONS, t.direction)}
            ${price(prefix, 'riskPercent', 'Rizik (%)', t.riskPercent)}
          </div>
          <div class="field-row">
            ${price(prefix, 'entry', 'Entry', t.entry)}
            ${price(prefix, 'stopLoss', 'Stop Loss', t.stopLoss)}
          </div>
          <div class="field-row">
            ${price(prefix, 'takeProfit', 'Take Profit', t.takeProfit)}
            ${price(prefix, 'exitPrice', 'Exit Price (opciono)', t.exitPrice)}
          </div>
          <p class="field-hint">Bez Exit cene, Win se računa do Take Profit-a, a Loss kao -1R.</p>
          <dl class="preview" aria-live="polite">
            <div><dt>Rizik</dt><dd data-preview="risk">-</dd></div>
            <div><dt>Planirani R:R</dt><dd data-preview="rr">-</dd></div>
            <div><dt>Mogući dobitak</dt><dd data-preview="gain">-</dd></div>
          </dl>
        </fieldset>

        <fieldset>
          <legend>Kontekst</legend>
          ${choices(prefix, 'setup', 'Setup', same(SETUPS), t.setup)}
          ${choices(prefix, 'session', 'Sesija', same(SESSIONS), t.session)}
          <div class="field">
            <label class="field-label" for="${prefix}-emotion">Emocije: <output data-emotion>${t.emotion}</output> / 10</label>
            <input id="${prefix}-emotion" name="emotion" type="range" min="1" max="10" step="1" value="${t.emotion}">
            <div class="range-ends"><span>1 miran</span><span>10 pod pritiskom</span></div>
            ${error('emotion')}
          </div>
          ${choices(prefix, 'followedPlan', 'Trade po planu?', PLAN, plan)}
          ${choices(prefix, 'result', 'Result', same(RESULTS), t.result)}
          <div class="field">
            <label class="field-label" for="${prefix}-notes">Napomena (opciono)</label>
            <textarea id="${prefix}-notes" name="notes" rows="3" maxlength="1000">${t.notes}</textarea>
            ${error('notes')}
          </div>
        </fieldset>
      </div>

      <div class="actions">
        ${editing
          ? html`
            <button type="submit" class="btn primary">Sačuvaj izmene</button>
            <button type="button" class="btn" data-cancel>Otkaži</button>
            <button type="button" class="btn danger push-right" data-delete>Obriši trade</button>`
          : html`
            <button type="submit" class="btn primary" data-tilt-disable>Sačuvaj trade</button>
            <p class="tilt-note" data-tilt-note hidden></p>`}
      </div>
    </form>`;
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('[data-error]')) {
    const message = errors[el.dataset.error];
    el.textContent = message ?? '';
    el.hidden = !message;
  }
  for (const input of form.querySelectorAll('[name]')) {
    if (errors[input.name]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const first = Object.keys(errors)[0];
  if (first) form.querySelector(`[name="${first}"]`)?.focus();
}

/**
 * Puts the form into `container`.
 * Without `trade` it records a new one; with `trade` it edits that trade.
 */
export function mountTradeForm(container, app, { trade = null, onSaved, onDelete, onCancel } = {}) {
  const editing = trade !== null;
  const prefix = editing ? 'edit' : 'new';
  const initial = trade ?? {
    pair: '', date: localInputValue(new Date(app.now())), direction: '', riskPercent: '', entry: '',
    stopLoss: '', takeProfit: '', exitPrice: '', setup: '', session: '', emotion: 5,
    followedPlan: null, result: '', notes: '',
  };
  container.innerHTML = String(formHtml(prefix, initial, editing));
  const form = container.querySelector('form');
  const read = () => Object.fromEntries(new app.win.FormData(form).entries());

  // Dollars at risk for a given Risk %: from the current balance for a new trade,
  // from the trade's own original basis when editing.
  const balance = app.summary().balance;
  const riskDollars = (riskPercent) => {
    if (!editing) return (balance * riskPercent) / 100;
    return trade.riskPercent > 0 ? (trade.riskAmount * riskPercent) / trade.riskPercent : trade.riskAmount;
  };

  function updatePreview() {
    const raw = read();
    const set = (key, text) => {
      form.querySelector(`[data-preview="${key}"]`).textContent = text;
    };
    const risk = Number(raw.riskPercent);
    const dollars = risk > 0 ? riskDollars(risk) : null;
    const entry = Number(raw.entry);
    const stop = Number(raw.stopLoss);
    const target = Number(raw.takeProfit);
    const ready = raw.direction && entry > 0 && stop > 0 && target > 0 && entry !== stop;
    const r = ready ? rMultiple(entry, stop, target, raw.direction) : null;
    set('risk', dollars !== null ? money(dollars) : '-');
    set('rr', r !== null && r > 0 ? `1 : ${r.toFixed(2)}` : '-');
    set('gain', dollars !== null && r !== null && r > 0 ? money(dollars * r) : '-');
    form.querySelector('[data-emotion]').textContent = raw.emotion;
  }

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  updatePreview();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { ok, errors, values } = validateTrade(read());
    showErrors(form, errors);
    if (!ok) {
      app.ui.toast('Proveri označena polja.', 'error');
      return;
    }

    if (editing) {
      app.commit((data) => {
        const index = data.trades.findIndex((item) => item.id === trade.id);
        if (index !== -1) data.trades[index] = applyEdit(data.trades[index], values);
      }, { canActivateTilt: true });
    } else {
      if (app.tiltRemaining() > 0) {
        app.ui.toast('Pauza je u toku. Unos je zaključan.', 'error');
        return;
      }
      if (!(balance > 0)) {
        app.ui.toast('Balans nije veći od nule. Promeni početni balans u podešavanjima.', 'error');
        return;
      }
      app.commit((data) => {
        data.trades.push(createTrade(values, balance, { id: app.newId(), createdAt: app.now() }));
      }, { canActivateTilt: true });
    }
    onSaved?.(values);
  });

  form.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel?.());
  form.querySelector('[data-delete]')?.addEventListener('click', () => onDelete?.());
  return form;
}

/** The "Novi trade" view. */
export function renderEntry(app, root) {
  root.innerHTML = String(html`
    <h1 class="view-title">Novi trade</h1>
    <div id="entry"></div>`);
  mountTradeForm(root.querySelector('#entry'), app, {
    onSaved: () => {
      app.ui.toast('Trade sačuvan.', 'success');
      app.go('istorija');
    },
  });
}
