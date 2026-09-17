/**
 * Any typed text turned into a kebab-case file-name component: lowercased,
 * every run of characters that isn't a letter or digit collapsed into a
 * single hyphen, and no leading or trailing hyphen.
 *
 * Used for the FILE a new mind map is written to — unlike the root card's
 * title (see `titleCase`), a file name should read the same regardless of
 * the punctuation, spacing or casing the user typed it with.
 */
export function kebabCase(name: string): string {
  const lower = name.toLocaleLowerCase('fr')
  const hyphenated = lower.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return hyphenated === '' ? 'sans-titre' : hyphenated
}
