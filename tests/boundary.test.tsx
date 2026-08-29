import { describe, expect, test } from 'bun:test'
import { Boundary } from '../src/client/Boundary.tsx'

describe('the error boundary', () => {
  test('turns a thrown error into a state it can render', () => {
    const state = Boundary.getDerivedStateFromError(new Error('the deck caught fire'))
    expect(state.broke).toBe(true)
    expect(state.what).toBe('the deck caught fire')
  })

  test('copes with something thrown that is not an Error', () => {
    expect(Boundary.getDerivedStateFromError('just a string').broke).toBe(true)
    expect(Boundary.getDerivedStateFromError('just a string').what).toBe('just a string')
    expect(Boundary.getDerivedStateFromError(undefined).broke).toBe(true)
    expect(Boundary.getDerivedStateFromError(null).what).toBe('null')
  })
})
