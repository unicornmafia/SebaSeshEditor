// ASCII (Manuel de Codage style) transliteration to Unicode; '^' capitalises the next letter.
// Must stay in sync with backend/app/translit.py.
const LOWER: Record<string, string> = {
  A: 'ꜣ', i: 'ꞽ', a: 'ꜥ', H: 'ḥ', x: 'ḫ',
  X: 'ẖ', S: 'š', K: 'ḳ', T: 'ṯ', D: 'ḏ',
};
const UPPER: Record<string, string> = {
  A: 'Ꜣ', i: 'Ꞽ', a: 'Ꜥ', H: 'Ḥ', x: 'Ḫ',
  X: 'H̱', S: 'Š', K: 'Ḳ', T: 'Ṯ', D: 'Ḏ',
};

export function asciiToUnicode(s: string): string {
  let out = '';
  let upper = false;
  for (const ch of s) {
    if (ch === '^' && !upper) {
      upper = true;
      continue;
    }
    if (upper) {
      out += UPPER[ch] ?? ch.toUpperCase();
      upper = false;
    } else {
      out += LOWER[ch] ?? ch;
    }
  }
  return upper ? out + '^' : out;
}
