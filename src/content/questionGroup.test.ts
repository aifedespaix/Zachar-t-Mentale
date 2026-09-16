import { describe, it, expect } from 'vitest'
import { blockGroups, nextQuestionLabel, normalizeContent, questionLabels, sanitizeBlocks } from './blocks'
import { blockAsTable, convertBlock } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

/**
 * Le groupe « question » après le passage au bouton d'ajout SÉPARÉ : le bloc
 * posé depuis l'extérieur porte un marqueur qui l'empêche d'être avalé par la
 * question au-dessus de lui, et chaque question porte une pastille — saisie à
 * la main, sinon déduite de la précédente.
 */

type Question = Extract<CardBlock, { kind: 'question' }>

const q = (text: string, extra: Partial<Question> = {}): CardBlock => ({ kind: 'question', text, ...extra })
const t = (text: string, standalone = false): CardBlock =>
  standalone ? { kind: 'text', text, standalone: true } : { kind: 'text', text }

describe('blockGroups — un bloc posé depuis l’extérieur de la question', () => {
  it('arrête la portée de la question au bloc marqué', () => {
    expect(blockGroups([q('Q1'), t('a'), t('b', true), t('c')])).toEqual([
      { headerIndex: 0, indexes: [0, 1] },
      { headerIndex: null, indexes: [2, 3] },
    ])
  })

  it('laisse la question seule quand le bloc marqué la suit directement', () => {
    expect(blockGroups([q('Q1'), t('a', true)])).toEqual([
      { headerIndex: 0, indexes: [0] },
      { headerIndex: null, indexes: [1] },
    ])
  })

  it('ne change rien hors de portée d’une question', () => {
    expect(blockGroups([t('a', true), t('b')])).toEqual([{ headerIndex: null, indexes: [0, 1] }])
  })
})

describe('convertBlock — le marqueur suit le bloc', () => {
  it('reste hors de la question quand un bloc extérieur change de type', () => {
    // Sans ce report, un changement de type par Tab ferait retomber le bloc
    // dans la question que le bouton extérieur venait justement de quitter.
    expect(convertBlock({ kind: 'text', text: 'a', standalone: true }, 'math')).toEqual({
      kind: 'math',
      latex: 'a',
      standalone: true,
    })
  })

  it('reste hors de la question en devenant un tableau', () => {
    expect(blockAsTable({ kind: 'text', text: 'a', standalone: true })).toEqual({
      kind: 'table',
      header: [],
      rows: [['a']],
      standalone: true,
    })
  })
})

describe('nextQuestionLabel — la pastille suivante', () => {
  it('incrémente le nombre arabe final, sans toucher au reste', () => {
    expect(nextQuestionLabel('1')).toBe('2')
    expect(nextQuestionLabel('9')).toBe('10')
    expect(nextQuestionLabel('Ex 3')).toBe('Ex 4')
  })

  it('avance la lettre latine finale en gardant la casse', () => {
    expect(nextQuestionLabel('a')).toBe('b')
    expect(nextQuestionLabel('A')).toBe('B')
    expect(nextQuestionLabel('z')).toBe('aa')
    expect(nextQuestionLabel('Z')).toBe('AA')
  })

  it('refuse de continuer un nombre romain plutôt que de le massacrer', () => {
    // « IV » donnerait « IW » par la règle des lettres : mieux vaut ne rien
    // proposer et laisser la pastille à saisir.
    expect(nextQuestionLabel('IV')).toBe('')
    expect(nextQuestionLabel('iii')).toBe('')
  })

  it('n’a rien à continuer d’une pastille vide ou finissant par un signe', () => {
    expect(nextQuestionLabel('')).toBe('')
    expect(nextQuestionLabel('   ')).toBe('')
    expect(nextQuestionLabel('Partie ?')).toBe('')
  })
})

describe('questionLabels — la pastille effective de chaque question', () => {
  it('part de 1 et suit la question précédente', () => {
    expect(questionLabels([q('Q1'), t('a'), q('Q2'), t('b'), q('Q3')])).toEqual(['1', '', '2', '', '3'])
  })

  it('laisse une pastille saisie gagner, et la transmet à la suivante', () => {
    expect(questionLabels([q('Q1', { label: 'a' }), q('Q2')])).toEqual(['a', 'b'])
  })

  it('laisse la suivante vide quand la précédente ne se continue pas', () => {
    const blocks: CardBlock[] = [q('Q1', { label: 'IV' }), q('Q2'), q('Q3')]
    expect(questionLabels(blocks)).toEqual(['IV', '', ''])
  })

  it('est tout vide quand il n’y a aucune question', () => {
    expect(questionLabels([t('a'), t('b')])).toEqual(['', ''])
  })
})

describe('sanitizeBlocks — la pastille et le marqueur traversent le fichier', () => {
  it('garde une pastille saisie sur une question', () => {
    expect(sanitizeBlocks([{ kind: 'question', text: 'Q', label: 'a' }])).toEqual([
      { kind: 'question', text: 'Q', label: 'a' },
    ])
  })

  it('jette une pastille blanche plutôt que de stocker des espaces', () => {
    expect(sanitizeBlocks([{ kind: 'question', text: 'Q', label: '   ' }])).toEqual([
      { kind: 'question', text: 'Q' },
    ])
  })

  it('garde le marqueur sur n’importe quel bloc accepté', () => {
    expect(sanitizeBlocks([{ kind: 'text', text: 'a', standalone: true }])).toEqual([
      { kind: 'text', text: 'a', standalone: true },
    ])
  })

  it('n’invente pas le marqueur à partir d’une valeur qui n’est pas un booléen', () => {
    expect(sanitizeBlocks([{ kind: 'text', text: 'a', standalone: 'yes' }])).toEqual([
      { kind: 'text', text: 'a' },
    ])
  })

  it('survit à l’enregistrement, même sur un tableau recopié champ par champ', () => {
    // `normalizeContent` est le SEUL chemin d'écriture : un marqueur perdu là
    // ferait rentrer le bloc dans la question dès la prochaine réouverture.
    const blocks: CardBlock[] = [{ kind: 'table', header: [], rows: [['a']], standalone: true }]
    expect(normalizeContent(blocks).content).toEqual([
      { kind: 'table', header: [], rows: [['a']], standalone: true },
    ])
  })
})
