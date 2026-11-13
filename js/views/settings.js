// Settings dialog (limits, tilt, account, data) and the "Kako radi" dialog.

import { html, plural } from '../format.js';
import { normalizeSettings } from '../store.js';

const numberField = (name, label, value, step = '1') => html`
  <div class="field">
    <label class="field-label" for="set-${name}">${label}</label>
    <input id="set-${name}" name="${name}" type="number" inputmode="decimal" min="0" step="${step}" value="${value}">
    <p class="field-error" data-error="${name}" hidden></p>
  </div>`;

function validate(raw) {
  const errors = {};
  const whole = (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  if (!whole(raw.maxTradesPerDay, 1, 1000)) errors.maxTradesPerDay = 'Unesi ceo broj, najmanje 1.';
  if (!(Number(raw.maxDailyLossPercent) > 0 && Number(raw.maxDailyLossPercent) <= 100)) errors.maxDailyLossPercent = 'Unesi procenat veći od 0 i najviše 100.';
  if (!whole(raw.tiltLossThreshold, 1, 100)) errors.tiltLossThreshold = 'Unesi ceo broj, najmanje 1.';
  if (!whole(raw.tiltBreakMinutes, 1, 1440)) errors.tiltBreakMinutes = 'Unesi ceo broj minuta, od 1 do 1440.';
  if (!(Number(raw.startingBalance) > 0)) errors.startingBalance = 'Unesi početni balans veći od nule.';
  return errors;
}

export function openSettings(app) {
  const { settings, startingBalance } = app.data;
  const modal = app.ui.openModal({ title: 'Podešavanja' });
  modal.body.innerHTML = String(html`
    <form id="settings-form" novalidate>
      <fieldset>
        <legend>Dnevni limiti</legend>
        <div class="field-row">
          ${numberField('maxTradesPerDay', 'Najviše trade-ova dnevno', settings.maxTradesPerDay)}
          ${numberField('maxDailyLossPercent', 'Najveći dnevni gubitak (%)', settings.maxDailyLossPercent, '0.1')}
        </div>
      </fieldset>
      <fieldset>
        <legend>Tilt zaštita</legend>
        <div class="field-row">
          ${numberField('tiltLossThreshold', 'Gubitaka zaredom do pauze', settings.tiltLossThreshold)}
          ${numberField('tiltBreakMinutes', 'Trajanje pauze (min)', settings.tiltBreakMinutes)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Račun</legend>
        ${numberField('startingBalance', 'Početni balans ($)', startingBalance, 'any')}
      </fieldset>
      <div class="actions">
        <button type="submit" class="btn primary">Sačuvaj podešavanja</button>
      </div>
    </form>

    <section class="data-zone">
      <h3>Podaci</h3>
      <p class="muted">Podaci se čuvaju samo u ovom browseru. Backup je kopija koju možeš da preneseš na drugi uređaj.</p>
      <div class="actions">
        <button type="button" class="btn" id="backup-download">Preuzmi backup</button>
        <button type="button" class="btn" id="backup-restore">Učitaj backup</button>
        <button type="button" class="btn danger push-right" id="journal-reset">Resetuj dnevnik</button>
      </div>
    </section>`);

  const form = modal.body.querySelector('form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new app.win.FormData(form).entries());
    const errors = validate(raw);
    for (const el of form.querySelectorAll('[data-error]')) {
      el.textContent = errors[el.dataset.error] ?? '';
      el.hidden = !errors[el.dataset.error];
    }
    const first = Object.keys(errors)[0];
    if (first) {
      form.querySelector(`[name="${first}"]`).focus();
      return;
    }
    app.commit((data) => {
      data.settings = normalizeSettings(raw);
      data.startingBalance = Number(raw.startingBalance);
    });
    modal.close();
    app.ui.toast('Podešavanja sačuvana.', 'success');
  });

  modal.body.querySelector('#backup-download').addEventListener('click', () => app.downloadBackup());
  modal.body.querySelector('#backup-restore').addEventListener('click', async () => {
    if (await app.importBackup()) modal.close();
  });
  modal.body.querySelector('#journal-reset').addEventListener('click', async () => {
    const agreed = await app.ui.confirm({
      title: 'Resetuj dnevnik?',
      message: 'Brišu se svi trade-ovi, početni balans i podešavanja. Ako ti podaci trebaju, prvo preuzmi backup.',
      confirmLabel: 'Resetuj dnevnik',
      danger: true,
    });
    if (!agreed) return;
    modal.close();
    app.reset();
  });

  modal.focusFirst();
}

export function openInfo(app) {
  const { tiltLossThreshold, tiltBreakMinutes } = app.data.settings;
  const modal = app.ui.openModal({ title: 'Kako dnevnik računa' });
  modal.body.innerHTML = String(html`
    <p>Svaki trade se beleži sa fokusom na rizik, emocionalno stanje i plan.</p>
    <dl class="prose">
      <dt>Rizik</dt>
      <dd>Rizik (%) se računa na balans u trenutku unosa, ne na početni. Taj iznos u dolarima je 1R i više se ne menja kada izmeniš cene.</dd>
      <dt>R</dt>
      <dd>Pomeranje cene od Entry do izlaza, podeljeno rastojanjem od Entry do Stop Loss, u smeru trade-a. Bez Exit cene, Win se računa do Take Profit-a, a Loss kao -1R. BE je 0.</dd>
      <dt>PnL</dt>
      <dd>R pomnožen rizikom u dolarima. Spread, provizija i swap nisu uključeni, pa se iznos može razlikovati od brokerovog.</dd>
      <dt>Win rate</dt>
      <dd>Broj Win trade-ova podeljen ukupnim brojem trade-ova. BE ulazi u ukupan broj.</dd>
      <dt>Max drawdown</dt>
      <dd>Najveći pad balansa od prethodnog vrha.</dd>
      <dt>Dnevni gubitak</dt>
      <dd>Zbir današnjih trade-ova u odnosu na balans na početku dana.</dd>
      <dt>Dani discipline</dt>
      <dd>Uzastopni dani trgovanja u kojima je svaki trade bio po planu. Dan bez trade-ova ne prekida niz.</dd>
      <dt>Tilt zaštita</dt>
      <dd>Posle ${tiltLossThreshold} ${plural(tiltLossThreshold, 'gubitka', 'gubitka', 'gubitaka')} zaredom unos se zaključava na ${tiltBreakMinutes} min. Posle pauze, sledeći gubitak u istoj seriji ponovo zaključava unos.</dd>
    </dl>
    <p>Golden Trading Journal je napravljen za one koji trguju sa glavom, a ne srcem.</p>
    <p class="muted">Dnevnik ne daje signale i nije finansijski savet. Trgovanje nosi rizik gubitka.</p>`);
  modal.focusFirst();
}
