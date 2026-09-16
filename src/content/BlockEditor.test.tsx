import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEditor, convertBlock } from './BlockEditor'
import { SYMBOL_FAMILIES } from './symbolSets'
import type { CardBlock } from '../types/cardBlock'

// The WYSIWYG field is MathLive's concern, covered in MathFieldEditor.test.tsx.
// Here it always renders its fallback, so these tests exercise BlockEditor
// rather than depending on whether a 5.7 MB dynamic import happened to resolve
// during an earlier test in this file.
vi.mock('./MathFieldEditor', () => ({
  MathFieldEditor: ({ fallback }: { fallback: React.ReactNode }) => fallback,
}))

/** Drives the editor as the popover does: it owns the draft, the editor edits it. */
function Harness({ initial, onState }: { initial: CardBlock[]; onState: (blocks: CardBlock[]) => void }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <BlockEditor
      blocks={blocks}
      onChange={next => {
        setBlocks(next)
        onState(next)
      }}
      resolveAsset={asset => `/a/${asset}`}
    />
  )
}

function renderEditor(initial: CardBlock[]) {
  const onState = vi.fn()
  render(<Harness initial={initial} onState={onState} />)
  // Not `.at(-1)`: the project's tsconfig lib predates it.
  const latest = () => {
    const calls = onState.mock.calls
    return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
  }
  return { onState, latest }
}

describe('convertBlock', () => {
  it('round-trips text through math without losing the string', () => {
    const text: CardBlock = { kind: 'text', text: 'x^2' }
    const asMath = convertBlock(text, 'math')
    expect(asMath).toEqual({ kind: 'math', latex: 'x^2' })
    expect(convertBlock(asMath, 'text')).toEqual(text)
  })

  it('returns the same block when the kind is unchanged', () => {
    const block: CardBlock = { kind: 'math', latex: 'x' }
    expect(convertBlock(block, 'math')).toBe(block)
  })

  it('refuses to convert an image away, rather than destroying the asset reference', () => {
    // Règle 6 says switching mode never destroys content, and there is no mode
    // that produces an image back — so converting one away is one-way loss.
    const image: CardBlock = { kind: 'image', asset: 'a3f9.png', alt: 'Schéma', width: 10, height: 5 }
    expect(convertBlock(image, 'text')).toBe(image)
    expect(convertBlock(image, 'math')).toBe(image)
    expect(convertBlock(image, 'table')).toBe(image)
  })

  it('carries a table’s header across a conversion, not just its rows', () => {
    const table: CardBlock = { kind: 'table', header: ['FR', 'EN'], rows: [['chien', 'dog']] }
    expect(convertBlock(table, 'text')).toEqual({ kind: 'text', text: 'FR\tEN\nchien\tdog' })
  })

  it('turns an empty block into a usable table rather than an empty one', () => {
    expect(convertBlock({ kind: 'text', text: '' }, 'table')).toEqual({
      kind: 'table',
      header: [],
      rows: [['', '']],
    })
  })
})

describe('the table editor', () => {
  it('inserts before the first row and column, not only after the existing ones', async () => {
    // Every per-boundary handle inserts AFTER the row/column it belongs to, so
    // the boundary before the first one had no handle at all: a column could be
    // added between two existing ones but never at the start.
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    await user.click(screen.getByRole('button', { name: /insérer une colonne avant la colonne 1/i }))
    await user.click(screen.getByRole('button', { name: /insérer une ligne avant la ligne 1/i }))

    expect(latest()).toEqual([
      { kind: 'table', header: [], rows: [['', '', ''], ['', 'a', 'b']] },
    ])
  })

  it('laisse le « + » nu au repos et confie le survol à une classe', () => {
    // Le piège que ce test verrouille : un `border` ou un `background` EN LIGNE
    // l'emporterait sur la règle `:hover` de la classe, et le bouton ne pourrait
    // plus jamais apparaître. C'est pour ça que les couleurs vivent dans
    // `index.css` et pas dans `BARE_HANDLE`.
    renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    const insert = screen.getByRole('button', { name: /insérer une colonne après la colonne 1/i })

    expect(insert).toHaveClass('table-handle')
    expect(insert.style.border).toBe('')
    expect(insert.style.background).toBe('')

    // La corbeille, elle, garde sa chrome : elle est destructive.
    const trash = screen.getByRole('button', { name: /supprimer la colonne 1/i })
    expect(trash).not.toHaveClass('table-handle')
  })

  it('sépare la poubelle du « + » et ne la révèle qu’au survol de sa ligne ou colonne', async () => {
    // Le `+` reste sur la FRONTIÈRE (il insère entre deux colonnes), la poubelle
    // est centrée sur la COLONNE qu'elle supprime : deux cibles distinctes, donc
    // plus de clic destructeur à un pixel d'un `+`.
    const user = userEvent.setup()
    renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    const insert = screen.getByRole('button', { name: /insérer une colonne après la colonne 1/i })
    const trash = screen.getByRole('button', { name: /supprimer la colonne 1/i })

    expect(insert.style.width).toBe('22px')
    expect(insert.style.height).toBe('22px')

    // Le « + » est un enfant direct de la piste ; la poubelle vit dans sa propre
    // enveloppe, positionnée à part.
    const trashBox = trash.parentElement as HTMLElement
    expect(trashBox).not.toBe(insert.parentElement)
    expect(trashBox.style.opacity).toBe('0')
    // Invisible ET non cliquable tant qu'on ne l'a pas appelée : un clic ne peut
    // pas tomber sur une poubelle qu'on ne voyait pas.
    expect(trashBox.style.pointerEvents).toBe('none')

    await user.hover(screen.getByRole('textbox', { name: /ligne 1 colonne 1/i }))

    // Révélée pour SA colonne, et seulement pour elle.
    expect(trashBox.style.opacity).toBe('1')
    expect(trashBox.style.pointerEvents).toBe('auto')
    const otherTrash = screen.getByRole('button', { name: /supprimer la colonne 2/i }).parentElement as HTMLElement
    expect(otherTrash.style.opacity).toBe('0')
  })
  const table: CardBlock[] = [{ kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'dog']] }]

  it('edits a body cell without disturbing its neighbours', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 2/i })
    await user.clear(cell)
    await user.type(cell, 'hound')

    expect(latest()).toEqual([{ kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'hound']] }])
  })

  it('edits a header cell', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    const cell = screen.getByRole('textbox', { name: /en-tête 1/i })
    await user.clear(cell)
    await user.type(cell, 'FR')

    expect((latest()![0] as { header: string[] }).header).toEqual(['FR', 'Anglais'])
  })

  it('keeps every row the same length when a column is added', async () => {
    // A ragged table renders wrong, so the invariant is worth pinning.
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    await user.click(screen.getByRole('button', { name: /insérer une colonne après la colonne 1/i }))

    const block = latest()![0] as { header: string[]; rows: string[][] }
    expect(block.header).toHaveLength(3)
    expect(block.rows.every(row => row.length === 3)).toBe(true)
  })

  it('adds a row at the current width', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    await user.click(screen.getByRole('button', { name: /insérer une ligne après la ligne 1/i }))

    const block = latest()![0] as { rows: string[][] }
    expect(block.rows).toEqual([['chien', 'dog'], ['', '']])
  })

  it('squares up a ragged table that came from a file', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: ['a', 'b', 'c'], rows: [['1'], ['2', '3']] }])

    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 1/i })
    await user.clear(cell)
    await user.type(cell, 'X')

    const block = latest()![0] as { rows: string[][] }
    expect(block.rows.every(row => row.length === 3)).toBe(true)
  })
})

describe('the prose signs in a table cell', () => {
  it('writes a sign into the cell the caret is in, and only appears with a caret', async () => {
    // With no caret there is nowhere to insert, so a palette that showed anyway
    // would be a row of buttons that do nothing — and the table costs no height
    // until it is actually being typed in.
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    expect(
      screen.queryByRole('group', { name: /symboles mathématiques dans le texte/i })
    ).not.toBeInTheDocument()

    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 1/i }) as HTMLInputElement
    // `user.click` rather than `cell.focus()`: React listens for `focusin`, which
    // the bare DOM `focus()` does not dispatch here — the palette is revealed by
    // the same event a real click produces.
    await user.click(cell)
    cell.setSelectionRange(1, 1)

    await user.click(screen.getByRole('button', { name: /inférieur ou égal/i }))

    // Column 2 untouched: the cell is found from the focused element, so the
    // sign cannot land in a neighbour.
    expect(latest()).toEqual([{ kind: 'table', header: [], rows: [['a≤', 'b']] }])
  })

  it('writes into a formula cell too, which is where `\\leq` used to be typed by hand', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: [], rows: [[{ latex: 'x' }, 'b']] }])

    // The mocked MathFieldEditor renders its fallback, so the cell under test is
    // a plain `<input>` — which is exactly the raw-LaTeX path a machine without
    // MathLive keeps for good.
    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 1/i }) as HTMLInputElement
    await user.click(cell)
    cell.setSelectionRange(1, 1)

    await user.click(screen.getByRole('button', { name: /inférieur ou égal/i }))

    expect(latest()).toEqual([{ kind: 'table', header: [], rows: [[{ latex: 'x≤' }, 'b']] }])
  })
})

describe('the type switch, carried by each block', () => {
  it('switches the block whose own button was used, not always the first one', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    await user.click(screen.getByRole('button', { name: /type du bloc 2/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    expect(latest()).toEqual([
      { kind: 'text', text: 'premier' },
      { kind: 'math', latex: 'second' },
    ])
  })

  it('shows the block’s CURRENT type on its own button, so the list can be read at a glance', () => {
    renderEditor([
      { kind: 'text', text: 'une règle' },
      { kind: 'math', latex: 'x^2' },
    ])

    expect(screen.getByRole('button', { name: /type du bloc 1 : texte/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /type du bloc 2 : formule/i })).toBeInTheDocument()
  })

  it('names a table as a table, instead of falling through to “Image”', () => {
    // The label chain ended in `: 'Image'`, so every kind it did not name was
    // announced as an image — and a table is one of them. The wrong word reached
    // the button's visible text AND its accessible name, which is why the
    // assertion is on the role query rather than on the text alone.
    renderEditor([{ kind: 'table', header: [], rows: [['a', 'b']] }])

    expect(screen.getByRole('button', { name: /type du bloc 1 : tableau/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /type du bloc 1 : image/i })).not.toBeInTheDocument()
  })

  it('acts on a block that still exists after another one is removed', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
      { kind: 'text', text: 'trois' },
    ])

    await user.click(screen.getByRole('button', { name: /supprimer le bloc 3/i }))
    // Each switch is drawn on its own block: there is no remembered index left
    // pointing past the end of the list.
    await user.click(screen.getByRole('button', { name: /type du bloc 2/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    const blocks = latest()!
    expect(blocks).toHaveLength(2)
    expect(blocks.filter(block => block.kind === 'math')).toHaveLength(1)
  })

  it('is inert on an image block instead of silently dropping the picture', () => {
    renderEditor([{ kind: 'image', asset: 'a3f9.png', alt: 'Schéma', width: 10, height: 5 }])

    expect(screen.getByRole('button', { name: /type du bloc 1 : image/i })).toBeDisabled()
  })

  it('starts a block when the list is empty instead of doing nothing', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])

    await user.click(screen.getByRole('button', { name: /ajouter un bloc/i }))

    expect(latest()).toEqual([{ kind: 'text', text: '' }])
  })

  it('grows a text block into a table instead of converting it, since it already was a 1×1 one', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'chien' }])

    // « Tableau » est passé dans le sélecteur de type (voir `BlockKindMenu`).
    await user.click(screen.getByRole('button', { name: /type du bloc 1/i }))
    await user.click(screen.getByRole('menuitem', { name: /tableau/i }))

    // The note is still there, in the first cell; the second column is the one
    // that was just asked for, and it comes up empty and ready.
    expect(latest()).toEqual([{ kind: 'table', header: [], rows: [['chien', '']] }])
  })

  it('keeps a table’s header empty through the column edits, so no blank band appears', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'chien' }])

    // « Tableau » est passé dans le sélecteur de type (voir `BlockKindMenu`).
    await user.click(screen.getByRole('button', { name: /type du bloc 1/i }))
    await user.click(screen.getByRole('menuitem', { name: /tableau/i }))
    await user.click(screen.getByRole('button', { name: /insérer une colonne après la colonne 1/i }))

    expect((latest()![0] as { header: string[] }).header).toEqual([])
  })
})

describe('the kind a new block starts as', () => {
  it('continues a run of formulas, so a second formula costs no type switch', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'math', latex: 'x^2' }])

    await user.type(screen.getByRole('textbox', { name: /formule du bloc 1 \(latex\)/i }), '{Enter}')

    expect(latest()).toEqual([
      { kind: 'math', latex: 'x^2' },
      { kind: 'math', latex: '' },
    ])
  })

  it('stays on text after a text block, which is what it always did', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'une règle' }])

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), '{Enter}')

    expect(latest()).toEqual([
      { kind: 'text', text: 'une règle' },
      { kind: 'text', text: '' },
    ])
  })

  it('carries the same inheritance through the “Ajouter un bloc” button', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'math', latex: 'x' }])

    await user.click(screen.getByRole('button', { name: /ajouter un bloc/i }))

    expect(latest()).toEqual([
      { kind: 'math', latex: 'x' },
      { kind: 'math', latex: '' },
    ])
  })

  it('never inherits from a table, where “the block above” has no single meaning', async () => {
    // `Entrée` inside a table cell adds a ROW, not a block, so a table is not a
    // kind a new block can sensibly continue.
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: [], rows: [['a']] }])

    await user.click(screen.getByRole('button', { name: /ajouter un bloc/i }))

    expect(latest()).toEqual([
      { kind: 'table', header: [], rows: [['a']] },
      { kind: 'text', text: '' },
    ])
  })
})

describe('the caret after a type switch', () => {
  it('goes back into the block, so the user can type in what they just converted', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: 'x^2' }])

    await user.click(screen.getByRole('button', { name: /type du bloc 1 : texte/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    // The switch replaces the field itself — a `<textarea>` and a formula editor
    // are different components — so without this the caret stayed on the menu
    // button and the user had to click back into the block they had converted.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /formule du bloc 1/i })).toHaveFocus()
    )
  })
})

describe('the editor’s icon-only controls', () => {
  it('explains a cell’s format toggle with a tooltip through the menu trigger', async () => {
    // The riskiest of the conversions: the button is BOTH a tooltip trigger and
    // a dropdown-menu trigger, so two Radix slots have to compose their handlers
    // onto the same element. If that composition broke, the menu would stop
    // opening — which is why this asserts the tooltip AND that the button is
    // still the menu's trigger.
    const user = userEvent.setup()
    renderEditor([{ kind: 'table', header: [], rows: [['a']] }])

    const toggle = screen.getByRole('button', { name: /format de la cellule/i })
    expect(toggle).not.toHaveAttribute('title')

    await user.hover(toggle)
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(/cette cellule est en texte/i)
    )

    await user.click(toggle)
    expect(screen.getByRole('menuitem', { name: /formule/i })).toBeInTheDocument()
  })

  it('explains the gutter with a tooltip, not a native title', async () => {
    // `title` never appeared on keyboard focus and took about a second to show.
    // The tooltip opens on focus as well, which is the point of the migration.
    const user = userEvent.setup()
    renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
    ])

    const moveDown = screen.getByRole('button', { name: /descendre le bloc 1/i })
    expect(moveDown).not.toHaveAttribute('title')

    await user.hover(moveDown)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Descendre le bloc 1'))
  })
})

describe('le bandeau de symboles', () => {
  // Le réglage des familles vit dans `localStorage`, qui est partagé par tous les
  // tests d'un même fichier : sans ce nettoyage, un test masquerait une famille
  // pour les suivants.
  beforeEach(() => localStorage.clear())

  it('n’affiche que les familles de l’onglet ouvert, et le même bouton le referme', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'math', latex: 'x' }])

    // Ouvert sur Maths : les signes de maths, pas ceux des sciences. C'est le
    // défaut, donc le premier rendu est déjà le bon — pas de bandeau complet qui
    // se réduit ensuite.
    expect(screen.getByRole('group', { name: 'Comparaisons' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Grandeurs' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sciences' }))

    expect(screen.queryByRole('group', { name: 'Comparaisons' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Grandeurs' })).toBeInTheDocument()

    // Le MÊME bouton referme : « ne rien afficher » n'est pas une commande à
    // chercher ailleurs.
    await user.click(screen.getByRole('button', { name: 'Sciences' }))

    expect(screen.queryByRole('group', { name: 'Grandeurs' })).not.toBeInTheDocument()
    // Et l'onglet FERMÉ est retenu : c'est un choix, pas l'absence de réglage —
    // sinon rouvrir la modale le rouvrirait tout seul.
    expect(localStorage.getItem('zachart-mentale:band-tab')).toBe('null')
  })

  it('rouvre au premier rendu l’onglet resté ouvert', () => {
    localStorage.setItem('zachart-mentale:band-tab', JSON.stringify('sciences'))

    renderEditor([{ kind: 'math', latex: 'x' }])

    expect(screen.getByRole('group', { name: 'Grandeurs' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Comparaisons' })).not.toBeInTheDocument()
  })
  it('obéit aux familles qu’on lui donne comme masquées', () => {
    // Le réglage lui est DONNÉ : il vit dans la modale, avec le bouton qui
    // l'ouvre (voir `DescriptionDialog`) — ici on vérifie seulement que le
    // bandeau obéit, et qu'il n'affiche pas ce qu'on lui cache.
    render(
      <BlockEditor
        blocks={[{ kind: 'math', latex: 'x' }]}
        onChange={() => {}}
        resolveAsset={() => ''}
        hiddenFamilies={['Grec']}
      />
    )

    expect(screen.queryByRole('group', { name: 'Grec' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Comparaisons' })).toBeInTheDocument()
  })

  it('déplace le NŒUD du bloc au lieu de réécrire son contenu, ce dont l’animation dépend', async () => {
    // Le contrat que l'animation exige, et qui manquait : avec `key={index}`,
    // React réutilise l'élément de CHAQUE position et se contente de réécrire son
    // contenu — aucun élément ne se déplace, donc `layout` de `motion` n'a rien à
    // animer, et une FLIP non plus (l'ancienne et la nouvelle position d'un nœud
    // seraient les mêmes). Avec une clé stable, le nœud SUIT le bloc.
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    const firstField = screen.getByRole('textbox', { name: /texte du bloc 1/i })

    await user.click(screen.getByRole('button', { name: /descendre le bloc 1/i }))

    // Le MÊME nœud DOM, désormais étiqueté bloc 2 : il a été déplacé, pas recréé.
    expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toBe(firstField)
    expect(latest()).toEqual([
      { kind: 'text', text: 'second' },
      { kind: 'text', text: 'premier' },
    ])
  })

  it('garde le focus après une insertion au milieu, malgré les identités stables', async () => {
    // Le risque exact de la réconciliation d'identités : si les clés se décalaient,
    // le bloc qu'on est en train d'écrire serait remonté et perdrait le focus.
    const user = userEvent.setup()
    renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
    ])

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), '{Enter}')

    expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus()
  })

  it('groupe les signes par famille, et nomme chaque famille', () => {
    // L'organisation est le point : une famille est un GROUPE, pas une rangée de
    // touches perdue dans un flux. Chacune porte son nom, donc elle se lit à la
    // voix autant qu'à la couleur de son fond.
    renderEditor([{ kind: 'math', latex: 'x' }])

    const band = screen.getByRole('group', { name: /symboles à insérer/i })
    const families = within(band).getAllByRole('group')

    // Une famille = un groupe, et la barre d'onglets en est un aussi (elle est
    // nommée, pour qu'un lecteur d'écran l'annonce). Donc « au moins » : ce qui
    // compte est qu'AUCUNE famille ne manque et qu'aucune ne soit fusionnée.
    expect(families.length).toBeGreaterThanOrEqual(SYMBOL_FAMILIES.length)
    for (const family of SYMBOL_FAMILIES) {
      expect(within(band).getByRole('group', { name: family.name })).toBeInTheDocument()
    }
  })

  it('grise les familles de formule dans un texte, sans les déplacer', async () => {
    // La règle du bandeau : mêmes touches, mêmes places, quel que soit le bloc.
    // Une famille « formule seulement » est GRISÉE là où elle ne vaut rien —
    // écrire `\frac{}{}` au milieu d'une phrase n'a aucun sens — mais elle ne
    // disparaît pas, sans quoi les touches changeraient de place.
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: 'une phrase' }])

    // Le libellé porte la RAISON : « indisponible ici ». Une infobulle ne peut
    // pas l'expliquer, puisqu'elle ne s'ouvre pas sur un bouton désactivé.
    const fraction = screen.getByRole('button', { name: /fraction/i })
    expect(fraction).toBeDisabled()
    expect(fraction.getAttribute('aria-label')).toMatch(/indisponible ici/i)
    // Un signe qui vaut dans les deux reste actif, et son libellé reste nu.
    expect(screen.getByRole('button', { name: /inférieur ou égal/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /type du bloc 1/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    expect(screen.getByRole('button', { name: /^fraction$/i })).toBeEnabled()
  })

  it('écrit le signe là où est le caret, et dans la langue du champ', async () => {
    // Le cœur du bandeau : une seule touche, deux écritures. L'Unicode dans un
    // texte, le LaTeX dans une formule — c'est ce qui lui permet de garder sa
    // place d'un bloc à l'autre.
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'ab' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    await user.click(field)
    field.setSelectionRange(1, 1)

    await user.click(screen.getByRole('button', { name: /inférieur ou égal/i }))

    expect(latest()).toEqual([{ kind: 'text', text: 'a≤b' }])
  })

  it('nomme le bloc qu’il sert, et suit le changement de bloc actif', async () => {
    const user = userEvent.setup()
    renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
    ])

    // Un seul bandeau, et il dit lequel il sert.
    expect(screen.getAllByRole('group', { name: /symboles à insérer/i })).toHaveLength(1)
    expect(screen.getByText('Bloc 1 · Texte')).toBeInTheDocument()

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))

    expect(screen.getByText('Bloc 2 · Texte')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /symboles à insérer/i })).toHaveLength(1)
  })
})

describe('the math field', () => {
  it('previews the formula as it is typed, synchronously', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'math', latex: '' }])

    await user.type(screen.getByRole('textbox', { name: /formule du bloc 1 \(latex\)/i }), 'x^2')

    expect(screen.getByTestId('math-preview-0').querySelector('.katex')).not.toBeNull()
  })

  it('does not tear down on a formula KaTeX cannot handle', () => {
    const deep = '\\sqrt{'.repeat(2000) + 'a' + '}'.repeat(2000)
    expect(() => renderEditor([{ kind: 'math', latex: deep }])).not.toThrow()
  })
})

describe('the character palette, in the footer of the text block', () => {
  it('writes a maths sign INTO the sentence, which is what had nowhere to go', async () => {
    // The dead end this palette exists for: `≤` could only be typed in a FORMULA
    // block, so « f est croissante si a ≤ b » had to be cut into three blocks
    // around a formula — or written `<=`.
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'ab' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    field.focus()
    // Caret between the two letters, where the sign belongs.
    field.setSelectionRange(1, 1)

    await user.click(screen.getByRole('button', { name: /inférieur ou égal/i }))

    // One block, still text, with the sign inserted AT the caret: the mousedown
    // is cancelled so the click never steals the focus the caret lives in.
    expect(latest()).toEqual([{ kind: 'text', text: 'a≤b' }])
  })

  it('offers the prose signs only where prose is written', () => {
    // Le bandeau a remplacé les deux palettes : il est là pour tous les blocs,
    // avec les mêmes touches, et c'est la famille « Structures » qui se grise.
    renderEditor([{ kind: 'math', latex: 'x' }])
    expect(screen.getByRole('group', { name: /symboles à insérer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^fraction$/i })).toBeEnabled()
  })
  it('offers the languages straight away, and no character until one is chosen', () => {
    renderEditor([{ kind: 'text', text: '' }])

    // No button to open first: the palette is the block's footer, so it is
    // there the moment the block is.
    expect(screen.getByRole('group', { name: /choix de la langue/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /point d’interrogation inversé/i })).not.toBeInTheDocument()
  })

  it('shows the Spanish punctuation a French keyboard cannot produce', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))

    expect(screen.getByRole('button', { name: /point d’interrogation inversé/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /point d’exclamation inversé/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eñe$/i })).toBeInTheDocument()
    // The English set is not on screen: one language's characters at a time.
    expect(screen.queryByRole('button', { name: /livre sterling/i })).not.toBeInTheDocument()
  })

  it('shows the English typography, which is what a French keyboard gets wrong there', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : anglais/i }))

    expect(screen.getByRole('button', { name: /apostrophe anglaise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /point d’interrogation inversé/i })).not.toBeInTheDocument()
  })

  it('shows the French ligatures, which no keyboard has a key for', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : français/i }))

    expect(screen.getByRole('button', { name: 'o et e liés (cœur)' })).toBeInTheDocument()
  })

  it('inserts the character into the text being written, without replacing it', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'don' }])

    await user.click(screen.getByRole('button', { name: /langue : anglais/i }))
    await user.click(screen.getByRole('button', { name: /apostrophe anglaise/i }))

    const written = (latest()![0] as { text: string }).text
    expect(written).toContain('’')
    expect(written.replace('’', '')).toBe('don')
  })

  it('puts the palette under the block being written in, and nowhere else', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    // Block 1 owns the footer while it is the active one.
    expect(screen.getAllByRole('group', { name: /choix de la langue/i })).toHaveLength(1)

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /eñe$/i }))

    const blocks = latest()!
    expect(blocks[0]).toEqual({ kind: 'text', text: 'premier' })
    expect((blocks[1] as { text: string }).text).toContain('ñ')
  })

  it('is not shown at all when the description has no text block to write in', () => {
    renderEditor([{ kind: 'math', latex: 'x' }])

    expect(screen.queryByRole('group', { name: /choix de la langue/i })).not.toBeInTheDocument()
  })

  it('shows both signs on the button, and no longer offers the closing one alone', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))

    expect(screen.getByRole('button', { name: /point d’interrogation inversé/i })).toHaveTextContent('¿ ?')
    expect(screen.queryByRole('button', { name: /guillemet fermant/i })).not.toBeInTheDocument()
  })

  it('writes the closing sign itself, and leaves the caret between the two', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /point d’interrogation inversé/i }))

    expect((latest()![0] as { text: string }).text).toBe('¿?')
    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(field.selectionStart).toBe(1)
  })

  it('surrounds the selected text instead of writing over it', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'Cómo estás' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(0, 10)

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /point d’interrogation inversé/i }))

    expect((latest()![0] as { text: string }).text).toBe('¿Cómo estás?')
  })

  it('spaces the guillemets inside, unlike the inverted signs', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /guillemet ouvrant/i }))

    expect((latest()![0] as { text: string }).text).toBe('«  »')
  })
})

describe('inserting an image', () => {
  function renderWithImages(overrides: {
    onInsertImage?: (s: { bytes: Uint8Array; mime: string; name?: string }) => Promise<CardBlock | undefined>
    onPickImage?: () => Promise<CardBlock | undefined>
    onError?: (m: string) => void
  }) {
    const onState = vi.fn()
    function Host() {
      const [blocks, setBlocks] = useState<CardBlock[]>([{ kind: 'text', text: 'Une règle' }])
      return (
        <BlockEditor
          blocks={blocks}
          onChange={next => {
            setBlocks(next)
            onState(next)
          }}
          resolveAsset={a => `/a/${a}`}
          {...overrides}
        />
      )
    }
    render(<Host />)
    const latest = () => {
      const calls = onState.mock.calls
      return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
    }
    return { latest }
  }

  const block: CardBlock = { kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 200, height: 100 }

  it('appends the block the picker produced, keeping what was already there', async () => {
    const user = userEvent.setup()
    const { latest } = renderWithImages({ onPickImage: async () => block })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(latest()).toEqual([{ kind: 'text', text: 'Une règle' }, block])
  })

  it('tells the user an image can be pasted, which is the path nobody finds', async () => {
    // The button carries a visible word, so a hint here has to add something the
    // word does not: the `Ctrl+V` route, which works anywhere in the editor and
    // which no amount of staring at the toolbar reveals. This is the whole of
    // what "make image insertion discoverable" needs — NOT a third entry in the
    // type selector, which would be a one-way door out of text.
    const user = userEvent.setup()
    renderWithImages({ onPickImage: async () => undefined })

    await user.hover(screen.getByRole('button', { name: /insérer une image/i }))

    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(/ctrl\+v/i))
  })

  it('inserts nothing when the picker is cancelled', async () => {
    const user = userEvent.setup()
    const { latest } = renderWithImages({ onPickImage: async () => undefined })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(latest()).toBeUndefined()
  })

  it('reports a storage failure instead of failing silently', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    renderWithImages({
      onPickImage: async () => {
        throw new Error('Image trop volumineuse')
      },
      onError,
    })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/volumineuse/))
  })

  it('hides the affordance entirely when the host cannot store images', () => {
    renderWithImages({})
    expect(screen.queryByRole('button', { name: /insérer une image/i })).not.toBeInTheDocument()
  })

  it('inserts an image pasted into the editor', async () => {
    const onInsertImage = vi.fn(async () => block)
    const { latest } = renderWithImages({ onInsertImage })

    const file = new File([new Uint8Array([1, 2, 3])], 'capture.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: /texte du bloc 1/i }), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    })

    await waitFor(() => expect(latest()).toEqual([{ kind: 'text', text: 'Une règle' }, block]))
  })

  it('leaves an ordinary text paste alone', async () => {
    const onInsertImage = vi.fn()
    const { latest } = renderWithImages({ onInsertImage })

    fireEvent.paste(screen.getByRole('textbox', { name: /texte du bloc 1/i }), {
      clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] },
    })

    expect(onInsertImage).not.toHaveBeenCalled()
    expect(latest()).toBeUndefined()
  })

  it('lets the description of an image block be edited', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    function Host() {
      const [blocks, setBlocks] = useState<CardBlock[]>([block])
      return (
        <BlockEditor
          blocks={blocks}
          onChange={next => {
            setBlocks(next)
            onState(next)
          }}
          resolveAsset={a => `/a/${a}`}
        />
      )
    }
    render(<Host />)

    const field = screen.getByRole('textbox', { name: /description de l’image/i })
    await user.clear(field)
    await user.type(field, 'Cycle de l’eau')

    const calls = onState.mock.calls
    expect((calls[calls.length - 1][0] as CardBlock[])[0]).toMatchObject({ alt: 'Cycle de l’eau' })
  })
})
