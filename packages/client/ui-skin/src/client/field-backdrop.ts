/**
 * Field backdrop presenter: the material chrome sits on a fixed gradient field
 * — a wash, the WebGL flow pattern, and a pointer-following glow. Plain DOM
 * writes: the backdrop carries no product state, only the pointer position it
 * renders and the pattern's own animation loop.
 */
import { createFieldPattern, type FieldColorScheme, type FieldPattern } from './field-pattern.ts'

/** Marks the backdrop element the material stylesheet presents. */
export const FIELD_ATTRIBUTE = 'data-dsh-field'

/** Marks one painted layer of the field. */
export const FIELD_LAYER_ATTRIBUTE = 'data-dsh-field-layer'

/** Custom property carrying the pointer x position, in px. */
export const FIELD_X_VARIABLE = '--dsh-field-x'

/** Custom property carrying the pointer y position, in px. */
export const FIELD_Y_VARIABLE = '--dsh-field-y'

/** Attribute present while the pointer is over the document. */
export const FIELD_POINTER_ATTRIBUTE = 'data-dsh-field-pointer'

/** One mounted backdrop and its release. */
export interface FieldBackdrop {
  /** The backdrop root, prepended to the document body. */
  readonly element: HTMLElement
  /** Switch the pattern's colour preset. */
  setColorScheme(scheme: FieldColorScheme): void
  /** Remove the element, the pattern, and every listener this factory installed. */
  dispose(): void
}

/**
 * Mount the backdrop as the body's first child so it paints under the frame.
 * Pointer positions coalesce into one animation frame; the glow itself is CSS.
 * A browser without WebGL2 keeps the wash and simply draws no pattern.
 * @param scheme - colour preset the pattern opens on.
 * @returns the mounted backdrop.
 */
export function createFieldBackdrop(scheme: FieldColorScheme): FieldBackdrop {
  const element = document.createElement('div')
  element.setAttribute(FIELD_ATTRIBUTE, '')
  element.setAttribute('aria-hidden', 'true')
  const wash = document.createElement('div')
  wash.setAttribute(FIELD_LAYER_ATTRIBUTE, 'wash')
  const pattern = document.createElement('canvas')
  pattern.setAttribute(FIELD_LAYER_ATTRIBUTE, 'pattern')
  element.append(wash, pattern)
  document.body.prepend(element)

  let flow: FieldPattern | null = createFieldPattern(pattern)
  flow?.setColorScheme(scheme)
  if (flow === null) pattern.hidden = true

  const reducedQuery = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-reduced-motion: reduce)')
  const onReducedMotion = (): void => { flow?.setReducedMotion(reducedQuery?.matches === true) }
  reducedQuery?.addEventListener('change', onReducedMotion)

  let frame: number | null = null
  let x = 0
  let y = 0
  const paint = (): void => {
    frame = null
    element.style.setProperty(FIELD_X_VARIABLE, `${x}px`)
    element.style.setProperty(FIELD_Y_VARIABLE, `${y}px`)
  }
  const onMove = (event: PointerEvent): void => {
    x = event.clientX
    y = event.clientY
    element.setAttribute(FIELD_POINTER_ATTRIBUTE, '')
    frame ??= requestAnimationFrame(paint)
  }
  const onLeave = (): void => { element.removeAttribute(FIELD_POINTER_ATTRIBUTE) }

  window.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerleave', onLeave)
  return {
    element,
    setColorScheme(next) {
      flow?.setColorScheme(next)
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      reducedQuery?.removeEventListener('change', onReducedMotion)
      flow?.dispose()
      flow = null
      element.remove()
    },
  }
}
