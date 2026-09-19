// @vitest-environment jsdom
/** Field backdrop: DOM shape, pattern handoff, and disposal. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIELD_ATTRIBUTE, createFieldBackdrop } from '../src/client/field-backdrop.ts'

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
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()
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
