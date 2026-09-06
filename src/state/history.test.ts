import { describe, it, expect } from 'vitest'
import { createHistory, pushState, undo, redo } from './history'

describe('history', () => {
  it('starts with only a present value', () => {
    const h = createHistory(1)
    expect(h.present).toBe(1)
    expect(h.past).toEqual([])
    expect(h.future).toEqual([])
  })

  it('pushState moves the old present into past', () => {
    const h = pushState(createHistory(1), 2)
    expect(h.present).toBe(2)
    expect(h.past).toEqual([1])
  })

  it('undo restores the previous present and stashes the current one in future', () => {
    const h = pushState(createHistory(1), 2)
    const undone = undo(h)
    expect(undone.present).toBe(1)
    expect(undone.future).toEqual([2])
  })

  it('undo is a no-op when there is no past', () => {
    const h = createHistory(1)
    expect(undo(h)).toEqual(h)
  })

  it('redo re-applies a value that was undone', () => {
    const h = pushState(createHistory(1), 2)
    const redone = redo(undo(h))
    expect(redone.present).toBe(2)
    expect(redone.future).toEqual([])
  })

  it('redo is a no-op when there is no future', () => {
    const h = createHistory(1)
    expect(redo(h)).toEqual(h)
  })

  it('pushState after an undo clears the redo stack', () => {
    const h = pushState(createHistory(1), 2)
    const branched = pushState(undo(h), 3)
    expect(branched.present).toBe(3)
    expect(branched.future).toEqual([])
  })
})
