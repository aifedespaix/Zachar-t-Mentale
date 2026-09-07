/**
 * Hangman-style guide: letters and decimal digits become blanks; everything
 * else (spaces, punctuation, operators, exponents like "²") stays visible —
 * `\p{Nd}` deliberately excludes superscript/other Unicode number categories.
 */
export function buildLengthGuide(realTitle: string): string {
  return Array.from(realTitle)
    .map(char => (/[\p{L}\p{Nd}]/u.test(char) ? '_' : char))
    .join('')
}
