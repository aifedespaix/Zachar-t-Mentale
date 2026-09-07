export interface Oklch {
  l: number
  c: number
  h: number
}

function oklchToLinearRgb({ l: L, c: C, h: hDeg }: Oklch): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [r, g, bl]
}

function linearToGamma(c: number): number {
  const clamped = Math.min(1, Math.max(0, c))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

function relativeLuminance(gammaRgb: [number, number, number]): number {
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const [lr, lg, lb] = gammaRgb.map(toLinear)
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

export function oklchWcagContrast(a: Oklch, b: Oklch): number {
  const gammaA = oklchToLinearRgb(a).map(linearToGamma) as [number, number, number]
  const gammaB = oklchToLinearRgb(b).map(linearToGamma) as [number, number, number]
  const la = relativeLuminance(gammaA)
  const lb = relativeLuminance(gammaB)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

export function toCss({ l, c, h }: Oklch): string {
  return `oklch(${l} ${c} ${h})`
}

const WHITE: Oklch = { l: 1, c: 0, h: 0 }
const NEAR_BLACK: Oklch = { l: 0.18, c: 0, h: 0 }

/** Picks whichever of white/near-black text reads better (higher WCAG contrast) against `bg`. */
export function pickReadableTextColor(bg: Oklch): Oklch {
  return oklchWcagContrast(bg, WHITE) >= oklchWcagContrast(bg, NEAR_BLACK) ? WHITE : NEAR_BLACK
}
