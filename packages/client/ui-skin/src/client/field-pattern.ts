/**
 * The field's WebGL2 flow pattern: the landing-page shader the material
 * background is built from, with the study's two colour presets. The module
 * owns one canvas and its animation loop; a canvas without WebGL2 support is
 * left to the stylesheet's wash, so the field never disappears.
 */

/** Palette the pattern renders; the theme service resolves it. */
export type FieldColorScheme = 'light' | 'dark'

/** One shader preset: the colours and the numeric uniform set of the flow field. */
export interface FlowPreset {
  /** Mixer colours, most significant first (up to six). */
  colors: readonly string[]
  /** Animation speed as a percentage of real time. */
  speed: number
  /** Domain-warp distortion amount. */
  distortion: number
  /** Swirl amplitude. */
  swirl: number
  /** Swirl octave count. */
  swirlIterations: number
  /** Noise scale. */
  scale: number
  /** Field rotation in degrees. */
  rotation: number
  /** Mixer bias, 0..100. */
  proportion: number
  /** Blend softness, 0..100. */
  softness: number
  /** Shape frequency, 0..100. */
  shapeScale: number
  /** Horizontal offset as a percentage of the viewport. */
  offsetX: number
  /** Vertical offset as a percentage of the viewport. */
  offsetY: number
}

/** The study's presets: a blue-led light field and its dark counterpart. */
export const FLOW_PRESETS: Readonly<Record<FieldColorScheme, FlowPreset>> = Object.freeze({
  light: {
    colors: ['#8AA3D6', '#FFFFFF', '#FFFFFF'],
    speed: 14, distortion: 20, swirl: 12, swirlIterations: 8,
    scale: 0.5, rotation: -5, proportion: 50, softness: 100,
    shapeScale: 10, offsetX: 0, offsetY: 65,
  },
  dark: {
    colors: ['#2F4C8F', '#151517', '#151517'],
    speed: 14, distortion: 18, swirl: 10, swirlIterations: 8,
    scale: 0.5, rotation: -5, proportion: 50, softness: 100,
    shapeScale: 10, offsetX: 0, offsetY: 65,
  },
})

/** Shape index the study renders (`SHAPE_IDS.checks`). */
const SHAPE_CHECKS = 0

/** Cap on the device pixel ratio the pattern renders at. */
const MAX_PIXEL_RATIO = 1.5

const VERTEX_SHADER = [
  '#version 300 es',
  'in vec4 a_position;',
  'void main() {',
  '  gl_Position = a_position;',
  '}',
].join('\n')

const FRAGMENT_SHADER = [
  '#version 300 es',
  'precision mediump float;',
  '',
  'uniform float u_time;',
  'uniform float u_pixelRatio;',
  'uniform vec2 u_resolution;',
  'uniform float u_scale;',
  'uniform float u_rotation;',
  'uniform vec4 u_color1;',
  'uniform vec4 u_color2;',
  'uniform vec4 u_color3;',
  'uniform vec4 u_color4;',
  'uniform vec4 u_color5;',
  'uniform vec4 u_color6;',
  'uniform float u_colorCount;',
  'uniform float u_grain;',
  'uniform float u_proportion;',
  'uniform float u_softness;',
  'uniform float u_shape;',
  'uniform float u_shapeScale;',
  'uniform float u_distortion;',
  'uniform float u_swirl;',
  'uniform float u_swirlIterations;',
  'uniform vec2 u_offset;',
  '',
  'out vec4 fragColor;',
  '',
  '#define TWO_PI 6.28318530718',
  '#define PI 3.14159265358979323846',
  '',
  'vec2 rotate(vec2 uv, float th) {',
  '  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;',
  '}',
  '',
  'float random(vec2 st) {',
  '  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);',
  '}',
  '',
  'float noise(vec2 st) {',
  '  vec2 i = floor(st);',
  '  vec2 f = fract(st);',
  '  float a = random(i);',
  '  float b = random(i + vec2(1.0, 0.0));',
  '  float c = random(i + vec2(0.0, 1.0));',
  '  float d = random(i + vec2(1.0, 1.0));',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  float x1 = mix(a, b, u.x);',
  '  float x2 = mix(c, d, u.x);',
  '  return mix(x1, x2, u.y);',
  '}',
  '',
  'vec3 blend_multi(float mixer, float softness) {',
  '  float edge = 1.0 - softness;',
  '  vec3 col = u_color1.rgb;',
  '  if (u_colorCount > 1.5) {',
  '    float r1 = smoothstep(0.0 + 0.35 * edge, 0.7 - 0.35 * edge, mixer);',
  '    col = mix(col, u_color2.rgb, r1);',
  '  }',
  '  if (u_colorCount > 2.5) {',
  '    float r2 = smoothstep(0.3 + 0.35 * edge, 1.0 - 0.35 * edge, mixer);',
  '    col = mix(col, u_color3.rgb, r2);',
  '  }',
  '  if (u_colorCount > 3.5) {',
  '    col = mix(col, u_color4.rgb, smoothstep(0.4, 0.75, mixer));',
  '  }',
  '  if (u_colorCount > 4.5) {',
  '    col = mix(col, u_color5.rgb, smoothstep(0.55, 0.85, mixer));',
  '  }',
  '  if (u_colorCount > 5.5) {',
  '    col = mix(col, u_color6.rgb, smoothstep(0.7, 0.95, mixer));',
  '  }',
  '  return col;',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_resolution.xy;',
  '  float t = .5 * u_time;',
  '  float noise_scale = .0005 + .006 * u_scale;',
  '  uv -= .5;',
  '  uv *= (noise_scale * u_resolution);',
  '  uv = rotate(uv, u_rotation * .5 * PI);',
  '  uv /= u_pixelRatio;',
  '  uv += .5;',
  '  uv += u_offset;',
  '',
  '  float n1 = noise(uv * 1. + t);',
  '  float n2 = noise(uv * 2. - t);',
  '  float angle = n1 * TWO_PI;',
  '  uv.x += 4. * u_distortion * n2 * cos(angle);',
  '  uv.y += 4. * u_distortion * n2 * sin(angle);',
  '',
  '  float iterations_number = ceil(clamp(u_swirlIterations, 1., 30.));',
  '  for (float i = 1.; i <= 30.0; i++) {',
  '    if (i > iterations_number) break;',
  '    uv.x += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1.5 * uv.y);',
  '    uv.y += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1. * uv.x);',
  '  }',
  '',
  '  float proportion = clamp(u_proportion, 0., 1.);',
  '  float shape = 0.;',
  '  float mixer = 0.;',
  '  if (u_shape < .5) {',
  '    vec2 checks_shape_uv = uv * (.5 + 3.5 * u_shapeScale);',
  '    shape = .5 + .5 * sin(checks_shape_uv.x) * cos(checks_shape_uv.y);',
  '    mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);',
  '  } else if (u_shape < 1.5) {',
  '    vec2 stripes_shape_uv = uv * (.25 + 3. * u_shapeScale);',
  '    float f = fract(stripes_shape_uv.y);',
  '    shape = smoothstep(.0, .55, f) * smoothstep(1., .45, f);',
  '    mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);',
  '  } else {',
  '    float sh = 1. - uv.y;',
  '    sh -= .5;',
  '    sh /= (noise_scale * u_resolution.y);',
  '    sh += .5;',
  '    float shape_scaling = .2 * (1. - u_shapeScale);',
  '    shape = smoothstep(.45 - shape_scaling, .55 + shape_scaling, sh + .3 * (proportion - .5));',
  '    mixer = shape;',
  '  }',
  '',
  '  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));',
  '  fragColor = vec4(col, 1.0);',
  '',
  '  if (u_grain > 0.0) {',
  '    float g = random(gl_FragCoord.xy + vec2(u_time * 100.0));',
  '    fragColor.rgb += (g - 0.5) * u_grain;',
  '  }',
  '}',
].join('\n')

/** One mounted pattern and its controls. */
export interface FieldPattern {
  /** Switch the colour preset. */
  setColorScheme(scheme: FieldColorScheme): void
  /** Stop or restart the animation, redrawing one frame when it stops. */
  setReducedMotion(reduced: boolean): void
  /** Stop the loop, drop the listeners, and release the GL objects. */
  dispose(): void
}

/** Parsed `#rrggbb` colour as normalised rgb. */
function hexToRgb(hex: string): [number, number, number] {
  const digits = hex.replace('#', '')
  return [
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  ]
}

/** Compile one shader stage, releasing it when the driver rejects the source. */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/** Build the fullscreen-quad program, or null when the driver rejects it. */
function createFlowProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (vertexShader === null || fragmentShader === null) return null
  const program = gl.createProgram()
  /* oxlint-disable-next-line typescript/no-unnecessary-condition --
   * WebGL2 drivers may return null from createProgram, which the DOM type does not admit. */
  if (program === null) return null
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null
}

/**
 * Mount the flow pattern on one canvas. The canvas keeps the stylesheet's own
 * presentation; this function only sizes and draws it. Without WebGL2 — or
 * when the driver rejects the program — it returns null and leaves the canvas
 * empty, so the field falls back to the wash underneath.
 * @param canvas - the pattern canvas inside the field element.
 * @returns the mounted pattern, or null when the browser cannot render it.
 */
export function createFieldPattern(canvas: HTMLCanvasElement): FieldPattern | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, powerPreference: 'low-power' })
  if (gl === null) return null
  const program = createFlowProgram(gl)
  if (program === null) return null
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const uniform = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
  const uniforms = {
    time: uniform('u_time'),
    pixelRatio: uniform('u_pixelRatio'),
    resolution: uniform('u_resolution'),
    scale: uniform('u_scale'),
    rotation: uniform('u_rotation'),
    offset: uniform('u_offset'),
    color1: uniform('u_color1'),
    color2: uniform('u_color2'),
    color3: uniform('u_color3'),
    color4: uniform('u_color4'),
    color5: uniform('u_color5'),
    color6: uniform('u_color6'),
    colorCount: uniform('u_colorCount'),
    grain: uniform('u_grain'),
    proportion: uniform('u_proportion'),
    softness: uniform('u_softness'),
    shape: uniform('u_shape'),
    shapeScale: uniform('u_shapeScale'),
    distortion: uniform('u_distortion'),
    swirl: uniform('u_swirl'),
    swirlIterations: uniform('u_swirlIterations'),
  }

  const reducedQuery = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-reduced-motion: reduce)')
  let preset = FLOW_PRESETS.light
  let pixelRatio = 1
  let frame = 0
  let reduced = reducedQuery?.matches === true
  const started = performance.now()

  const setColor4 = (location: WebGLUniformLocation | null, rgb: readonly [number, number, number]): void => {
    gl.uniform4f(location, rgb[0], rgb[1], rgb[2], 1)
  }

  const draw = (): void => {
    const colors = preset.colors
    // Six colour uniforms always upload; a preset that declares fewer leaves
    // the trailing ones black, exactly as the study's draw pass does.
    const black: [number, number, number] = [0, 0, 0]
    const [color1 = black, color2 = black, color3 = black, color4 = black, color5 = black, color6 = black] =
      colors.map(color => hexToRgb(color))
    gl.uniform1f(uniforms.scale, preset.scale)
    gl.uniform2f(uniforms.offset, preset.offsetX / 100, preset.offsetY / 100)
    gl.uniform1f(uniforms.rotation, preset.rotation / 90)
    setColor4(uniforms.color1, color1)
    setColor4(uniforms.color2, color2)
    setColor4(uniforms.color3, color3)
    setColor4(uniforms.color4, color4)
    setColor4(uniforms.color5, color5)
    setColor4(uniforms.color6, color6)
    gl.uniform1f(uniforms.colorCount, colors.length)
    gl.uniform1f(uniforms.grain, 0)
    gl.uniform1f(uniforms.proportion, preset.proportion / 100)
    gl.uniform1f(uniforms.softness, preset.softness / 100)
    gl.uniform1f(uniforms.shape, SHAPE_CHECKS)
    gl.uniform1f(uniforms.shapeScale, preset.shapeScale / 100)
    gl.uniform1f(uniforms.distortion, preset.distortion / 100)
    gl.uniform1f(uniforms.swirl, preset.swirl / 50)
    gl.uniform1f(uniforms.swirlIterations, preset.swirlIterations)
    gl.uniform1f(uniforms.time, (performance.now() - started) * 0.001 * (preset.speed / 100))
    gl.uniform1f(uniforms.pixelRatio, pixelRatio)
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  const render = (): void => {
    frame = 0
    if (document.hidden || reduced) return
    draw()
    frame = requestAnimationFrame(render)
  }

  const resize = (): void => {
    pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio))
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio))
    if (canvas.width === width && canvas.height === height) return
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
    draw()
  }

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(frame)
      frame = 0
      return
    }
    if (frame === 0 && !reduced) render()
  }
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibilityChange)

  resize()
  render()

  return {
    setColorScheme(scheme) {
      preset = FLOW_PRESETS[scheme]
      draw()
    },
    setReducedMotion(value) {
      reduced = value
      if (value) {
        cancelAnimationFrame(frame)
        frame = 0
        draw()
        return
      }
      if (frame === 0 && !document.hidden) render()
    },
    dispose() {
      cancelAnimationFrame(frame)
      frame = 0
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
