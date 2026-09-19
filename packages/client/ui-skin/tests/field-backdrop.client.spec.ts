// @vitest-environment jsdom
/** Field backdrop: DOM shape, coalesced pointer painting, and disposal. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIELD_ATTRIBUTE, FIELD_POINTER_ATTRIBUTE, FIELD_X_VARIABLE, FIELD_Y_VARIABLE, createFieldBackdrop,
} from '../src/client/field-backdrop.ts'

afterEach(() => {
  document.querySelectorAll(`[${FIELD_ATTRIBUTE}]`).forEach((node) => { node.remove() })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('field backdrop', () => {
  it('mounts first in the body with its two layers', () => {
    const backdrop = createFieldBackdrop()
    expect(document.body.firstElementChild).toBe(backdrop.element)
    expect([...backdrop.element.children].map(child => child.getAttribute('data-dsh-field-layer')))
      .toEqual(['wash', 'grid'])
    expect(backdrop.element.getAttribute('aria-hidden')).toBe('true')
    backdrop.dispose()
  })

  it('paints the pointer position once per frame and clears it on leave', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)

    const backdrop = createFieldBackdrop()
    const pointer = new MouseEvent('pointermove', { clientX: 120, clientY: 240 })
    window.dispatchEvent(pointer)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 400 }))
    expect(callbacks).toHaveLength(1)
    callbacks[0]?.(0)
    expect(backdrop.element.style.getPropertyValue(FIELD_X_VARIABLE)).toBe('300px')
    expect(backdrop.element.style.getPropertyValue(FIELD_Y_VARIABLE)).toBe('400px')
    expect(backdrop.element.hasAttribute(FIELD_POINTER_ATTRIBUTE)).toBe(true)

    document.dispatchEvent(new Event('pointerleave'))
    expect(backdrop.element.hasAttribute(FIELD_POINTER_ATTRIBUTE)).toBe(false)

    // A pending frame is cancelled on dispose, and both listeners are gone.
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    backdrop.dispose()
    expect(cancel).toHaveBeenCalledWith(2)
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 20 }))
    expect(callbacks).toHaveLength(2)
  })
})
