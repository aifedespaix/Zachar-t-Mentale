import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentFilesList } from './RecentFilesList'
import { useMindMapAuthor } from '../hooks/useMindMapAuthor'

vi.mock('../hooks/useMindMapAuthor', () => ({ useMindMapAuthor: vi.fn() }))

describe('RecentFilesList', () => {
  beforeEach(() => {
    vi.mocked(useMindMapAuthor).mockReset().mockReturnValue(null)
  })

  it('renders nothing when there is no history', () => {
    const { container } = render(<RecentFilesList files={[]} onOpen={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each file by name, with its parent folder for disambiguation', () => {
    render(
      <RecentFilesList
        files={[
          { path: '/cours/svt/chapitre1.zmap', openedAt: new Date().toISOString() },
          { path: '/cours/maths/chapitre1.zmap', openedAt: new Date().toISOString() },
        ]}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getAllByText('chapitre1')).toHaveLength(2)
    expect(screen.getByText('svt')).toBeInTheDocument()
    expect(screen.getByText('maths')).toBeInTheDocument()
  })

  it('opens the file that was clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <RecentFilesList
        files={[
          { path: '/cours/svt/chapitre1.zmap', openedAt: new Date().toISOString() },
          { path: '/cours/maths/chapitre2.zmap', openedAt: new Date().toISOString() },
        ]}
        onOpen={onOpen}
      />
    )

    await user.click(screen.getByRole('button', { name: /chapitre2/ }))

    expect(onOpen).toHaveBeenCalledWith('/cours/maths/chapitre2.zmap')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the map type badge, like the sidebar tree', async () => {
    vi.mocked(useMindMapAuthor).mockReturnValue({
      id: 'f1',
      author: 'aife',
      role: 'prof',
      lastModified: 'x',
      type: 'exo',
    })
    render(
      <RecentFilesList files={[{ path: '/cours/svt/chapitre1.zmap', openedAt: new Date().toISOString() }]} onOpen={vi.fn()} />
    )

    expect(await screen.findByTestId('map-type-badge')).toHaveTextContent('Exercices')
  })
})
