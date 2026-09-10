import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../../types/quizSettings'
import { saveAppearanceSettings } from '../../persistence/appearanceSettings'
import { saveQuizSettings } from '../../persistence/quizSettings'

vi.mock('../../persistence/appearanceSettings', () => ({
  loadAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn().mockResolvedValue(undefined),
}))

const updateCheckStub = { status: 'idle' as const, checkNow: vi.fn().mockResolvedValue(undefined) }

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    useQuizSettingsStore.setState(DEFAULT_QUIZ_SETTINGS)
  })

  it('opens on the Général tab', () => {
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    expect(screen.getByRole('tab', { name: /général/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('radiogroup', { name: 'Thème' })).toBeInTheDocument()
  })

  it('forwards the update-check button to the Général tab', async () => {
    const user = userEvent.setup()
    const checkNow = vi.fn().mockResolvedValue(undefined)
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={{ status: 'idle', checkNow }} />)

    await user.click(screen.getByRole('button', { name: 'Rechercher les mises à jour' }))

    expect(checkNow).toHaveBeenCalled()
  })

  it('offers every section as a tab so the header only needs one button', () => {
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      expect.stringContaining('Général'),
      expect.stringContaining('Apparence'),
      expect.stringContaining('Quiz'),
      expect.stringContaining('Raccourcis'),
    ])
  })

  it('opens straight on the tab it was asked for', () => {
    render(
      <SettingsDialog open initialTab="shortcuts" onOpenChange={() => {}} updateCheck={updateCheckStub} />
    )

    expect(screen.getByRole('tab', { name: /Raccourcis/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Rechercher un raccourci')).toBeInTheDocument()
  })

  it('switches panels when another tab is picked', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('tab', { name: /quiz/i }))

    expect(screen.getByText(/Précision exigée pour "correct" : 100%/)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Thème' })).not.toBeInTheDocument()
  })

  it('shows the level editors on the Apparence tab', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('tab', { name: /apparence/i }))

    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Info')).toBeInTheDocument()
  })

  it('previews an edit immediately, without writing it to disk', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))

    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
    expect(saveAppearanceSettings).not.toHaveBeenCalled()
  })

  it('reports unsaved changes and only then allows saving', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    const save = screen.getByRole('button', { name: 'Enregistrer' })
    expect(save).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Tout est enregistré')

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))

    expect(save).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Modifications non enregistrées')
  })

  it('persists both settings files and closes on Enregistrer', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<SettingsDialog open onOpenChange={onOpenChange} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(saveAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ themeMode: 'dark' }))
    expect(saveQuizSettings).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('puts the previewed change back on Annuler', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<SettingsDialog open onOpenChange={onOpenChange} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(useAppearanceSettingsStore.getState().themeMode).toBe('system')
    expect(saveAppearanceSettings).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reverts a quiz change on Annuler too, not just an appearance one', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('tab', { name: /quiz/i }))
    await user.click(screen.getByRole('switch', { name: /Montrer la forme de la réponse/ }))
    expect(useQuizSettingsStore.getState().lengthGuideEnabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(useQuizSettingsStore.getState().lengthGuideEnabled).toBe(true)
  })

  it('saves a quiz change made on the Quiz tab', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('tab', { name: /quiz/i }))
    await user.click(screen.getByRole('switch', { name: /Corriger lettre par lettre/ }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(saveQuizSettings).toHaveBeenCalledWith(expect.objectContaining({ liveLetterFeedback: true }))
  })

  it('re-snapshots on each open, so a saved change is not reverted by a later cancel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    rerender(<SettingsDialog open={false} onOpenChange={() => {}} updateCheck={updateCheckStub} />)
    rerender(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    // "dark" was saved in the first session; cancelling the second must fall
    // back to THAT, not to the value the very first snapshot happened to hold.
    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
  })
})
