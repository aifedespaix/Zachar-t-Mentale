import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

describe('React Flow smoke test', () => {
  it('renders an empty canvas without crashing', () => {
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 400 }}>
          <ReactFlow nodes={[]} edges={[]} />
        </div>
      </ReactFlowProvider>
    )
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
  })
})
