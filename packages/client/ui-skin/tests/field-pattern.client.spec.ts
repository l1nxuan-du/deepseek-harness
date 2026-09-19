// @vitest-environment jsdom
/** Flow pattern: program setup, presets, loop control, and teardown. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOW_PRESETS, createFieldPattern, type FieldPattern } from '../src/client/field-pattern.ts'

interface FakeGlOptions {
  readonly failVertex?: boolean
  readonly failFragment?: boolean
  readonly failLink?: boolean
  readonly noContext?: boolean
}

/** Minimal WebGL2 stub recording the calls the pattern makes. */
function fakeGl(options: FakeGlOptions = {}) {
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    createShader: vi.fn(() => ({ shader: true })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    deleteShader: vi.fn(),
    getShaderParameter: vi.fn((_shader: unknown, type: number) =>
      type === 0x8b30 ? options.failFragment !== true : options.failVertex !== true),
    createProgram: vi.fn(() => ({ program: true })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteProgram: vi.fn(),
    getProgramParameter: vi.fn(() => options.failLink !== true),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({ buffer: true })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    drawArrays: vi.fn(),
    viewport: vi.fn(),
  }
  return gl
}

let rafCallbacks: FrameRequestCallback[] = []
let cancelFrame: ReturnType<typeof vi.fn>
const mounted: FieldPattern[] = []

/** Mount a pattern and let the suite release it, so no loop outlives its case. */
function mount(canvas: HTMLCanvasElement): FieldPattern {
  const pattern = createFieldPattern(canvas)!
  mounted.push(pattern)
  return pattern
}

beforeEach(() => {
  rafCallbacks = []
  cancelFrame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
})

afterEach(() => {
  for (const pattern of mounted.splice(0)) pattern.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function canvasWith(gl: ReturnType<typeof fakeGl> | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.getContext = vi.fn(() => gl) as unknown as HTMLCanvasElement['getContext']
  return canvas
}

describe('field pattern', () => {
  it('builds the quad program and draws the light preset', () => {
    const gl = fakeGl()
    const canvas = canvasWith(gl)
    const pattern = mount(canvas)
    expect(pattern).not.toBeNull()
    expect(gl.useProgram).toHaveBeenCalled()
    expect(gl.bufferData).toHaveBeenCalled()
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
    // The light preset leads with #8AA3D6 as the first colour uniform.
    expect(gl.uniform4f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'u_color1' }), 138 / 255, 163 / 255, 214 / 255, 1)
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_colorCount' }), 3)
    // Sizing: the canvas takes the capped device pixel ratio at least 1px.
    expect(canvas.width).toBeGreaterThanOrEqual(1)
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height)
  })

  it('returns null without a WebGL2 context', () => {
    expect(createFieldPattern(canvasWith(null))).toBeNull()
  })

  it('returns null and releases the shader when a stage fails to compile', () => {
    const gl = fakeGl({ failVertex: true })
    expect(createFieldPattern(canvasWith(gl))).toBeNull()
    expect(gl.deleteShader).toHaveBeenCalled()
    expect(gl.createProgram).not.toHaveBeenCalled()
  })

  it('returns null when the driver cannot allocate a shader', () => {
    const gl = fakeGl()
    gl.createShader.mockReturnValueOnce(null as never)
    expect(createFieldPattern(canvasWith(gl))).toBeNull()
  })

  it('returns null when the driver cannot allocate a program', () => {
    const gl = fakeGl()
    gl.createProgram.mockReturnValueOnce(null as never)
    expect(createFieldPattern(canvasWith(gl))).toBeNull()
  })

  it('returns null when the program fails to link', () => {
    const gl = fakeGl({ failLink: true })
    expect(createFieldPattern(canvasWith(gl))).toBeNull()
    expect(gl.createProgram).toHaveBeenCalled()
  })

  it('keeps the wash when the browser exposes no reduced-motion query', () => {
    vi.stubGlobal('matchMedia', undefined)
    const gl = fakeGl()
    expect(mount(canvasWith(gl))).toBeDefined()
    expect(gl.drawArrays).toHaveBeenCalled()
  })

  it('skips the frame when the document is already hidden', () => {
    const gl = fakeGl()
    mount(canvasWith(gl))
    const pending = rafCallbacks.pop()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    expect(pending).toBeDefined()
    pending?.(0)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('ignores a repeated size and an absent device pixel ratio', () => {
    const gl = fakeGl()
    const canvas = canvasWith(gl)
    mount(canvas)
    const viewportsBefore = gl.viewport.mock.calls.length
    window.dispatchEvent(new Event('resize'))
    // The second pass measures the same box, so it neither re-sizes nor redraws.
    expect(gl.viewport.mock.calls.length).toBe(viewportsBefore)
    vi.stubGlobal('devicePixelRatio', 0)
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 200 })
    window.dispatchEvent(new Event('resize'))
    expect(canvas.width).toBe(200)
  })

  it('leaves a live frame alone when the document becomes visible again', () => {
    const gl = fakeGl()
    mount(canvasWith(gl))
    rafCallbacks = []
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rafCallbacks).toHaveLength(0)
  })

  it('switches the colour preset', () => {
    const gl = fakeGl()
    const pattern = mount(canvasWith(gl))
    gl.uniform4f.mockClear()
    pattern.setColorScheme('dark')
    // The dark preset leads with #2F4C8F.
    expect(gl.uniform4f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'u_color1' }), 47 / 255, 76 / 255, 143 / 255, 1)
    expect(FLOW_PRESETS.dark.colors[0]).toBe('#2F4C8F')
  })

  it('stops for reduced motion and restarts when it clears', () => {
    const gl = fakeGl()
    const pattern = mount(canvasWith(gl))
    const drawsBefore = gl.drawArrays.mock.calls.length
    pattern.setReducedMotion(true)
    expect(cancelFrame).toHaveBeenCalled()
    expect(gl.drawArrays.mock.calls.length).toBe(drawsBefore + 1)
    rafCallbacks = []
    pattern.setReducedMotion(false)
    expect(rafCallbacks).toHaveLength(1)
  })

  it('pauses while the document is hidden and resumes when it returns', () => {
    const gl = fakeGl()
    const pattern = mount(canvasWith(gl))
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancelFrame).toHaveBeenCalled()
    rafCallbacks = []
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rafCallbacks).toHaveLength(1)
    pattern.dispose()
  })

  it('re-sizes the drawing buffer on a window resize and releases everything on dispose', () => {
    const gl = fakeGl()
    const canvas = canvasWith(gl)
    const pattern = mount(canvas)
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 300 })
    window.dispatchEvent(new Event('resize'))
    expect(canvas.width).toBe(400)
    expect(canvas.height).toBe(300)
    pattern.dispose()
    expect(gl.deleteBuffer).toHaveBeenCalled()
    expect(gl.deleteProgram).toHaveBeenCalled()
  })
})
