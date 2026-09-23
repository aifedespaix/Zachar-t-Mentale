import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import type { CardBlock, EquationStep } from '../types/cardBlock'
import { equationStepIsSolved } from './blocks'
import { renderMathToHtml } from './renderMath'
import { MathFieldEditor, type MathFieldHandle } from './MathFieldEditor'
import { navigate, operationVisible, readingOrder, type EqColumn, type EqField, type EqPos } from './equationNav'
import { rawFieldKeyDown, type BlockEdgeHandle, type BlockPlace, type ExitDirection, type ExitVia } from './fieldIntents'

function isStepEmpty(step: EquationStep): boolean {
  return step.left.trim() === '' && step.right.trim() === '' && (step.operation ?? '').trim() === ''
}

function fieldKey(step: number, field: EqField): string {
  return `${step}:${field}`
}

const TERM_BOX: CSSProperties = {
  flex: 1,
  minWidth: 96,
  boxSizing: 'border-box',
  // Le mode condensé (`data-density="compact"` sur la description, voir
  // `index.css`) redéfinit cette variable pour une case plus petite — même
  // convention que `--be-row-pad-*` dans `BlockEditor.tsx`.
  padding: 'var(--eq-term-pad, 8px 14px)',
  borderRadius: 10,
  border: '1.5px solid var(--border)',
  background: 'transparent',
}

const LEFT_BOX: CSSProperties = {
  ...TERM_BOX,
  borderColor: 'color-mix(in oklch, #3a6bb0, transparent 30%)',
  background: 'color-mix(in oklch, #3a6bb0, transparent 92%)',
}

const RIGHT_BOX: CSSProperties = {
  ...TERM_BOX,
  borderColor: 'color-mix(in oklch, #b8791f, transparent 30%)',
  background: 'color-mix(in oklch, #b8791f, transparent 92%)',
}

// Une étape résolue (la variable isolée) n'est jamais deux cases côte à côte
// comme les autres — un seul bloc vert qui engloutit le « = » entre les deux,
// pour que l'œil lise « c'est fini » d'un coup plutôt que deux cases de plus
// à comparer. Voir le rendu dans `EquationBlockField` : c'est LA RANGÉE
// entière qui porte cette bordure, les deux membres eux-mêmes redeviennent
// plats — `SOLVED_TERM`, pas `LEFT_BOX`/`RIGHT_BOX`.
const SOLVED_ROW: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'color-mix(in oklch, #2f8f5b, transparent 25%)',
  background: 'color-mix(in oklch, #2f8f5b, transparent 93%)',
  borderRadius: 10,
  padding: 'var(--eq-term-pad, 8px 14px)',
}

const SOLVED_TERM: CSSProperties = {
  flex: 1,
  minWidth: 96,
  color: '#1f6a3f',
}

const OPERATION_FIELD_STYLE: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  fontSize: 12.5,
  fontWeight: 800,
  color: 'var(--destructive)',
}

const OPERATION_MIRROR_STYLE: CSSProperties = {
  ...OPERATION_FIELD_STYLE,
  minHeight: 20,
  overflowX: 'auto',
}

const OPERATION_ADD_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  padding: '2px 6px',
  border: '1px dashed color-mix(in oklch, var(--destructive), transparent 50%)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--destructive)',
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
}

const RAW_FIELD_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: 14,
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
}

/**
 * Un des trois champs d'une étape (membre gauche, membre droit, ou
 * l'opération qui suit) — le même contrat clavier que `MathFieldEditor`
 * offre déjà à une formule (Entrée, Retour arrière, Suppr, flèches), avec un
 * repli LaTeX brut qui l'honore À L'IDENTIQUE : voir `MathFieldEditor` et
 * `MathBlockField`, dont ce composant reprend la même logique de repli.
 */
function EquationTermField({
  value,
  onChangeValue,
  ariaLabel,
  registerHandle,
  onFocusHandle,
  onEnter,
  onEnterBlock,
  onBackspaceAtStart,
  onDeleteAtEnd,
  onExit,
  side,
  style,
}: {
  value: string
  onChangeValue: (next: string) => void
  ariaLabel: string
  registerHandle: (handle: MathFieldHandle | null) => void
  onFocusHandle: () => void
  /** Entrée (sans Ctrl/Cmd) : toujours « nouvelle étape », jamais une coupure au curseur — une étape n'a rien à couper. */
  onEnter: () => void
  onEnterBlock: (place: BlockPlace) => void
  onBackspaceAtStart: (rest: string) => void
  onDeleteAtEnd: (rest: string) => void
  /** Une flèche (ou Tab) au bord : le champ voisin selon `equationNav`. `false` = nulle part où aller. */
  onExit: (direction: ExitDirection, via: ExitVia) => boolean | void
  /** Lequel des deux membres — pilote (via `index.css`) l'alignement du texte vers le « = » et le nettoyage du chrome MathLive (fond, menu ≡), voir `[data-equation-side]`. */
  side: 'left' | 'right'
  style?: CSSProperties
}) {
  return (
    <div data-equation-side={side} onFocus={onFocusHandle} style={style}>
      <MathFieldEditor
        latex={value}
        onChange={onChangeValue}
        ariaLabel={ariaLabel}
        ref={registerHandle}
        onEnter={onEnter}
        onEnterBlock={onEnterBlock}
        onBackspaceAtStart={onBackspaceAtStart}
        onDeleteAtEnd={onDeleteAtEnd}
        onExit={onExit}
        tabExits
        fallback={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <input
              aria-label={`${ariaLabel} (LaTeX)`}
              value={value}
              spellCheck={false}
              onChange={event => onChangeValue(event.target.value)}
              onKeyDown={rawFieldKeyDown({
                onEnter: () => onEnter(),
                onEnterBlock,
                onBackspaceAtStart,
                onDeleteAtEnd,
                onExit,
                tabExits: true,
              })}
              style={RAW_FIELD_STYLE}
            />
            <div
              style={{ minHeight: 18, overflowX: 'auto' }}
              // Safe: `renderMathToHtml` escapes the text it emits, and
              // `trust: false` keeps it from building links or embedding
              // resources (see renderMath tests).
              dangerouslySetInnerHTML={{ __html: renderMathToHtml(value, false) }}
            />
          </div>
        }
      />
    </div>
  )
}

const OPERATION_INPUT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
}

/**
 * Le champ « opération » d'une étape : un texte normal, jamais une formule
 * MathLive — il n'a besoin d'aucun clavier virtuel, menu ou fond dédié pour
 * écrire « + 3 » ou « \times 2 ». Vide et non focalisé, c'est un petit bouton
 * « + Opération » — un `<input>` vide sans bordure ni placeholder ne se voyait
 * pas, donc rien ne disait qu'on pouvait cliquer là. Rempli et non focalisé,
 * il affiche son propre rendu KaTeX — EXACTEMENT comme son double
 * `OPERATION_MIRROR_STYLE` sous l'autre membre, lui aussi cliquable — pour que
 * les deux côtés se lisent ET s'éditent de façon identique ; cliquer dessus
 * repasse en LaTeX brut éditable, jusqu'au `blur` suivant.
 */
function EquationOperationField({
  value,
  onChangeValue,
  ariaLabel,
  dataTestId,
  onFocusHandle,
  onEnter,
  onEnterBlock,
  onBackspaceAtStart,
  onDeleteAtEnd,
  onExit,
  style,
  ref,
}: {
  value: string
  onChangeValue: (next: string) => void
  ariaLabel: string
  dataTestId?: string
  onFocusHandle: () => void
  onEnter: () => void
  onEnterBlock: (place: BlockPlace) => void
  onBackspaceAtStart: (rest: string) => void
  onDeleteAtEnd: (rest: string) => void
  onExit: (direction: ExitDirection, via: ExitVia) => boolean | void
  style?: CSSProperties
  ref?: React.Ref<MathFieldHandle>
}) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Le caret à poser dès que l'`<input>` existe — mis de côté quand
  // `focusStart`/`focusEnd`/`focusAt`/`insert` sont appelés alors que le champ
  // montre encore son rendu KaTeX (donc sans `<input>` à qui parler tout de
  // suite). `null` retombe sur la fin, le geste par défaut d'un clic sur le
  // rendu — cohérent avec `insert` ailleurs dans l'app quand il n'y a pas de
  // caret vivant à viser.
  const pendingCaret = useRef<'start' | 'end' | number | null>(null)
  // Sans ce garde, TOUT passage en mode `<input>` — y compris celui d'une
  // étape qu'on vient d'ajouter, dont le champ opération est vide — volerait
  // le focus posé ailleurs (le membre gauche de l'étape suivante, via
  // `EquationBlockField`).
  const shouldFocus = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  const showInput = focused

  useEffect(() => {
    if (!showInput || !shouldFocus.current) return
    const input = inputRef.current
    if (input === null) return
    shouldFocus.current = false
    if (document.activeElement !== input) input.focus()
    const caret = pendingCaret.current
    pendingCaret.current = null
    const offset = caret === 'start' ? 0 : caret === null || caret === 'end' ? input.value.length : caret
    input.setSelectionRange(offset, offset)
  }, [showInput])

  function focusAt(caret: 'start' | 'end' | number) {
    const input = inputRef.current
    if (input !== null) {
      input.focus()
      const offset = caret === 'start' ? 0 : caret === 'end' ? input.value.length : caret
      input.setSelectionRange(offset, offset)
      return
    }
    pendingCaret.current = caret
    shouldFocus.current = true
    setFocused(true)
  }

  useImperativeHandle(
    ref,
    () => ({
      insert(rich, plain = rich) {
        onChangeValue(valueRef.current + plain)
        focusAt('end')
      },
      focusEnd: () => focusAt('end'),
      focusStart: () => focusAt('start'),
      focusAt,
    }),
    []
  )

  if (showInput) {
    return (
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        data-testid={dataTestId}
        value={value}
        spellCheck={false}
        onFocus={() => {
          setFocused(true)
          onFocusHandle()
        }}
        onBlur={() => setFocused(false)}
        onChange={event => onChangeValue(event.target.value)}
        onKeyDown={event => {
          const field = event.currentTarget
          // Le clavier physique tape « * » et « / » pour multiplier et
          // diviser, mais ce champ est du LaTeX brut : sans ça, KaTeX les
          // rendrait tels quels au lieu des vrais signes × et ÷. On
          // remplace donc la frappe elle-même, comme `pasteInto` dans
          // `FieldContextMenu.tsx` — via le setter natif, pour que React
          // voie le changement par son propre `onChange`.
          if ((event.key === '*' || event.key === '/') && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            const replacement = event.key === '*' ? '\\times ' : '\\div '
            const start = field.selectionStart ?? field.value.length
            const end = field.selectionEnd ?? start
            const nextValue = field.value.slice(0, start) + replacement + field.value.slice(end)
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            setter?.call(field, nextValue)
            field.dispatchEvent(new Event('input', { bubbles: true }))
            const caret = start + replacement.length
            field.setSelectionRange(caret, caret)
            return
          }
          rawFieldKeyDown({
            onEnter: () => onEnter(),
            onEnterBlock,
            onBackspaceAtStart,
            onDeleteAtEnd,
            onExit,
            tabExits: true,
          })(event)
        }}
        style={{ ...style, ...OPERATION_INPUT_STYLE }}
      />
    )
  }

  if (value === '') {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        data-testid={dataTestId}
        onClick={() => {
          shouldFocus.current = true
          setFocused(true)
        }}
        style={{ ...style, ...OPERATION_ADD_BUTTON_STYLE }}
      >
        <Plus size={12} />
        Opération
      </button>
    )
  }

  return (
    <div
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      onClick={() => {
        shouldFocus.current = true
        setFocused(true)
      }}
      onFocus={() => {
        shouldFocus.current = true
        setFocused(true)
        onFocusHandle()
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          shouldFocus.current = true
          setFocused(true)
        }
      }}
      style={{ ...style, cursor: 'text' }}
      // Safe: `renderMathToHtml` escapes the text it emits, and `trust: false`
      // keeps it from building links or embedding resources (see renderMath
      // tests) — même garantie que le double en lecture seule sous l'autre
      // membre.
      dangerouslySetInnerHTML={{ __html: renderMathToHtml(value, false) }}
    />
  )
}

export interface EquationBlockFieldProps {
  block: Extract<CardBlock, { kind: 'equation' }>
  index: number
  onChange: (block: CardBlock) => void
  /** Ctrl/Cmd+Entrée (`outside`, après le groupe) ou Ctrl/Cmd+Maj+Entrée (`inside`, dans le groupe). */
  onEnterBlock: (place: BlockPlace) => void
  /** Retour arrière tout en début du bloc, quand il est vide : il demande à disparaître vers le précédent. */
  onDeleteEmpty: () => void
  /** Suppr tout en fin du bloc, quand il est vide : il demande à disparaître vers le suivant. */
  onDeleteForward: () => void
  /** Une flèche qui sort du bloc par le haut/gauche (`before`) ou le bas/droite (`after`). */
  onExitBlock: (side: 'before' | 'after') => void
  /** Le champ vivant du membre focalisé, pour les touches du bandeau de symboles. */
  onFieldChange: (handle: MathFieldHandle | null) => void
  ref?: React.Ref<BlockEdgeHandle>
}

/**
 * L'éditeur d'un bloc équation : une suite d'étapes, chacune un membre gauche
 * et un membre droit dans des cases de couleur, séparées par « = », puis
 * l'opération qui mène à l'étape suivante. Le clavier suit le tableau
 * « Équation » de la spec de navigation : l'ordre de lecture et les flèches
 * vivent dans `equationNav.ts` ; Entrée passe à l'étape suivante (en
 * réutilisant une étape vide) ; Retour arrière/Suppr vont de champ en champ et
 * ne suppriment qu'une étape vide ou un bloc entièrement vide ; Opₙ reste
 * visible sauf après une étape résolue où rien n'est écrit.
 */
export function EquationBlockField({
  block,
  index,
  onChange,
  onEnterBlock,
  onDeleteEmpty,
  onDeleteForward,
  onExitBlock,
  onFieldChange,
  ref,
}: EquationBlockFieldProps) {
  // Un bloc équation a toujours au moins une étape à l'écran, même si son
  // contenu sur disque est un `steps: []` malformé (voir `sanitizeBlock`) —
  // le premier changement réécrit alors ce repli dans le bloc lui-même.
  const steps = block.steps.length > 0 ? block.steps : [{ left: '', right: '' }]
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const handles = useRef(new Map<string, MathFieldHandle | null>())
  const pending = useRef<{ pos: EqPos; at: 'start' | 'end' } | null>(null)
  // Le dernier membre (G ou D) qui a eu le focus, quelle que soit la façon :
  // c'est là que ↑/↓ reviennent depuis une opération. G au montage.
  const column = useRef<EqColumn>('left')

  function handleAt(pos: EqPos): MathFieldHandle | null {
    return handles.current.get(fieldKey(pos.step, pos.field)) ?? null
  }

  // Le focus est posé APRÈS le rendu qui a ajouté ou retiré une étape : c'est
  // le seul moment où le handle de l'étape visée existe. Une opération qui
  // vient de disparaître (dernière étape devenue résolue) renvoie au membre
  // droit de la même étape plutôt que de perdre le curseur.
  useEffect(() => {
    const target = pending.current
    if (target === null) return
    pending.current = null
    const handle = handleAt(target.pos) ?? handleAt({ step: target.pos.step, field: 'right' })
    if (handle === null) return
    if (target.at === 'end') handle.focusEnd()
    else handle.focusStart()
  })

  useImperativeHandle(
    ref,
    () => ({
      focusEdge(at) {
        const order = readingOrder(stepsRef.current)
        const pos = at === 'start' ? order[0] : order[order.length - 1]
        const handle = pos === undefined ? null : handleAt(pos)
        if (at === 'start') handle?.focusStart()
        else handle?.focusEnd()
      },
    }),
    []
  )

  function write(next: EquationStep[]) {
    onChange({ kind: 'equation', steps: next, ...(block.standalone === true ? { standalone: true } : {}) })
  }

  function setField(stepIndex: number, field: EqField, value: string) {
    write(steps.map((step, i) => (i === stepIndex ? { ...step, [field]: value } : step)))
  }

  /** Focus DIRECT sur un champ déjà monté — pas de `pending` : un simple déplacement ne change pas le contenu. */
  function focusField(pos: EqPos, at: 'start' | 'end') {
    const handle = handleAt(pos)
    if (handle === null) return
    if (at === 'end') handle.focusEnd()
    else handle.focusStart()
  }

  function removeStep(stepIndex: number, focus: EqPos, at: 'start' | 'end') {
    write(steps.filter((_, i) => i !== stepIndex))
    pending.current = { pos: focus, at }
  }

  /** Entrée : l'étape suivante si elle est vide, sinon une étape neuve — focus sur son membre gauche. */
  function enterStep(stepIndex: number) {
    const next = steps[stepIndex + 1]
    if (next !== undefined && isStepEmpty(next)) {
      focusField({ step: stepIndex + 1, field: 'left' }, 'start')
      return
    }
    const inserted = [...steps]
    inserted.splice(stepIndex + 1, 0, { left: '', right: '' })
    write(inserted)
    pending.current = { pos: { step: stepIndex + 1, field: 'left' }, at: 'start' }
  }

  /** Une flèche ou Tab depuis `from` — voir `navigate`. Tab sans destination retombe sur le navigateur. */
  function go(from: EqPos, direction: ExitDirection, via: ExitVia): boolean {
    const target = navigate(steps, from, direction, column.current)
    if (target === 'exit-before' || target === 'exit-after') {
      if (via === 'tab') return false
      onExitBlock(target === 'exit-before' ? 'before' : 'after')
      return true
    }
    focusField(target.pos, target.at)
    return true
  }

  /** Les intentions clavier d'un champ — le tableau « Équation » de la spec, ligne à ligne. */
  function intentsFor(pos: EqPos) {
    const { step: i, field } = pos
    const blockEmpty = steps.length === 1 && isStepEmpty(steps[0])
    return {
      onEnter: () => enterStep(i),
      onEnterBlock,
      onExit: (direction: ExitDirection, via: ExitVia) => go(pos, direction, via),
      onBackspaceAtStart: () => {
        if (field === 'right') return focusField({ step: i, field: 'left' }, 'end')
        if (field === 'operation') return focusField({ step: i, field: 'right' }, 'end')
        if (i === 0) {
          if (blockEmpty) onDeleteEmpty()
          return
        }
        const previousOperation: EqPos = { step: i - 1, field: 'operation' }
        if (isStepEmpty(steps[i])) removeStep(i, previousOperation, 'end')
        else focusField(previousOperation, 'end')
      },
      onDeleteAtEnd: () => {
        if (field === 'left') return focusField({ step: i, field: 'right' }, 'start')
        if (field === 'right') {
          if (operationVisible(steps, i)) return focusField({ step: i, field: 'operation' }, 'start')
          if (i + 1 < steps.length) return focusField({ step: i + 1, field: 'left' }, 'start')
          if (blockEmpty) onDeleteForward()
          return
        }
        const next = steps[i + 1]
        if (next === undefined) {
          if (blockEmpty) onDeleteForward()
          return
        }
        if (isStepEmpty(next)) removeStep(i + 1, pos, 'end')
        else focusField({ step: i + 1, field: 'left' }, 'start')
      },
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((step, stepIndex) => {
        const showOperation = operationVisible(steps, stepIndex)
        const solved = equationStepIsSolved(steps, stepIndex)
        return (
          <div key={stepIndex} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, ...(solved ? SOLVED_ROW : null) }}>
              <EquationTermField
                value={step.left}
                onChangeValue={value => setField(stepIndex, 'left', value)}
                ariaLabel={`Membre gauche de l'étape ${stepIndex + 1} du bloc ${index + 1}`}
                registerHandle={handle => handles.current.set(fieldKey(stepIndex, 'left'), handle)}
                {...intentsFor({ step: stepIndex, field: 'left' })}
                onFocusHandle={() => {
                  column.current = 'left'
                  onFieldChange(handles.current.get(fieldKey(stepIndex, 'left')) ?? null)
                }}
                side="left"
                style={solved ? SOLVED_TERM : LEFT_BOX}
              />
              <div
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  opacity: solved ? 1 : 0.75,
                  color: solved ? '#1f6a3f' : undefined,
                }}
              >
                =
              </div>
              <EquationTermField
                value={step.right}
                onChangeValue={value => setField(stepIndex, 'right', value)}
                ariaLabel={`Membre droit de l'étape ${stepIndex + 1} du bloc ${index + 1}`}
                registerHandle={handle => handles.current.set(fieldKey(stepIndex, 'right'), handle)}
                {...intentsFor({ step: stepIndex, field: 'right' })}
                onFocusHandle={() => {
                  column.current = 'right'
                  onFieldChange(handles.current.get(fieldKey(stepIndex, 'right')) ?? null)
                }}
                side="right"
                style={solved ? SOLVED_TERM : RIGHT_BOX}
              />
            </div>

            {showOperation && (
              // L'opération n'est SAISIE qu'une fois (un seul champ vivant,
              // sous le membre gauche) mais AFFICHÉE deux fois — une fois
              // sous chaque membre, chacune centrée sous sa case — pour bien
              // montrer visuellement qu'elle porte sur les DEUX à la fois.
              // Voir `EquationStep.operation` dans `cardBlock.ts`.
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <EquationOperationField
                  value={step.operation ?? ''}
                  onChangeValue={value => setField(stepIndex, 'operation', value)}
                  ariaLabel={`Opération après l'étape ${stepIndex + 1} du bloc ${index + 1}`}
                  dataTestId={`equation-op-input-${index}-${stepIndex}`}
                  ref={handle => {
                    handles.current.set(fieldKey(stepIndex, 'operation'), handle)
                  }}
                  onFocusHandle={() => onFieldChange(handles.current.get(fieldKey(stepIndex, 'operation')) ?? null)}
                  {...intentsFor({ step: stepIndex, field: 'operation' })}
                  style={OPERATION_FIELD_STYLE}
                />
                {/* La même largeur que le « = » de la ligne au-dessus : sans
                    elle, les deux moitiés de cette ligne se rapprocheraient
                    l'une de l'autre et ne resteraient plus sous leurs cases. */}
                <div aria-hidden style={{ flex: '0 0 auto', width: 18 }} />
                {/* Le double affiché à droite : jamais un second CHAMP — taper
                    à gauche le met à jour comme le reste du rendu — mais
                    cliquable comme lui, pour éditer la même opération sans
                    devoir viser précisément le membre gauche. `aria-hidden`
                    pour ne pas faire lire le même texte deux fois : le
                    membre gauche reste le seul exposé aux lecteurs d'écran. */}
                <div
                  aria-hidden
                  data-testid={`equation-op-mirror-${index}-${stepIndex}`}
                  onClick={() => handles.current.get(fieldKey(stepIndex, 'operation'))?.focusEnd()}
                  style={{ ...OPERATION_MIRROR_STYLE, cursor: 'text' }}
                  dangerouslySetInnerHTML={{ __html: renderMathToHtml(step.operation ?? '', false) }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
