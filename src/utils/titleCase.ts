/**
 * The first letter of every word uppercased, the rest left exactly as typed.
 *
 * Used for the root card's title when a mind map is created: the file name is
 * the course chapter's own name (« chapitre 1 – les nombres relatifs ») and the
 * card that carries it should read as a title, not as a file name.
 *
 * Only the FIRST letter changes, never the case of the others: lowercasing the
 * remainder would turn « les ADN » into « Les Adn » and mangle every acronym,
 * roman numeral and proper noun a course title carries.
 *
 * A word only counts when it STARTS with a letter, so « 3ème chapitre » keeps
 * its « 3ème » instead of becoming « 3Ème ». Only whitespace separates words —
 * an apostrophe or a hyphen does not, which is what French titles expect
 * (« l'addition » → « L'addition », « peut-être » → « Peut-être »).
 */
export function titleCase(name: string): string {
  return name.replace(/(^|\s)(\p{L})(\p{L}*)/gu, (_whole, separator: string, first: string, rest: string) => {
    return `${separator}${first.toLocaleUpperCase('fr')}${rest}`
  })
}
