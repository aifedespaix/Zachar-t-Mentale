export type CardLevel = 1 | 2 | 3 | 4

export interface Card {
  id: string
  level: CardLevel
  title: string
  definition?: string
  parentId: string | null
  order: number
}
