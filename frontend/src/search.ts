// Finding lines: hieroglyphic lines by their signs (the query read as MdC), text lines by text.

import { asciiToUnicode } from './translit';
import type { Line } from './types';

export type SearchScope = 'all' | 'hiero' | 'text';

/** Format controls, damage/lost marks and variation selectors: what is left are the signs. */
const NON_SIGNS = /[\u{13430}-\u{1345F}︀-️]/gu;

/** The signs of a Unicode encoding, in order, without the controls that arrange them. */
export const signsOf = (unicode: string) => unicode.replace(NON_SIGNS, '');

export interface SearchQuery {
  text: string;
  /** The query read as MdC (its signs); empty if it is not MdC, e.g. an English word. */
  signs: string;
  scope: SearchScope;
}

/** Whether a line matches the query. */
export function lineMatches(line: Line, q: SearchQuery): boolean {
  if (!q.text) return false;
  if (line.mode === 'hiero') {
    if (q.scope === 'text') return false;
    // The signs (whatever way they were typed), or the MdC as typed (e.g. a |B237 reference).
    return (!!q.signs && !!line.rendered && signsOf(line.rendered).includes(q.signs)) || line.source.includes(q.text);
  }
  if (q.scope === 'hiero') return false;
  const lower = q.text.toLowerCase();
  if (line.mode === 'translit') {
    // ASCII as typed (case is meaningful there: h and H differ), or the transliteration shown.
    return line.source.includes(q.text) || asciiToUnicode(line.source).toLowerCase().includes(lower);
  }
  return line.source.toLowerCase().includes(lower);
}

/** Splits text into [before, match, between, match, ..., after] around case-insensitive matches. */
export function splitMatches(text: string, query: string): string[] {
  if (!query) return [text];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: string[] = [];
  let pos = 0;
  for (let i = lower.indexOf(q); i >= 0 && q; i = lower.indexOf(q, pos)) {
    out.push(text.slice(pos, i), text.slice(i, i + q.length));
    pos = i + q.length;
  }
  out.push(text.slice(pos));
  return out;
}
