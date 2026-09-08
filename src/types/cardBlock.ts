/**
 * A definition is a list of blocks, not a single string.
 *
 * The reason is pedagogical, not technical: a real definition mixes a rule in
 * French with the formula that illustrates it. A "mode per field" would force
 * a choice between the two, and the workaround — a level-4 "Exemple" card
 * created only to host the formula — is a structure imposed by a data
 * limitation rather than by the course.
 *
 * `Card.definition` does NOT go away. When `content` is present it becomes a
 * derived plain-text mirror of it (see `blocksToPlainText`), so everything
 * that already reads the field — the quiz's distractor pools and hints, the
 * XMind `notes.plain.content`, `salvage()` — keeps working on a degraded but
 * never empty value, instead of being rewritten all at once.
 */
export type CardBlock =
  | { kind: 'text'; text: string }
  /** `display` centres the formula on its own line, as opposed to inline in a sentence. */
  | { kind: 'math'; latex: string; display?: boolean }
  /**
   * `asset` is a file name inside the map's sidecar folder, never an absolute
   * path — an absolute path breaks the moment the workspace is moved or the
   * map is opened on another machine. `width`/`height` are captured at
   * insertion so the renderer can reserve the box before the file decodes.
   */
  | { kind: 'image'; asset: string; alt: string; width: number; height: number }
  | { kind: 'table'; header: string[]; rows: string[][] }

export type CardBlockKind = CardBlock['kind']
