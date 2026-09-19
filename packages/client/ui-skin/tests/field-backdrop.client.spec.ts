// @vitest-environment jsdom
/** Field backdrop: DOM shape, pointer painting, pattern handoff, and disposal. */
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
  it('mounts first in the body with its wash and pattern layers', () => {
    // jsdom has no WebGL2, so the pattern canvas stays hidden behind the wash.
    const backdrop = createFieldBackdrop('dark')
    expect(document.body.firstElementChild).toBe(backdrop.element)
    const layers = [...backdrop.element.children]
    expect(layers.map(child => child.getAttribute('data-dsh-field-layer'))).toEqual(['wash', 'pattern'])
    expect((layers[1] as HTMLCanvasElement).hidden).toBe(true)
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

    const backdrop = createFieldBackdrop('light')
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 240 }))
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

  it('hands the colour scheme to a live pattern and follows the reduced-motion query', () => {
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
      ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
      createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
      deleteShader: () => {}, getShaderParameter: () => true,
      createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
      deleteProgram: () => {}, getProgramParameter: () => true, useProgram: () => {},
      createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {}, deleteBuffer: () => {},
      getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
      getUniformLocation: () => ({}), uniform1f: vi.fn(), uniform2f: () => {}, uniform4f: vi.fn(),
      drawArrays: () => {}, viewport: () => {},
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => gl as unknown as WebGL2RenderingContext)
    const listeners = new Set<() => void>()
    const query = {
      matches: false,
      addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
    }
    vi.stubGlobal('matchMedia', () => query as unknown as MediaQueryList)

    const backdrop = createFieldBackdrop('light')
    const canvas = backdrop.element.querySelector('canvas')!
    expect(canvas.hidden).toBe(false)
    backdrop.setColorScheme('dark')
    expect(gl.uniform4f).toHaveBeenCalled()
    expect(gl.uniform1f).toHaveBeenCalled()
    for (const listener of [...listeners]) listener()
    backdrop.dispose()
    expect(listeners.size).toBe(0)
  })
})
