// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveGraph, type GraphPayload } from './useLiveGraph.js'

/** Stands in for the page's EventSource: `emit` sends one named event with a JSON `data`, as the server frames it. */
class FakeEvents extends EventTarget {
  closed = false
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
  close() {
    this.closed = true
  }
}

const payload = (name: string): GraphPayload => ({
  plan: { name, nodes: [{ id: 'water-ferns', title: 'Water the ferns', description: '', status: 'todo', tags: [], depends_on: [] }] },
  resources: {},
  bodies: {},
  warnings: [],
  generatedAt: 't1',
})

describe('useLiveGraph', () => {
  it('loads, refetches on reload, and keeps data on error', async () => {
    const events = new FakeEvents()
    const fetchGraph = vi.fn().mockResolvedValueOnce(payload('One')).mockResolvedValueOnce(payload('Two'))
    const { result } = renderHook(() => useLiveGraph({ fetchGraph, openEvents: () => events }))
    await waitFor(() => expect(result.current.data?.plan.name).toBe('One'))
    events.emit('error', { message: 'graph.json: Unexpected token' })
    await waitFor(() => expect(result.current.error).toBe('graph.json: Unexpected token'))
    expect(result.current.data?.plan.name).toBe('One')
    events.emit('reload', { generatedAt: 't2' })
    await waitFor(() => expect(result.current.data?.plan.name).toBe('Two'))
    expect(result.current.error).toBeNull()
  })

  it('ignores a bare error event (the stream dropping) and acts on one with data', async () => {
    const events = new FakeEvents()
    const fetchGraph = vi.fn().mockResolvedValue(payload('One'))
    const { result } = renderHook(() => useLiveGraph({ fetchGraph, openEvents: () => events }))
    await waitFor(() => expect(result.current.data?.plan.name).toBe('One'))
    act(() => {
      events.dispatchEvent(new Event('error'))
    })
    expect(result.current.error).toBeNull()
    act(() => events.emit('error', { message: 'x.md: bad frontmatter' }))
    expect(result.current.error).toBe('x.md: bad frontmatter')
  })

  it('dismissError clears the banner message', async () => {
    const events = new FakeEvents()
    const fetchGraph = vi.fn().mockResolvedValue(payload('One'))
    const { result } = renderHook(() => useLiveGraph({ fetchGraph, openEvents: () => events }))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    act(() => events.emit('error', { message: 'broken' }))
    expect(result.current.error).toBe('broken')
    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
    expect(result.current.data?.plan.name).toBe('One')
  })

  it('a failed fetch sets the error without throwing', async () => {
    const events = new FakeEvents()
    const fetchGraph = vi.fn().mockRejectedValue(new Error('GET /api/graph: 500'))
    const { result } = renderHook(() => useLiveGraph({ fetchGraph, openEvents: () => events }))
    await waitFor(() => expect(result.current.error).toBe('GET /api/graph: 500'))
    expect(result.current.data).toBeNull()
  })

  it('closes the event stream on unmount', () => {
    const events = new FakeEvents()
    const fetchGraph = vi.fn().mockResolvedValue(payload('One'))
    const { unmount } = renderHook(() => useLiveGraph({ fetchGraph, openEvents: () => events }))
    unmount()
    expect(events.closed).toBe(true)
  })
})
