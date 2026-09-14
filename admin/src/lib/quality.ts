import { repairCards, summarizeIssues, validateCards } from '@app/validation/cardsValidation'
import type { Card, CardLevel, MindMapMeta } from '@app/types/card'
import type { CardBlock } from '@app/types/cardBlock'

/**
 * « Est-ce que cette carte mentale est bonne ? », posée à un texte collé.
 *
 * Deux questions distinctes, délibérément séparées :
 *
 * 1. **Est-elle STRUCTURELLEMENT valide ?** C'est `validateCards`, importé de
 *    l'application de bureau — le MÊME code que celui qui décide si le canevas
 *    accepte d'ouvrir un fichier. Le recopier ici serait la garantie qu'un jour
 *    l'admin accepte un fichier que l'application refuse d'afficher.
 *
 * 2. **Est-elle QUALITATIVEMENT défendable ?** Ça, c'est ce module, et ça
 *    n'existe nulle part ailleurs, parce que l'application de bureau n'en a
 *    jamais eu besoin : elle ouvre ce que l'utilisateur a lui-même construit,
 *    carte par carte. Ici le texte arrive d'un coup, souvent d'un LLM, et les
 *    défauts sont d'un autre genre — des titres sans définition, des doublons
 *    entre frères, un arbre plat qui n'est qu'une liste déguisée. Rien de tout
 *    cela n'empêche le fichier de s'ouvrir ; tout cela en fait une mauvaise
 *    carte mentale.
 *
 * D'où la règle : la structure BLOQUE, la qualité AVERTIT. Un prof qui sait ce
 * qu'il fait doit pouvoir enregistrer une carte volontairement incomplète — un
 * squelette à remplir avec l'élève — sans que l'outil le lui interdise. Il ne
 * doit en revanche jamais pouvoir enregistrer un fichier qui plantera au
 * chargement.
 */

export type Severity = 'error' | 'warning'

export interface QualityFinding {
  severity: Severity
  /** Stable, pour les tests et pour un éventuel regroupement — jamais affiché. */
  code: string
  message: string
  /** Combien de cartes sont concernées, quand le constat est collectif. */
  count?: number
  /** Quelques exemples nommés : « et ça, où ? » est toujours la question suivante. */
  samples?: string[]
}

export interface MindMapStats {
  total: number
  byLevel: Record<CardLevel, number>
  detached: number
  withDefinition: number
  withImages: number
  /** La profondeur réellement atteinte (1 = une racine seule). */
  depth: number
}

export interface QualityReport {
  /** Les cartes exploitables, ou `null` quand le texte n'est même pas lisible. */
  cards: Card[] | null
  /** Le `meta` de l'enveloppe, quand le texte collé en portait une. */
  meta: MindMapMeta | null
  findings: QualityFinding[]
  stats: MindMapStats | null
  /**
   * Les problèmes bloquants sont STRUCTURELS, donc `repairCards` sait les
   * réparer. Un texte illisible, lui, ne se répare pas : il n'y a rien à
   * réparer.
   */
  repairable: boolean
  /** Rien ne s'oppose à l'enregistrement. Des avertissements, si. */
  saveable: boolean
}

/** Au-delà, une définition ne tient plus sur une carte : elle se lit, elle ne se révise pas. */
export const LONG_DEFINITION_CHARS = 600

/** Combien d'exemples on nomme dans un constat collectif avant de dire « … ». */
const MAX_SAMPLES = 4

function label(card: Card): string {
  return card.title.trim() === '' ? `(sans titre)` : card.title.trim()
}

function finding(
  severity: Severity,
  code: string,
  message: string,
  cards: readonly Card[] = []
): QualityFinding {
  if (cards.length === 0) return { severity, code, message }
  return {
    severity,
    code,
    message,
    count: cards.length,
    samples: cards.slice(0, MAX_SAMPLES).map(label),
  }
}

function blocksOf(card: Card): CardBlock[] {
  return Array.isArray(card.content) ? (card.content as CardBlock[]) : []
}

function hasSubstance(card: Card): boolean {
  if (typeof card.definition === 'string' && card.definition.trim() !== '') return true
  return blocksOf(card).length > 0
}

/**
 * Ce que le texte collé contient réellement, avant toute question de qualité.
 *
 * Accepte les DEUX formes que l'application écrit — le tableau nu d'un fichier
 * jamais synchronisé, et l'enveloppe `{ meta, cards }` d'un fichier publié —
 * parce que les deux circulent, et qu'un prof qui copie le contenu d'un `.zmap`
 * existant pour le retoucher tombera sur la seconde.
 */
export function parseMindMapText(raw: string): { cards: unknown[] | null; meta: MindMapMeta | null; error: string | null } {
  const text = raw.trim()
  if (text === '') return { cards: null, meta: null, error: 'Rien à valider : le texte est vide.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { cards: null, meta: null, error: `Ce n’est pas du JSON valide : ${detail}` }
  }

  if (Array.isArray(parsed)) return { cards: parsed, meta: null, error: null }

  if (parsed !== null && typeof parsed === 'object') {
    const envelope = parsed as { meta?: unknown; cards?: unknown }
    if (Array.isArray(envelope.cards)) {
      const meta =
        envelope.meta !== null && typeof envelope.meta === 'object' ? (envelope.meta as MindMapMeta) : null
      return { cards: envelope.cards, meta, error: null }
    }
    return {
      cards: null,
      meta: null,
      error: 'JSON valide, mais ce n’est pas une carte mentale : il faut une liste de cartes, ou un objet { meta, cards }.',
    }
  }

  return { cards: null, meta: null, error: 'JSON valide, mais ce n’est ni une liste de cartes ni un objet { meta, cards }.' }
}

function statsOf(cards: readonly Card[]): MindMapStats {
  const byLevel: Record<CardLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  let detached = 0
  let withDefinition = 0
  let withImages = 0
  for (const card of cards) {
    if (card.detached === true) {
      detached += 1
    } else if (card.level >= 1 && card.level <= 4) {
      byLevel[card.level as CardLevel] += 1
    }
    if (hasSubstance(card)) withDefinition += 1
    if (blocksOf(card).some(block => block.kind === 'image')) withImages += 1
  }
  const depth = ([4, 3, 2, 1] as CardLevel[]).find(level => byLevel[level] > 0) ?? 0
  return { total: cards.length, byLevel, detached, withDefinition, withImages, depth }
}

/**
 * Les remarques qui ne bloquent rien — le vrai apport de ce module.
 *
 * N'est appelée que sur une carte STRUCTURELLEMENT valide : sans ça, une carte
 * hors hiérarchie compterait comme « sans définition », et le rapport noierait
 * le seul problème qui compte sous des symptômes.
 */
export function qualityWarnings(cards: readonly Card[]): QualityFinding[] {
  const findings: QualityFinding[] = []
  const attached = cards.filter(card => card.detached !== true)
  const root = attached.find(card => card.parentId === null)

  const untitled = attached.filter(card => card.title.trim() === '')
  if (untitled.length > 0) {
    findings.push(
      finding('warning', 'untitled', 'Des cartes n’ont pas de titre : c’est le titre qu’on révise.', untitled)
    )
  }

  // Une carte `media` porte une image, pas une définition à réciter : lui
  // reprocher de ne pas en avoir serait un faux positif systématique.
  const hollow = attached.filter(
    card => card !== root && card.kind !== 'media' && !hasSubstance(card)
  )
  if (hollow.length > 0) {
    findings.push(
      finding(
        'warning',
        'no-definition',
        'Des cartes n’ont ni définition ni contenu : elles poseront une question sans réponse.',
        hollow
      )
    )
  }

  const siblingDuplicates = duplicateTitlesAmongSiblings(attached)
  if (siblingDuplicates.length > 0) {
    findings.push(
      finding(
        'warning',
        'duplicate-siblings',
        'Des cartes sœurs portent le même titre : impossible de les distinguer en révision.',
        siblingDuplicates
      )
    )
  }

  const verbose = attached.filter(
    card => (card.definition ?? '').trim().length > LONG_DEFINITION_CHARS
  )
  if (verbose.length > 0) {
    findings.push(
      finding(
        'warning',
        'long-definition',
        `Des définitions dépassent ${LONG_DEFINITION_CHARS} caractères : c’est un paragraphe de cours, pas une carte.`,
        verbose
      )
    )
  }

  // L'admin n'a pas de dossier d'accompagnement à téléverser : une carte collée
  // ici qui référence une image pointera dans le vide chez l'élève. C'est le
  // seul avertissement qui annonce une VRAIE casse à l'ouverture, d'où sa
  // formulation plus ferme.
  const withImages = cards.filter(card => blocksOf(card).some(block => block.kind === 'image'))
  if (withImages.length > 0) {
    findings.push(
      finding(
        'warning',
        'images',
        'Des cartes référencent des images : elles ne s’afficheront pas, car aucun fichier image n’accompagne un texte collé.',
        withImages
      )
    )
  }

  const floating = cards.filter(card => card.detached === true)
  if (floating.length > 0) {
    findings.push(
      finding('warning', 'detached', 'Des cartes sont volantes : hors de la hiérarchie, elles ne seront pas révisées.', floating)
    )
  }

  if (root !== undefined && attached.length === 1) {
    findings.push({ severity: 'warning', code: 'root-only', message: 'La carte ne contient que sa racine : il n’y a rien à réviser.' })
  } else if (root !== undefined && attached.every(card => card === root || card.level <= 2)) {
    findings.push({
      severity: 'warning',
      code: 'flat',
      message: 'L’arbre est plat (deux niveaux) : c’est une liste plutôt qu’une carte mentale.',
    })
  }

  return findings
}

/** Les cartes dont un frère porte exactement le même titre. */
function duplicateTitlesAmongSiblings(cards: readonly Card[]): Card[] {
  const byParent = new Map<string, Card[]>()
  for (const card of cards) {
    const key = card.parentId ?? '__root__'
    const group = byParent.get(key)
    if (group) group.push(card)
    else byParent.set(key, [card])
  }
  const duplicates: Card[] = []
  for (const group of byParent.values()) {
    const seen = new Map<string, number>()
    for (const card of group) {
      const key = card.title.trim().toLowerCase()
      if (key === '') continue
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const card of group) {
      if ((seen.get(card.title.trim().toLowerCase()) ?? 0) > 1) duplicates.push(card)
    }
  }
  return duplicates
}

/**
 * Le rapport complet sur un texte collé.
 *
 * `saveable` est faux dès qu'il reste une erreur — jamais pour un
 * avertissement. C'est la séparation qui rend l'outil utilisable : un prof qui
 * prépare un squelette à remplir en direct avec son élève doit pouvoir
 * l'enregistrer, et ne doit jamais pouvoir enregistrer un fichier qui refusera
 * de s'ouvrir.
 */
export function analyzeMindMapText(raw: string): QualityReport {
  const parsed = parseMindMapText(raw)
  if (parsed.cards === null) {
    return {
      cards: null,
      meta: null,
      findings: [{ severity: 'error', code: 'unreadable', message: parsed.error ?? 'Texte illisible.' }],
      stats: null,
      repairable: false,
      saveable: false,
    }
  }

  if (parsed.cards.length === 0) {
    return {
      cards: null,
      meta: parsed.meta,
      findings: [{ severity: 'error', code: 'empty', message: 'La liste de cartes est vide.' }],
      stats: null,
      repairable: false,
      saveable: false,
    }
  }

  const report = validateCards(parsed.cards)
  if (!report.valid) {
    return {
      cards: null,
      meta: parsed.meta,
      findings: [
        {
          severity: 'error',
          code: 'structure',
          message: 'La structure est invalide : l’application refuserait d’ouvrir ce fichier.',
          count: report.issues.length,
          samples: summarizeIssues(report.issues),
        },
        // Le détail carte par carte, en dessous : c'est lui qu'on relit pour
        // corriger le texte à la main plutôt que de le laisser réparer.
        ...report.issues.slice(0, 12).map(
          (issue): QualityFinding => ({ severity: 'error', code: `structure:${issue.kind}`, message: issue.message })
        ),
      ],
      // Tout ce que `validateCards` diagnostique, `repairCards` sait le
      // rattraper — c'est le contrat de cette paire dans l'application.
      repairable: true,
      stats: null,
      saveable: false,
    }
  }

  const cards = parsed.cards as Card[]
  return {
    cards,
    meta: parsed.meta,
    findings: qualityWarnings(cards),
    stats: statsOf(cards),
    repairable: false,
    saveable: true,
  }
}

/**
 * Le texte collé, réparé — le même `repairCards` que le canevas propose quand
 * il tombe sur un fichier cassé, réutilisé plutôt que réinventé.
 *
 * Retourne `null` quand il n'y a rien à réparer parce qu'il n'y a rien à lire.
 */
export function repairMindMapText(raw: string): Card[] | null {
  const parsed = parseMindMapText(raw)
  if (parsed.cards === null) return null
  return repairCards(parsed.cards)
}
