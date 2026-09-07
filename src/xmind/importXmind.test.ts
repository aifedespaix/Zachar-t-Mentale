import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { xmindContentToCards, readXmindFile } from './importXmind'

describe('xmindContentToCards', () => {
  it('maps a central topic and its children to levels 1..4', () => {
    const content = [
      {
        title: 'Ma feuille',
        rootTopic: {
          title: 'Chapitre',
          children: {
            attached: [
              {
                title: 'Thème',
                notes: { plain: { content: 'note du thème' } },
                children: { attached: [{ title: 'Règle', children: { attached: [{ title: 'Exemple' }] } }] },
              },
            ],
          },
        },
      },
    ]
    const [sheet] = xmindContentToCards(content)
    expect(sheet.sheetTitle).toBe('Ma feuille')
    const byLevel = (level: number) => sheet.cards.filter(c => c.level === level)
    expect(byLevel(1)).toHaveLength(1)
    expect(byLevel(1)[0].title).toBe('Chapitre')
    expect(byLevel(2)[0]).toMatchObject({ title: 'Thème', definition: 'note du thème' })
    expect(byLevel(3)[0].title).toBe('Règle')
    expect(byLevel(4)[0].title).toBe('Exemple')
  })

  it('produces one XmindSheetImport per sheet', () => {
    const content = [
      { title: 'Feuille A', rootTopic: { title: 'A' } },
      { title: 'Feuille B', rootTopic: { title: 'B' } },
    ]
    const sheets = xmindContentToCards(content)
    expect(sheets.map(s => s.sheetTitle)).toEqual(['Feuille A', 'Feuille B'])
  })

  it('folds a subtree deeper than level 4 into the level-4 ancestor\'s definition instead of dropping or detaching it', () => {
    const content = [
      {
        title: 'Feuille',
        rootTopic: {
          title: 'L1',
          children: {
            attached: [
              {
                title: 'L2',
                children: {
                  attached: [
                    {
                      title: 'L3',
                      children: {
                        attached: [
                          {
                            title: 'L4',
                            children: { attached: [{ title: 'L5', notes: { plain: { content: 'trop profond' } } }] },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    ]
    const [sheet] = xmindContentToCards(content)
    expect(sheet.cards).toHaveLength(4) // L1..L4 only — L5 is folded, not a 5th card
    const level4 = sheet.cards.find(c => c.title === 'L4')!
    expect(level4.definition).toContain('L5')
    expect(level4.definition).toContain('trop profond')
  })

  it('throws a readable error when the root is not usable', () => {
    expect(() => xmindContentToCards([{ title: 'Feuille' }])).toThrow(/sujet central/)
  })

  it('throws a readable error when the content is not an array of sheets', () => {
    expect(() => xmindContentToCards({ not: 'an array' })).toThrow(/non reconnu/)
  })
})

describe('readXmindFile', () => {
  it('reads content.json out of the zip and maps it', async () => {
    const zip = new JSZip()
    zip.file(
      'content.json',
      JSON.stringify([{ title: 'Ma feuille', rootTopic: { title: 'Racine' } }])
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    const sheets = await readXmindFile(bytes)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].sheetTitle).toBe('Ma feuille')
    expect(sheets[0].cards[0].title).toBe('Racine')
  })

  it('rejects a zip with no content.json (legacy XMind 8 format)', async () => {
    const zip = new JSZip()
    zip.file('content.xml', '<xmap-content/>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    await expect(readXmindFile(bytes)).rejects.toThrow(/content\.json/)
  })

  it('rejects bytes that are not a valid zip', async () => {
    await expect(readXmindFile(new Uint8Array([1, 2, 3]))).rejects.toThrow(/illisible/)
  })
})
