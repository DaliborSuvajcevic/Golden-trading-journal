// Application shell: owns the journal document, saves it, and decides what is on screen.

import { disciplineStreak, lossStreak, summarize, updateTilt } from './calc.js';
import { countdown, dayKey, money, plural, tradesWord } from './format.js';
import { emptyDoc, localAdapter, parseBackup, toBackup } from './store.js';
import { createUi } from './ui.js';
import { renderEntry } from './trade-form.js';
import { renderAnalytics } from './views/analytics.js';
import { renderDashboard } from './views/dashboard.js';
import { PAGE_SIZE, renderHistory } from './views/history.js';
import { openInfo, openSettings } from './views/settings.js';

const VIEWS = {
  pregled: renderDashboard,
  novi: renderEntry,
  istorija: renderHistory,
  analitika: renderAnalytics,
};
const DEFAULT_VIEW = 'pregled';

export async function createApp({ document: doc, window: win, storage = win.localStorage }) {
  const $ = (selector) => doc.querySelector(selector);
  const newId = () =>
    win.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const adapter = localAdapter(storage, newId);

  const app = {
    doc,
    win,
    newId,
    ui: createUi(doc, win),
    data: emptyDoc(),
    view: DEFAULT_VIEW,
    filters: { query: '', result: 'all', limit: PAGE_SIZE },
    month: null, // { year, month } shown in the calendar
    tiltHidden: null, // the break the user chose to hide the banner for
    now: () => Date.now(),
    today: () => dayKey(new Date(app.now())),
    summary: () => summarize(app.data.trades, app.data.startingBalance ?? 0),
    tiltRemaining: () => Math.max(0, (app.data.tilt.activeUntil ?? 0) - app.now()),
    commit,
    go,
    render,
    tick,
    restoreFromText,
    importBackup,
    downloadBackup,
    reset,
  };

  // --- State ------------------------------------------------------------------

  function save() {
    adapter.save(app.data).catch(() => {
      app.ui.toast('Čuvanje nije uspelo. Preuzmi backup da ne izgubiš podatke.', 'error');
    });
  }

  /** Re-evaluates tilt protection. Returns true when its stored state changed. */
  function syncTilt(canActivate) {
    const before = app.data.tilt;
    const after = updateTilt(before, app.data.trades, app.data.settings, app.now(), { canActivate });
    app.data.tilt = after;
    if (after.activeUntil !== before.activeUntil) app.tiltHidden = null; // a new break always shows its banner
    return before.activeUntil !== after.activeUntil || before.servedLossId !== after.servedLossId;
  }

  /**
   * The one way to change the journal: mutate, re-check tilt, save, redraw.
   * Pass canActivateTilt when the change is a trade the user just recorded or edited.
   */
  function commit(mutate, { canActivateTilt = false } = {}) {
    mutate(app.data);
    syncTilt(canActivateTilt);
    save();
    render();
  }

  function restoreFromText(text) {
    const { doc: restored, skipped } = parseBackup(text, newId); // throws before anything is replaced
    app.data = restored;
    syncTilt(false);
    save();
    go(DEFAULT_VIEW);
    const n = restored.trades.length;
    if (skipped) {
      app.ui.toast(`Učitano: ${n} ${tradesWord(n)}. Preskočeno ${skipped} bez ispravnih cena.`, 'warning');
    } else {
      app.ui.toast(`Backup učitan: ${n} ${tradesWord(n)}.`, 'success');
    }
  }

  /** Asks for a backup file and loads it. Resolves to true when the journal was replaced. */
  async function importBackup() {
    try {
      const text = await app.ui.pickFile('.json,application/json');
      if (text === null) return false;
      if (app.data.trades.length) {
        const agreed = await app.ui.confirm({
          title: 'Zameni trenutne podatke?',
          message: 'Backup zamenjuje sve trade-ove i podešavanja u ovom dnevniku.',
          confirmLabel: 'Zameni podatke',
          danger: true,
        });
        if (!agreed) return false;
      }
      restoreFromText(text);
      return true;
    } catch (error) {
      app.ui.toast(error.message, 'error');
      return false;
    }
  }

  function downloadBackup() {
    const content = JSON.stringify(toBackup(app.data, app.now()), null, 2);
    app.ui.download(`golden-journal-backup-${app.today()}.json`, 'application/json', content);
    app.ui.toast('Backup preuzet.', 'success');
  }

  function reset() {
    app.data = emptyDoc();
    app.filters = { query: '', result: 'all', limit: PAGE_SIZE };
    save();
    go(DEFAULT_VIEW);
    app.ui.toast('Dnevnik je resetovan.', 'success');
  }

  // --- Screen -----------------------------------------------------------------

  function renderTilt() {
    const remaining = app.tiltRemaining();
    const active = remaining > 0;
    $('#tilt').hidden = !active || app.tiltHidden === app.data.tilt.activeUntil;
    if (active) {
      const n = lossStreak(app.data.trades);
      $('#tilt-text').textContent =
        `${n} ${plural(n, 'gubitak', 'gubitka', 'gubitaka')} zaredom. Unos novih trade-ova je zaključan do kraja pauze.`;
      $('#tilt-clock').textContent = countdown(remaining);
    }
    for (const el of doc.querySelectorAll('[data-tilt-disable]')) el.disabled = active;
    for (const el of doc.querySelectorAll('[data-tilt-note]')) {
      el.hidden = !active;
      el.textContent = active ? `Unos je zaključan još ${countdown(remaining)}.` : '';
    }
  }

  function render() {
    const started = app.data.startingBalance !== null;
    $('#setup').hidden = started;
    $('#app').hidden = !started;
    if (!started) return;

    $('#header-balance').textContent = money(app.summary().balance);
    $('#header-streak').textContent = String(disciplineStreak(app.data.trades).current);
    for (const tab of doc.querySelectorAll('.tab')) {
      if (tab.dataset.go === app.view) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    VIEWS[app.view](app, $('#view'));
    renderTilt();
  }

  function go(view, { push = true } = {}) {
    const next = VIEWS[view] ? view : DEFAULT_VIEW;
    const changed = next !== app.view;
    app.view = next;
    if (push && win.location.hash !== `#${next}`) win.history.pushState(null, '', `#${next}`);
    render();
    if (changed) win.scrollTo(0, 0);
  }

  /** Runs every second: ends an expired break and keeps the countdown current. */
  function tick() {
    if (!app.data.tilt.activeUntil) return;
    if (syncTilt(false)) {
      save();
      if (!app.data.tilt.activeUntil) app.ui.toast('Pauza je završena. Vrati se planu.', 'info');
    }
    renderTilt();
  }

  // --- Events -----------------------------------------------------------------

  doc.addEventListener('click', (event) => {
    const target = event.target.closest('[data-go]');
    if (!target) return;
    event.preventDefault();
    // Tapping the tab you are already on must not redraw the view: that would wipe a half-filled form.
    if (target.dataset.go === app.view) win.scrollTo(0, 0);
    else go(target.dataset.go);
  });
  const viewFromHash = () => win.location.hash.slice(1);
  win.addEventListener('popstate', () => go(viewFromHash(), { push: false }));
  win.addEventListener('hashchange', () => go(viewFromHash(), { push: false }));

  $('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const balance = Number($('#setup-balance').value);
    const error = $('#setup-error');
    const valid = Number.isFinite(balance) && balance > 0;
    error.hidden = valid;
    error.textContent = valid ? '' : 'Unesi početni balans veći od nule.';
    if (!valid) return;
    commit((data) => {
      data.startingBalance = balance;
    });
    $('#setup-balance').value = '';
    app.ui.toast('Dnevnik je pokrenut.', 'success');
  });
  $('#setup-import').addEventListener('click', () => importBackup());
  $('#open-info').addEventListener('click', () => openInfo(app));
  $('#open-settings').addEventListener('click', () => openSettings(app));
  $('#tilt-hide').addEventListener('click', () => {
    app.tiltHidden = app.data.tilt.activeUntil;
    renderTilt();
  });

  // --- Start ------------------------------------------------------------------

  const loaded = await adapter.load();
  app.data = loaded.doc;
  const today = new Date(app.now());
  app.month = { year: today.getFullYear(), month: today.getMonth() };
  app.view = VIEWS[viewFromHash()] ? viewFromHash() : DEFAULT_VIEW;
  if (syncTilt(false) || loaded.source === 'legacy') save();

  doc.getElementById('boot-note')?.remove();
  render();

  if (loaded.source === 'legacy') {
    const n = app.data.trades.length;
    const note = loaded.skipped ? ` Preskočeno ${loaded.skipped} bez ispravnih cena.` : '';
    app.ui.toast(`Podaci iz v1 su preuzeti: ${n} ${tradesWord(n)}.${note}`, loaded.skipped ? 'warning' : 'success');
  } else if (loaded.source === 'corrupt') {
    app.ui.toast('Sačuvani podaci nisu mogli da se pročitaju. Njihova kopija je ostala u browseru.', 'error');
  }

  const timer = win.setInterval(tick, 1000);
  app.destroy = () => win.clearInterval(timer);
  return app;
}
