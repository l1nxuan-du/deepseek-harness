/**
 * Interface-skin bootstrap row for the browser's pre-plugin interval. The
 * index response carries the durable variant, and the body script installs the
 * root attribute the material stylesheet selects on before the shell mounts.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_SKIN_VARIANT, SKIN_ATTRIBUTE, type SkinVariant } from './skin-settings.ts'

const MATERIAL_CANVAS = '#f9f8f8'

/**
 * Canvas color painted before the material stylesheet arrives, so the first
 * paint does not flash the classic white page behind the field.
 */
function bootSkinStyle(variant: SkinVariant): string {
  if (variant !== 'material') return ''
  return `body{background-color:${MATERIAL_CANVAS}}`
}

/**
 * Build the body script that publishes the selected skin as a root attribute.
 * The attribute always states the selection — the material rules select on its
 * value, and the browser runtime adopts it as its own starting point, so the
 * chrome the page painted and the chrome the runtime projects agree.
 * @param variant - current Host-backed skin.
 * @returns the script body.
 */
function bootSkinBodyScript(variant: SkinVariant): string {
  return `document.documentElement.setAttribute(${JSON.stringify(SKIN_ATTRIBUTE)}, ${JSON.stringify(variant)})`
}

/**
 * Interface-skin bootstrap rows: head CSS for the material canvas, then the
 * body script that publishes the selection before the application module runs.
 * @param variant - current Host-backed skin.
 * @returns head and body rows in execution order.
 */
export function bootSkinInjections(variant: SkinVariant = DEFAULT_SKIN_VARIANT): IndexInjection[] {
  const style = bootSkinStyle(variant)
  return [
    ...style === '' ? [] : [{ kind: 'style', text: style } as const],
    { kind: 'script', placement: 'body', text: bootSkinBodyScript(variant) },
  ]
}
