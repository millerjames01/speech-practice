/**
 * Catalan number words, for voice answers: recognisers write numbers as
 * digits ("a les 11"), lessons spell them out ("a les onze"). Each number
 * comes in every form an answer might use: masculine and feminine (un/una,
 * dos/dues, dos-cents/dues-centes) and, for one, the counting form "u".
 */

const UNITS = ['zero', 'u', 'dos', 'tres', 'quatre', 'cinc', 'sis', 'set', 'vuit', 'nou'];
const TEENS = ['deu', 'onze', 'dotze', 'tretze', 'catorze', 'quinze', 'setze', 'disset', 'divuit', 'dinou'];
const TENS = ['', '', 'vint', 'trenta', 'quaranta', 'cinquanta', 'seixanta', 'setanta', 'vuitanta', 'noranta'];

type Gender = 'm' | 'f';

function unit(n: number, g: Gender, standalone: boolean): string {
  if (n === 1) return g === 'f' ? 'una' : standalone ? 'u' : 'un';
  if (n === 2) return g === 'f' ? 'dues' : 'dos';
  return UNITS[n]!;
}

function upTo99(n: number, g: Gender, standalone: boolean): string {
  if (n < 10) return unit(n, g, standalone);
  if (n < 20) return TEENS[n - 10]!;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return TENS[t]!;
  return t === 2 ? `vint-i-${unit(u, g, standalone)}` : `${TENS[t]}-${unit(u, g, standalone)}`;
}

function upTo999(n: number, g: Gender, standalone: boolean): string {
  if (n < 100) return upTo99(n, g, standalone);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const hundreds = h === 1 ? 'cent' : `${unit(h, g, false)}-${g === 'f' ? 'centes' : 'cents'}`;
  return rest ? `${hundreds} ${upTo99(rest, g, false)}` : hundreds;
}

function words(n: number, g: Gender, standalone: boolean): string {
  if (n < 1000) return upTo999(n, g, standalone);
  const k = Math.floor(n / 1000);
  const rest = n % 1000;
  const thousands = k === 1 ? 'mil' : `${upTo999(k, g, false)} mil`;
  return rest ? `${thousands} ${upTo999(rest, g, false)}` : thousands;
}

/** Every spelling of a number up to 9999 an answer might use, masculine first. */
export function catalanNumber(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return [];
  const out = [words(n, 'm', false), words(n, 'f', false), words(n, 'm', true)];
  return [...new Set(out)];
}

/**
 * The spellings for a token a recogniser wrote with digits: "11", "21" or a
 * whole-hour time ("11:00", "11h"). Null for anything else.
 */
export function numberToken(token: string): string[] | null {
  const m = token.match(/^(\d{1,4})(?::00|h)?$/);
  return m ? catalanNumber(Number(m[1])) : null;
}
