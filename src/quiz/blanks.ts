import type { QuizDifficulty } from '../types/quiz'
import { normalizeForComparison } from '../utils/textSimilarity'

/**
 * One character position of the answer, as the fill-in-the-blank field draws it.
 *
 * `fillable` marks the positions the user actually has to find: letters and
 * decimal digits. Everything else — spaces, hyphens, apostrophes, operators,
 * superscripts like « ² » — is structure, not content, and is always shown.
 * Handing those over for free is what makes the blank readable as a *shape*
 * (« B____ d___ » reads as two words) instead of an undifferentiated wall.
 */
export interface BlankSlot {
  index: number
  char: string
  fillable: boolean
}

/** `\p{Nd}` deliberately excludes superscript/other Unicode number categories. */
const FILLABLE = /[\p{L}\p{Nd}]/u

export function slotsOf(target: string): BlankSlot[] {
  return Array.from(target).map((char, index) => ({ index, char, fillable: FILLABLE.test(char) }))
}

export function fillableIndices(target: string): number[] {
  return slotsOf(target)
    .filter(slot => slot.fillable)
    .map(slot => slot.index)
}

/**
 * The order in which letters are handed to the user as help, most useful first.
 *
 * The first letter always comes first — it is the single strongest cue for
 * recalling a word, and it is what makes the hardest level (« B_______ ») still
 * a question rather than a blank stare. After that each pick is the position
 * *furthest from every letter already revealed*, so help spreads across the
 * whole answer instead of unveiling one readable end and leaving the rest
 * untouched. Ties go to the leftmost position, which keeps the whole thing
 * deterministic: the same card asked twice reveals the same letters in the
 * same order, so re-reading a half-revealed answer never reshuffles under the
 * user's eyes.
 */
export function revealOrder(target: string): number[] {
  const remaining = fillableIndices(target)
  if (remaining.length === 0) return []
  const order = [remaining.shift() as number]
  while (remaining.length > 0) {
    let bestPosition = 0
    let bestDistance = -1
    for (let i = 0; i < remaining.length; i += 1) {
      const distance = Math.min(...order.map(revealed => Math.abs(revealed - remaining[i])))
      if (distance > bestDistance) {
        bestDistance = distance
        bestPosition = i
      }
    }
    order.push(remaining[bestPosition])
    remaining.splice(bestPosition, 1)
  }
  return order
}

/**
 * How much of the answer each difficulty gives away up front. `difficile` is 0
 * — the `Math.max(1, …)` below still concedes the first letter, which is the
 * « B_______ » the hardest level is meant to be.
 */
const REVEAL_RATIO: Record<QuizDifficulty, number> = {
  facile: 0.5,
  moyen: 0.25,
  difficile: 0,
}

export function baseRevealCount(target: string, difficulty: QuizDifficulty): number {
  const count = fillableIndices(target).length
  if (count === 0) return 0
  return Math.min(count, Math.max(1, Math.round(count * REVEAL_RATIO[difficulty])))
}

/**
 * Which positions are shown for free right now: the difficulty's baseline plus
 * one letter per failed attempt (`extraReveals`).
 *
 * That growth is the whole point of the retry loop — a wrong answer buys a
 * letter instead of the solution, so the user keeps searching with more to go
 * on rather than being handed the word and learning nothing. It converges: once
 * every position is revealed the answer is legible, so no card can trap the
 * quiz in an unanswerable state.
 */
export function revealedSet(
  target: string,
  difficulty: QuizDifficulty,
  extraReveals: number = 0
): Set<number> {
  const order = revealOrder(target)
  const count = Math.min(order.length, baseRevealCount(target, difficulty) + Math.max(0, extraReveals))
  return new Set(order.slice(0, count))
}

/** True once help has grown to cover the whole answer — nothing left to give. */
export function isFullyRevealed(target: string, revealed: ReadonlySet<number>): boolean {
  return fillableIndices(target).every(index => revealed.has(index))
}

/**
 * The positions the user types into: fillable, minus the ones already given.
 * The field keeps its typed characters in an array parallel to THIS list (one
 * entry per box the user can actually edit), which is what lets typing skip
 * over spaces and revealed letters without any cursor arithmetic.
 */
export function editableIndices(target: string, revealed: ReadonlySet<number>): number[] {
  return fillableIndices(target).filter(index => !revealed.has(index))
}

/**
 * The candidate answer as a plain string, ready for `computeTitleSimilarity`.
 *
 * Structure and revealed letters come from the target, so the user is only ever
 * graded on the part they were actually asked for. An unfilled box contributes
 * nothing rather than a placeholder character: a half-typed answer must score
 * as incomplete, and a literal « _ » in the string would be graded as a wrong
 * letter, which reads the same but for the wrong reason.
 */
export function assembleAnswer(
  target: string,
  revealed: ReadonlySet<number>,
  typed: readonly string[]
): string {
  const editable = editableIndices(target, revealed)
  const typedByIndex = new Map<number, string>()
  editable.forEach((index, position) => {
    const char = typed[position]
    if (char) typedByIndex.set(index, char)
  })
  return slotsOf(target)
    .map(slot => (slot.fillable && !revealed.has(slot.index) ? (typedByIndex.get(slot.index) ?? '') : slot.char))
    .join('')
}

/** Per-letter grading, accent- and case-insensitive like the whole-answer score. */
export function matchesTarget(typedChar: string, targetChar: string): boolean {
  return normalizeForComparison(typedChar) === normalizeForComparison(targetChar)
}

/**
 * Absorbs a keystroke that only repeats the letter the field just skipped.
 *
 * Structure and revealed letters are never typed — they are shown for free
 * and the next editable box comes right after them. But a user spelling the
 * word naturally still "says" that letter as they go, and if it lands in the
 * box meant for something else, it would be graded as a wrong guess for the
 * wrong reason. So: when the newly typed letter matches the one just skipped
 * AND does not answer the current box, the keystroke is dropped rather than
 * filed as a mistake. It must NOT fire when the skipped letter and the
 * current box's answer happen to be the same letter (e.g. a double letter
 * around a reveal) — there, the keystroke genuinely answers the box.
 *
 * Only handles the common case of one character typed forward (`nextTyped`
 * one longer than `previousTyped`); a deletion, a paste, or an in-place
 * replacement passes through untouched.
 */
export function resolveTypedInsert(
  target: string,
  revealed: ReadonlySet<number>,
  previousTyped: readonly string[],
  nextTyped: readonly string[]
): string[] {
  if (nextTyped.length !== previousTyped.length + 1) return [...nextTyped]

  let position = 0
  while (position < previousTyped.length && previousTyped[position] === nextTyped[position]) position++
  const insertedChar = nextTyped[position]

  const editable = editableIndices(target, revealed)
  const targetIndex = editable[position]
  const previousTargetIndex = position > 0 ? editable[position - 1] : -1
  const justSkipped = targetIndex - previousTargetIndex > 1 ? target[targetIndex - 1] : null

  if (justSkipped !== null && matchesTarget(insertedChar, justSkipped) && !matchesTarget(insertedChar, target[targetIndex])) {
    return [...previousTyped]
  }
  return [...nextTyped]
}

/**
 * Carry a half-typed answer across a change in what is revealed.
 *
 * A failed attempt hands over one more letter, which removes a box from the
 * middle of the field. Clearing the whole answer at that moment would punish
 * the user for being close — they would retype twenty characters to fix one.
 * This re-anchors what they already wrote to the positions it belonged to and
 * drops only the letter the app has now filled in for them.
 *
 * The result stays dense (no holes), because the new editable list is the old
 * one minus some entries, in the same order.
 */
export function remapTyped(
  target: string,
  previousRevealed: ReadonlySet<number>,
  previousTyped: readonly string[],
  nextRevealed: ReadonlySet<number>
): string[] {
  const previousEditable = editableIndices(target, previousRevealed)
  const byIndex = new Map<number, string>()
  previousEditable.forEach((index, position) => {
    const char = previousTyped[position]
    if (char) byIndex.set(index, char)
  })
  const carried = editableIndices(target, nextRevealed).map(index => byIndex.get(index) ?? '')
  // Trailing empties are just "not typed yet" and would otherwise make the
  // caret sit past the end of what the user actually wrote.
  while (carried.length > 0 && carried[carried.length - 1] === '') carried.pop()
  return carried
}
