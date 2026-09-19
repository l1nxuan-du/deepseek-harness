/** Interface-skin settings contract: schema defaults and the variant guard. */
import { describe, expect, it } from 'vitest'
import {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, SKIN_SETTINGS_NAMESPACE, SKIN_VARIANT_FIELD, SKIN_VARIANTS,
  SkinSettingsSchema, isSkinVariant,
} from '../src/skin-settings.ts'

describe('interface-skin settings', () => {
  it('defaults to the material chrome', () => {
    expect(SKIN_SETTINGS_NAMESPACE).toBe('ui-skin')
    expect(SKIN_VARIANT_FIELD).toBe('variant')
    expect(DEFAULT_SKIN_VARIANT).toBe('material')
    expect(CLASSIC_SKIN_VARIANT).toBe('classic')
    expect(SKIN_VARIANTS).toEqual(['classic', 'material'])
    expect(SkinSettingsSchema({} as never)).toEqual({ variant: 'material' })
  })

  it('accepts a declared skin and rejects everything else', () => {
    expect(SkinSettingsSchema({ variant: 'classic' })).toEqual({ variant: 'classic' })
    expect(SkinSettingsSchema({ variant: 'material' })).toEqual({ variant: 'material' })
    expect(() => SkinSettingsSchema({ variant: 'glass' } as never)).toThrow()
    expect(isSkinVariant('material')).toBe(true)
    expect(isSkinVariant('classic')).toBe(true)
    expect(isSkinVariant('glass')).toBe(false)
    expect(isSkinVariant(undefined)).toBe(false)
  })
})
