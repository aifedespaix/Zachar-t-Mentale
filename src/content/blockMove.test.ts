import { describe, it, expect } from 'vitest'
import { moveBlock, movePlan } from './blockMove'
import type { CardBlock } from '../types/cardBlock'

/**
 * Le déplacement dans une liste qui porte des questions.
 *
 * Une question n'est pas un bloc comme un autre : elle POSSÈDE les blocs qui la
 * suivent (modèle plat, voir « blockGroups »). Déplacer au simple index voisin
 * ferait donc changer des blocs de propriétaire sans le dire — un bloc de la
 * question éjecté dehors, un bloc du dehors avalé dedans.
 */

type Question = Extract<CardBlock, { kind: 'question' }>

const q = (text: string, extra: Partial<Question> = {}): CardBlock => ({ kind: 'question', text, ...extra })
const t = (text: string, standalone = false): CardBlock =>
  standalone ? { kind: 'text', text, standalone: true } : { kind: 'text', text }

describe('moveBlock — la question est un bloc solide', () => {
  it('fait remonter un bloc extérieur AU-DESSUS de la question qu’il suivait', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), t('b', true)]
    expect(moveBlock(blocks, 2, 1)).toEqual([t('b', true), q('Q1'), t('a')])
  })

  it('fait descendre un bloc extérieur SOUS la question qu’il précédait', () => {
    const blocks: CardBlock[] = [t('b', true), q('Q1'), t('a')]
    expect(moveBlock(blocks, 0, 1)).toEqual([q('Q1'), t('a'), t('b', true)])
  })

  it('saute UN groupe à chaque pression', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), q('Q2'), t('b'), t('c', true)]
    expect(moveBlock(blocks, 4, 3)).toEqual([q('Q1'), t('a'), t('c', true), q('Q2'), t('b')])
  })

  it('marque extérieur un bloc qui atterrit après la question', () => {
    // Sans le marqueur, « blockGroups » le rendrait à la question qu'il vient de
    // sauter : le geste aurait déplacé le bloc ET changé son propriétaire.
    const blocks: CardBlock[] = [t('x'), q('Q1'), t('a')]
    expect(moveBlock(blocks, 0, 1)).toEqual([q('Q1'), t('a'), t('x', true)])
  })
})

describe('moveBlock — un bloc de la question reste dans sa question', () => {
  it('ne franchit pas l’en-tête en montant', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), t('b')]
    expect(moveBlock(blocks, 1, 0)).toBe(blocks)
  })

  it('ne sort pas par le bas', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), t('ext', true)]
    expect(moveBlock(blocks, 1, 2)).toBe(blocks)
  })

  it('ne saute pas dans la question suivante', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), q('Q2'), t('b')]
    expect(moveBlock(blocks, 1, 2)).toBe(blocks)
  })

  it('se réordonne entre les autres blocs de sa question', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), t('b'), t('c')]
    expect(moveBlock(blocks, 2, 1)).toEqual([q('Q1'), t('b'), t('a'), t('c')])
    expect(moveBlock(blocks, 1, 2)).toEqual([q('Q1'), t('b'), t('a'), t('c')])
  })
})

describe('moveBlock — l’en-tête emmène toute sa question', () => {
  it('remonte la question au-dessus de la précédente, blocs compris', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), q('Q2'), t('b')]
    expect(moveBlock(blocks, 2, 1)).toEqual([q('Q2'), t('b'), q('Q1'), t('a')])
  })

  it('descend la question sous la suivante, blocs compris', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), q('Q2'), t('b')]
    expect(moveBlock(blocks, 0, 1)).toEqual([q('Q2'), t('b'), q('Q1'), t('a')])
  })

  it('marque extérieurs les blocs que la question dépasse', () => {
    // « x » était en tête de liste ; la question remonte devant lui et le laisse
    // dehors, APRÈS elle.
    const blocks: CardBlock[] = [t('x'), q('Q1'), t('a')]
    expect(moveBlock(blocks, 1, 0)).toEqual([q('Q1'), t('a'), t('x', true)])
  })

  it('ne bouge pas quand il n’y a pas de groupe voisin', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a')]
    expect(moveBlock(blocks, 0, 1)).toBe(blocks)
    expect(moveBlock(blocks, 0, -1)).toBe(blocks)
  })
})

describe('movePlan — les identités suivent le bloc déplacé', () => {
  it('rend l’ordre d’origine des positions après un saut', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), t('b', true)]
    expect(movePlan(blocks, 2, 1)?.order).toEqual([2, 0, 1])
  })

  it('rend l’ordre d’origine des positions après un déplacement de question', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a'), q('Q2'), t('b')]
    expect(movePlan(blocks, 0, 1)?.order).toEqual([2, 3, 0, 1])
  })

  it('ne rend rien quand le déplacement est impossible', () => {
    const blocks: CardBlock[] = [q('Q1'), t('a')]
    expect(movePlan(blocks, 1, 0)).toBeNull()
  })
})
