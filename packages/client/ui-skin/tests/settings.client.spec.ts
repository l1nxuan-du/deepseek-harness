/** Interface-skin settings contract: schema defaults and the variant guard. */
import { describe, expect, it } from 'vitest'
import {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, SKIN_SETTINGS_NAMESPACE, SKIN_VARIANT_FIELD,
  SKIN_VARIANTS, STRENGTH_MAX, STRENGTH_MIN, STRENGTH_STEP, SkinSettingsSchema, isSkinVariant,
} from '../src/skin-settings.ts'

describe('interface-skin settings', () => {
  it('defaults to the material chrome', () => {
    expect(SKIN_SETTINGS_NAMESPACE).toBe('ui-skin')
    expect(SKIN_VARIANT_FIELD).toBe('variant')
    expect(DEFAULT_SKIN_VARIANT).toBe('material')
    expect(CLASSIC_SKIN_VARIANT).toBe('classic')
    expect(SKIN_VARIANTS).toEqual(['classic', 'material'])
    expect(DEFAULT_STRENGTH).toBe(60)
    expect(STRENGTH_STEP).toBe(10)
    expect(STRENGTH_MIN).toBe(0)
    expect(STRENGTH_MAX).toBe(100)
    expect(SkinSettingsSchema({} as never)).toEqual({ variant: 'material', strength: 60 })
  })

  it('accepts a declared skin and strength and rejects everything else', () => {
    expect(SkinSettingsSchema({ variant: 'classic' } as never)).toEqual({ variant: 'classic', strength: 60 })
    expect(SkinSettingsSchema({ variant: 'material', strength: 30 })).toEqual({ variant: 'material', strength: 30 })
    expect(() => SkinSettingsSchema({ variant: 'glass' } as never)).toThrow()
    expect(() => SkinSettingsSchema({ strength: 101 } as never)).toThrow()
    expect(() => SkinSettingsSchema({ strength: -1 } as never)).toThrow()
    expect(() => SkinSettingsSchema({ strength: 30.5 } as never)).toThrow()
    expect(isSkinVariant('material')).toBe(true)
    expect(isSkinVariant('classic')).toBe(true)
    expect(isSkinVariant('glass')).toBe(false)
    expect(isSkinVariant(undefined)).toBe(false)
  })
})
