import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

function Hello() {
  return <p>hello test harness</p>
}

describe('test harness smoke test', () => {
  it('renders a component and finds it by text', () => {
    render(<Hello />)
    expect(screen.getByText('hello test harness')).toBeInTheDocument()
  })
})
