import type { Context } from '@deepseek-ai/cordis'
import material from '../styles/material.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-skin'

const STYLES = [
  ['material.css', material],
] as const

/**
 * Mount the interface-skin stylesheet for exactly the owning plugin lifetime.
 * Every rule selects on the root attribute, so an install leaves the classic
 * chrome untouched.
 * @param ctx - owning plugin context.
 */
export function installSkinStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-skin: ${name} stylesheet`)
  }
}
