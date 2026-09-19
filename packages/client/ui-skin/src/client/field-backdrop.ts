/**
 * Field backdrop presenter: the material chrome sits on a fixed gradient field
 * with a soft grid and a pointer-following glow. Plain DOM writes — the
 * backdrop carries no product state, only the pointer position it renders.
 */

/** Marks the backdrop element the material stylesheet presents. */
export const FIELD_ATTRIBUTE = 'data-dsh-field'

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
  /** Remove the element and every listener this factory installed. */
  dispose(): void
}

/**
 * Mount the backdrop as the body's first child so it paints under the frame.
 * Pointer positions coalesce into one animation frame; the glow itself is CSS.
 * @returns the mounted backdrop.
 */
export function createFieldBackdrop(): FieldBackdrop {
  const element = document.createElement('div')
  element.setAttribute(FIELD_ATTRIBUTE, '')
  element.setAttribute('aria-hidden', 'true')
  const wash = document.createElement('div')
  wash.setAttribute('data-dsh-field-layer', 'wash')
  const grid = document.createElement('div')
  grid.setAttribute('data-dsh-field-layer', 'grid')
  element.append(wash, grid)
  document.body.prepend(element)

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
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      element.remove()
    },
  }
}
