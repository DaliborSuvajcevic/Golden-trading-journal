// Text formatting and safe HTML templating. No DOM access.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const renderValue = (value) => {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value == null || value === false) return '';
  return esc(value);
};

/**
 * Tagged template for markup. Every interpolated value is escaped,
 * unless it is itself the result of html`...`. User text can never become markup.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += renderValue(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const settle = (n) => (Math.abs(n) < 0.005 ? 0 : n); // avoids "-$0.00"

export function money(n) {
  const v = settle(n);
  return `${v < 0 ? '-' : ''}$${usd.format(Math.abs(v))}`;
}

export function signedMoney(n) {
  const v = settle(n);
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}$${usd.format(Math.abs(v))}`;
}

export const percent = (n, digits = 1) => `${n.toFixed(digits)}%`;

export function rValue(n) {
  const v = settle(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}R`;
}

/** CSS class for a number's sign: 'pos', 'neg' or ''. */
export const tone = (n) => (n >= 0.005 ? 'pos' : n <= -0.005 ? 'neg' : '');

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Value for a datetime-local input, in local time. */
export const localInputValue = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** "2026-11-10T00:30" -> "10.11.2026. 00:30" */
export function dateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
  return m ? `${m[3]}.${m[2]}.${m[1]}. ${m[4]}:${m[5]}` : String(value);
}

export const MONTHS = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun',
  'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar',
];

/** Milliseconds -> "MM:SS", rounded up so the clock never shows 00:00 while time remains. */
export function countdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Serbian plural: plural(3, 'gubitak', 'gubitka', 'gubitaka') -> 'gubitka'. */
export function plural(n, one, few, many) {
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

export const tradesWord = (n) => plural(n, 'trade', 'trade-a', 'trade-ova');
