// Runs the real app against the real index.html in a simulated browser (jsdom).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createApp } from '../js/app.js';
import { STORAGE_KEY } from '../js/store.js';

const PAGE = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const NOON = new Date(2026, 10, 10, 12, 0).getTime(); // 10 Nov 2026, local time
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boot(t, { seed = {}, start = true } = {}) {
  const dom = new JSDOM(PAGE, { url: 'http://localhost:8080/', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  window.scrollTo = () => {};
  for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, value);

  const app = await createApp({ document, window });
  app.now = () => NOON;
  app.month = { year: 2026, month: 10 };
  const downloads = [];
  app.ui.download = (name, type, content) => downloads.push({ name, type, content });
  t.after(() => {
    app.destroy();
    window.close();
  });

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const fill = (form, values) => {
    for (const [name, value] of Object.entries(values)) {
      const radio = [...form.querySelectorAll(`input[type="radio"][name="${name}"]`)].find((el) => el.value === value);
      if (radio) radio.checked = true;
      else form.querySelector(`[name="${name}"]`).value = value;
    }
    fire(form, 'input');
  };
  const TRADE = {
    pair: 'EURUSD', date: '2026-11-10T10:00', direction: 'Long', riskPercent: '1', entry: '1.1000',
    stopLoss: '1.0970', takeProfit: '1.1090', setup: 'Breakout', session: 'London', emotion: '5',
    followedPlan: 'yes', result: 'Win', notes: '',
  };
  const addTrade = (over = {}) => {
    app.go('novi');
    const form = $('#new-form');
    const values = { ...TRADE, ...over };
    for (const key of Object.keys(values)) if (values[key] === null) delete values[key];
    fill(form, values);
    fire(form, 'submit');
    return form;
  };
  const rows = () => {
    app.go('istorija');
    return $$('#history-rows tr');
  };
  const text = (selector) => $(selector).textContent.trim();
  const saved = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY));

  if (start) {
    $('#setup-balance').value = '10000';
    fire($('#setup-form'), 'submit');
  }
  return { app, window, document, $, $$, fire, fill, addTrade, rows, text, saved, downloads };
}

test('Prvo pokretanje: traži početni balans, odbija nulu, pa otvara dnevnik', async (t) => {
  const { $, fire, text, saved } = await boot(t, { start: false });
  assert.equal($('#setup').hidden, false);
  assert.equal($('#app').hidden, true);
  assert.equal($('#boot-note'), null);

  $('#setup-balance').value = '0';
  fire($('#setup-form'), 'submit');
  assert.equal($('#setup-error').hidden, false);
  assert.equal($('#app').hidden, true);

  $('#setup-balance').value = '10000';
  fire($('#setup-form'), 'submit');
  assert.equal($('#setup').hidden, true);
  assert.equal($('#app').hidden, false);
  assert.equal(text('#header-balance'), '$10,000.00');
  assert.equal(saved().startingBalance, 10000);
});

test('Unos Win trade-a: pregled pokazuje +300 $, balans 10.300 $ i podaci su sačuvani', async (t) => {
  const { app, addTrade, rows, text, saved } = await boot(t);
  addTrade();
  assert.equal(app.view, 'istorija', 'posle čuvanja prelazi na istoriju');
  assert.equal(rows().length, 1);
  app.go('pregled');
  assert.equal(text('#stat-net-pnl'), '+$300.00');
  assert.equal(text('#header-balance'), '$10,300.00');
  assert.equal(text('#stat-win-rate'), '100.0%');
  assert.equal(text('#stat-avg-r'), '+3.00R');
  assert.equal(text('#stat-count'), '1');
  assert.equal(text('#goal-trades'), '1 / 5');
  assert.equal(text('#goal-plan'), '1 / 1');
  assert.equal(text('#header-streak'), '1');
  assert.equal(saved().trades.length, 1);
  assert.equal(saved().trades[0].riskAmount, 100);
});

test('Forma pokazuje rizik u $, R:R i mogući dobitak dok se kuca', async (t) => {
  const { app, $, fill } = await boot(t);
  app.go('novi');
  const form = $('#new-form');
  fill(form, { direction: 'Long', riskPercent: '2', entry: '1.1000', stopLoss: '1.0950', takeProfit: '1.1100' });
  assert.equal(form.querySelector('[data-preview="risk"]').textContent, '$200.00');
  assert.equal(form.querySelector('[data-preview="rr"]').textContent, '1 : 2.00');
  assert.equal(form.querySelector('[data-preview="gain"]').textContent, '$400.00');
});

test('Bez smera trade se ne čuva i greška stoji uz polje', async (t) => {
  const { addTrade, rows, $ } = await boot(t);
  const form = addTrade({ direction: null });
  assert.equal(form.querySelector('[data-error="direction"]').hidden, false);
  assert.match(form.querySelector('[data-error="direction"]').textContent, /Buy ili Sell/);
  assert.equal($('#new-form'), form, 'forma ostaje sa unetim vrednostima');
  assert.equal(form.querySelector('[name="pair"]').value, 'EURUSD');
  assert.equal(rows().length, 0);
});

test('Stop Loss na pogrešnoj strani i unos bez Result-a se odbijaju', async (t) => {
  const { addTrade, rows } = await boot(t);
  assert.equal(addTrade({ stopLoss: '1.1050' }).querySelector('[data-error="stopLoss"]').hidden, false);
  assert.equal(addTrade({ result: null }).querySelector('[data-error="result"]').hidden, false);
  assert.equal(rows().length, 0);
});

test('HTML u paru i napomeni ostaje tekst', async (t) => {
  const { addTrade, rows, $$, app, $ } = await boot(t);
  addTrade({ pair: '<b>x</b>', notes: '<img src=x onerror="window.hacked=1">' });
  const [row] = rows();
  assert.ok(row, 'trade je sačuvan');
  assert.equal(row.querySelector('.pair').textContent, '<B>X</B>');
  assert.equal($$('#history-rows b, #history-rows img').length, 0);
  row.querySelector('[data-action="edit"]').click();
  assert.equal($('#edit-form [name="notes"]').value, '<img src=x onerror="window.hacked=1">');
  assert.equal($$('#edit-form img').length, 0);
  assert.equal(app.win.hacked, undefined);
});

test('Dva trade-a u istom minutu: brisanje jednog ne dira drugi', async (t) => {
  const { addTrade, rows, $ } = await boot(t);
  addTrade({ pair: 'AAA' });
  addTrade({ pair: 'BBB' });
  const target = rows().find((row) => row.textContent.includes('AAA'));
  target.querySelector('[data-action="delete"]').click();
  assert.equal(rows().length, 2, 'ništa se ne briše pre potvrde');
  $('[data-answer="yes"]').click();
  await settle();
  const left = rows();
  assert.equal(left.length, 1);
  assert.ok(left[0].textContent.includes('BBB'));
});

test('Brisanje se može otkazati', async (t) => {
  const { addTrade, rows, $ } = await boot(t);
  addTrade();
  rows()[0].querySelector('[data-action="delete"]').click();
  $('[data-answer="no"]').click();
  await settle();
  assert.equal(rows().length, 1);
});

test('Izmena menja sva polja, uključujući datum, rizik i smer', async (t) => {
  const { app, addTrade, rows, $, fill, fire, text, saved } = await boot(t);
  addTrade();
  rows()[0].querySelector('[data-action="edit"]').click();
  const form = $('#edit-form');
  assert.equal(form.querySelector('[name="date"]').value, '2026-11-10T10:00');
  assert.equal(form.querySelector('[name="direction"][value="Long"]').checked, true);
  fill(form, {
    date: '2026-11-09T08:15', direction: 'Short', riskPercent: '2',
    entry: '1.2000', stopLoss: '1.2050', takeProfit: '1.1900', result: 'Loss',
  });
  fire(form, 'submit');
  assert.equal($('#edit-form'), null, 'dijalog se zatvara');
  const trade = saved().trades[0];
  assert.deepEqual(
    [trade.date, trade.direction, trade.riskPercent, trade.riskAmount, trade.result],
    ['2026-11-09T08:15', 'Short', 2, 200, 'Loss'],
  );
  app.go('pregled');
  assert.equal(text('#stat-net-pnl'), '-$200.00');
});

test('Izmena sa pogrešnim Stop Loss-om se odbija i trade ostaje isti', async (t) => {
  const { app, addTrade, rows, $, fill, fire, text } = await boot(t);
  addTrade();
  rows()[0].querySelector('[data-action="edit"]').click();
  const form = $('#edit-form');
  fill(form, { stopLoss: '1.1500' });
  fire(form, 'submit');
  assert.equal(form.querySelector('[data-error="stopLoss"]').hidden, false);
  assert.ok($('#edit-form'), 'dijalog ostaje otvoren');
  $('#edit-form [data-cancel]').click();
  app.go('pregled');
  assert.equal(text('#stat-net-pnl'), '+$300.00');
});

test('Tilt: tri gubitka zaključavaju unos, a po isteku pauze unos radi', async (t) => {
  const { app, addTrade, rows, $ } = await boot(t);
  for (const hour of ['09', '10', '11']) addTrade({ result: 'Loss', date: `2026-11-10T${hour}:00` });
  assert.equal(rows().length, 3);
  assert.equal($('#tilt').hidden, false);
  assert.match($('#tilt-text').textContent, /3 gubitka zaredom/);
  assert.equal($('#tilt-clock').textContent, '15:00');

  app.go('novi');
  assert.equal($('#new-form [type="submit"]').disabled, true);
  assert.equal($('#new-form [data-tilt-note]').hidden, false);
  addTrade({ date: '2026-11-10T11:30' });
  assert.equal(rows().length, 3, 'unos je zaključan');

  $('#tilt-hide').click();
  assert.equal($('#tilt').hidden, true, 'baner se može sakriti');
  app.go('novi');
  assert.equal($('#new-form [type="submit"]').disabled, true, 'ali unos ostaje zaključan');

  app.now = () => NOON + 15 * 60_000;
  app.tick();
  app.go('novi');
  assert.equal($('#new-form [type="submit"]').disabled, false);
  app.tick();
  assert.equal(app.data.tilt.activeUntil, null, 'ista serija ne zaključava ponovo');
  addTrade({ result: 'Loss', date: '2026-11-10T11:45' });
  assert.equal(rows().length, 4);
  assert.equal($('#tilt').hidden, false, 'sledeći gubitak ponovo zaključava');
});

test('Dnevni limiti: upozorenje kada se dostigne broj trade-ova', async (t) => {
  const { app, addTrade, $, text } = await boot(t);
  for (let i = 0; i < 5; i += 1) addTrade({ date: `2026-11-10T0${i}:30` });
  app.go('pregled');
  assert.equal(text('#goal-trades'), '5 / 5');
  assert.ok($('#limit-note'));
  assert.equal($('[data-day="2026-11-10"]').classList.contains('profit'), true, 'trade u 00:30 je na svom danu');
  assert.equal($('[data-day="2026-11-09"]').classList.contains('profit'), false);
  assert.equal($('[data-day="2026-11-10"]').classList.contains('today'), true);
});

test('Kalendar: prelazak između meseci', async (t) => {
  const { app, $, text } = await boot(t);
  app.go('pregled');
  assert.equal(text('#cal-month'), 'Novembar 2026');
  $('[data-month="1"]').click();
  $('[data-month="1"]').click();
  assert.equal(text('#cal-month'), 'Januar 2027');
  $('[data-month="-1"]').click();
  assert.equal(text('#cal-month'), 'Decembar 2026');
});

test('Istorija: pretraga i filter po rezultatu', async (t) => {
  const { addTrade, rows, $, $$, fire, text } = await boot(t);
  addTrade({ pair: 'EURUSD', date: '2026-11-08T10:00' });
  addTrade({ pair: 'GBPJPY', date: '2026-11-09T10:00', result: 'Loss', session: 'Asia' });
  addTrade({ pair: 'XAUUSD', date: '2026-11-10T10:00', result: 'BE' });
  assert.deepEqual(rows().map((row) => row.querySelector('.pair').textContent), ['XAUUSD', 'GBPJPY', 'EURUSD']);

  $('#history-search').value = 'asia';
  fire($('#history-search'), 'input');
  assert.equal($$('#history-rows tr').length, 1);
  assert.equal(text('#history-count'), '1 od 3 trade-a');

  $('#history-search').value = '';
  fire($('#history-search'), 'input');
  $('#history-result').value = 'BE';
  fire($('#history-result'), 'change');
  assert.deepEqual($$('#history-rows .pair').map((el) => el.textContent), ['XAUUSD']);
});

test('Analitika: po setup-u, po sesiji, najbolje i najgore', async (t) => {
  const { app, addTrade, text } = await boot(t);
  addTrade({ date: '2026-11-08T10:00', emotion: '3' });
  addTrade({ date: '2026-11-09T10:00', result: 'Loss', session: 'Asia', setup: 'Range', emotion: '8' });
  app.go('analitika');
  assert.match(text('#by-session'), /Asia\s*1\s*0\.0%\s*-\$103\.00/);
  assert.match(text('#by-session'), /London\s*1\s*100\.0%\s*\+\$300\.00/);
  assert.match(text('#best-worst'), /Najbolja sesija\s*London/);
  assert.match(text('#best-worst'), /Najgori setup\s*Range/);
  assert.match(text('#emotions'), /Prosek kod Win\s*3\.0 \/ 10/);
  assert.match(text('#emotions'), /Prosek kod Loss\s*8\.0 \/ 10/);
});

test('CSV izvoz: zaglavlje, brojevi i neutralisana formula u napomeni', async (t) => {
  const { addTrade, rows, $, downloads } = await boot(t);
  addTrade({ notes: '=SUM(A1:A9), "citat"' });
  rows();
  $('#history-export').click();
  const [file] = downloads;
  assert.equal(file.name, 'golden-trading-journal.csv');
  const lines = file.content.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Date,Pair,Direction/);
  assert.match(lines[1], /"EURUSD","Buy","Breakout","London",1,100\.00,1\.1,1\.097,1\.109,,3\.00,3\.00,300\.00,"Win","Yes",5,/);
  assert.ok(lines[1].endsWith(`"'=SUM(A1:A9), ""citat"""`));
});

test('Backup se preuzima i vraća isto stanje', async (t) => {
  const { app, addTrade, $, downloads, rows, text } = await boot(t);
  addTrade();
  $('#open-settings').click();
  $('#backup-download').click();
  const [file] = downloads;
  assert.match(file.name, /^golden-journal-backup-2026-11-10\.json$/);
  const before = structuredClone(app.data);

  app.reset();
  assert.equal($('#setup').hidden, false);
  app.restoreFromText(file.content);
  assert.deepEqual(app.data, before);
  assert.equal(rows().length, 1);
  assert.equal(text('#header-balance'), '$10,300.00');
});

test('Backup iz v1 se učitava, a neispravan fajl ne menja ništa', async (t) => {
  const { app, addTrade, rows, text } = await boot(t);
  addTrade();
  assert.throws(() => app.restoreFromText('{"nije":"backup"}'), /nije backup dnevnika/);
  assert.equal(rows().length, 1);

  const v1 = {
    startingBalance: '5000', backupDate: '2026-11-01T00:00:00.000Z',
    settings: { maxTradesPerDay: 3, maxDailyLossPercent: 2, tiltLossThreshold: 3, tiltBreakMinutes: 15 },
    trades: [1, 2].map((day) => ({
      pair: 'GBPUSD', date: `2026-11-0${day}T10:00`, direction: 'Long', riskPercent: '1',
      entry: '1.3', stopLoss: '1.295', takeProfit: '1.31', positionSize: '10000', rMultiple: '2',
      setup: 'Pullback', session: 'New York', emotion: 4, followedPlan: 'Yes', notes: '', result: 'Win', exitPrice: null,
    })),
  };
  app.restoreFromText(JSON.stringify(v1));
  assert.equal(rows().length, 2);
  assert.equal(text('#header-balance'), '$5,202.00'); // +100, zatim 2R na 1% od 5.100 $
  assert.equal(app.data.settings.maxTradesPerDay, 3);
});

test('Podaci iz v1 u browseru se preuzimaju pri prvom pokretanju', async (t) => {
  const seed = {
    golden_balance: '10000',
    golden_trades: JSON.stringify([{
      pair: 'EURUSD', date: '2026-11-05T10:00', direction: 'Long', riskPercent: '1', entry: '1.1',
      stopLoss: '1.097', takeProfit: '1.109', positionSize: '33333.3333333333333333', rMultiple: '3',
      setup: 'Breakout', session: 'London', emotion: 5, followedPlan: 'Yes', notes: '', result: 'Win', exitPrice: null,
    }]),
  };
  const { $, text, rows, saved, window } = await boot(t, { seed, start: false });
  assert.equal($('#app').hidden, false, 'nema ekrana za početni balans');
  assert.equal(text('#header-balance'), '$10,300.00');
  assert.equal(rows().length, 1);
  assert.equal(saved().trades.length, 1);
  assert.ok(window.localStorage.getItem('golden_trades'), 'v1 podaci nisu obrisani');
});

test('Podešavanja: čuvaju se ispravne vrednosti, neispravne se odbijaju', async (t) => {
  const { app, $, fill, fire, text } = await boot(t);
  $('#open-settings').click();
  let form = $('#settings-form');
  fill(form, { maxTradesPerDay: '0' });
  fire(form, 'submit');
  assert.equal(form.querySelector('[data-error="maxTradesPerDay"]').hidden, false);
  assert.equal(app.data.settings.maxTradesPerDay, 5);

  fill(form, { maxTradesPerDay: '2', maxDailyLossPercent: '1.5', tiltLossThreshold: '2', tiltBreakMinutes: '30', startingBalance: '25000' });
  fire(form, 'submit');
  assert.equal($('#settings-form'), null);
  assert.deepEqual(app.data.settings, { maxTradesPerDay: 2, maxDailyLossPercent: 1.5, tiltLossThreshold: 2, tiltBreakMinutes: 30 });
  assert.equal(text('#header-balance'), '$25,000.00');
});

test('Reset traži potvrdu, briše sve i vraća na početni ekran', async (t) => {
  const { addTrade, $, saved } = await boot(t);
  addTrade();
  $('#open-settings').click();
  $('#journal-reset').click();
  assert.equal(saved().trades.length, 1, 'ništa se ne briše pre potvrde');
  $('[data-answer="yes"]').click();
  await settle();
  assert.equal($('#setup').hidden, false);
  assert.equal(saved().startingBalance, null);
  assert.equal(saved().trades.length, 0);
});

test('Navigacija: tabovi menjaju prikaz, Escape zatvara dijalog', async (t) => {
  const { app, $, $$, window, document } = await boot(t);
  $('.tab[data-go="analitika"]').click();
  assert.equal(app.view, 'analitika');
  assert.equal(window.location.hash, '#analitika');
  assert.deepEqual($$('.tab[aria-current="page"]').map((el) => el.dataset.go), ['analitika']);
  assert.equal($('.view-title').textContent, 'Analitika');

  app.go('novi');
  $('#new-form [name="pair"]').value = 'GBPUSD';
  $('.tab[data-go="novi"]').click();
  assert.equal($('#new-form [name="pair"]').value, 'GBPUSD', 'dodir na aktivan tab ne briše formu');

  $('#open-info').click();
  assert.ok($('.modal'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('.modal'), null);
});
