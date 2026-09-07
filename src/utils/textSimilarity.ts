export function normalizeForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const distances: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) distances[i][0] = i
  for (let j = 0; j < cols; j++) distances[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1, distances[i - 1][j - 1] + cost)
    }
  }
  return distances[rows - 1][cols - 1]
}

/** Percentage similarity (0-100) between two strings, after accent/case normalization. */
export function computeTitleSimilarity(typed: string, real: string): number {
  const a = normalizeForComparison(typed)
  const b = normalizeForComparison(real)
  if (a === b) return 100
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 100
  const distance = levenshteinDistance(a, b)
  return Math.max(0, Math.round((1 - distance / maxLength) * 100))
}

/** Feedback-badge color for a similarity percentage: green (close) -> amber -> red (far). */
export function similarityColor(pct: number): string {
  if (pct >= 85) return '#16a34a'
  if (pct >= 50) return '#d97706'
  return '#dc2626'
}
