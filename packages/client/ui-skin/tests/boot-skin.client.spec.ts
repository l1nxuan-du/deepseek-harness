// @vitest-environment jsdom
/** The interface-skin bootstrap row and the root attribute it installs. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { bootSkinInjections } from '../src/boot-skin.ts'
import { DEFAULT_SKIN_VARIANT, SKIN_ATTRIBUTE, type SkinVariant } from '../src/skin-settings.ts'

function bodyScript(variant?: SkinVariant): string {
  const rows = bootSkinInjections(variant)
  const row = rows.at(-1)
  if (row?.kind !== 'script') throw new Error('bootstrap row is not a script')
  return row.text
}

afterEach(() => { document.documentElement.removeAttribute(SKIN_ATTRIBUTE) })

describe('interface-skin bootstrap row', () => {
  it('paints the material canvas before the shell mounts', () => {
    const [style, script] = bootSkinInjections('material')
    expect(style).toMatchObject({ kind: 'style' })
    expect(style?.kind === 'style' && style.text).toContain('background-color:#f9f8f8')
    expect(script).toMatchObject({ kind: 'script', placement: 'body' })
  })

  it('selects the material chrome on the root element, including for the default', () => {
    expect(DEFAULT_SKIN_VARIANT).toBe('material')
    runInNewContext(bodyScript('material'), { document })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
    document.documentElement.removeAttribute(SKIN_ATTRIBUTE)
    runInNewContext(bodyScript(), { document })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
  })

  it('publishes no canvas paint and states the selection for the classic chrome', () => {
    expect(bootSkinInjections('classic')).toHaveLength(1)
    document.documentElement.setAttribute(SKIN_ATTRIBUTE, 'material')
    runInNewContext(bodyScript('classic'), { document })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('classic')
  })
})
