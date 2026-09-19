/** Interface-skin preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Selectable interface skins, in row order. */
export const SKIN_VARIANTS = ['classic', 'material'] as const

/**
 * Skin that renders the shipped chrome. The material root attribute is absent
 * for it, so every material rule stops selecting.
 */
export const CLASSIC_SKIN_VARIANT: SkinVariant = 'classic'

/** Settings namespace owned by the interface-skin plugin. */
export const SKIN_SETTINGS_NAMESPACE = 'ui-skin'

/** Field carrying the selected interface skin. */
export const SKIN_VARIANT_FIELD = 'variant'

/** Field carrying the material strength the sheet derives its surfaces from. */
export const STRENGTH_FIELD = 'strength'

/** Weakest accepted material strength (percent). */
export const STRENGTH_MIN = 0

/** Strongest accepted material strength (percent). */
export const STRENGTH_MAX = 100

/** Material strength when the user-settings document has no override. */
export const DEFAULT_STRENGTH = 80

/** Strength step the settings row writes. */
export const STRENGTH_STEP = 10

/** The skin selected by the product Interface row. */
export type SkinVariant = typeof SKIN_VARIANTS[number]

/**
 * Skin used when the user-settings document has no override. The material
 * chrome is the product default; the classic chrome remains selectable.
 */
export const DEFAULT_SKIN_VARIANT: SkinVariant = 'material'

/** Root attribute selecting the material chrome; absent means classic. */
export const SKIN_ATTRIBUTE = 'data-dsh-skin'

/** Durable skin section shared by the Host schema and the browser scope. */
export interface SkinSettings {
  /** Selected interface skin. */
  variant: SkinVariant
  /** Material strength in percent within {@link STRENGTH_MIN}..{@link STRENGTH_MAX}. */
  strength: number
}

/** Durable skin schema; also the wire envelope the browser scope validates against. */
export const SkinSettingsSchema: z<SkinSettings> = z.object({
  [SKIN_VARIANT_FIELD]: z.union([...SKIN_VARIANTS]).default(DEFAULT_SKIN_VARIANT),
  [STRENGTH_FIELD]: z.number().step(1).min(STRENGTH_MIN).max(STRENGTH_MAX).default(DEFAULT_STRENGTH),
})

/**
 * Narrow one wire, settings, or registry value to a selectable skin.
 * @param value - value crossing the settings or bootstrap boundary.
 * @returns whether the value names an interface skin.
 */
export function isSkinVariant(value: unknown): value is SkinVariant {
  return SKIN_VARIANTS.some(variant => variant === value)
}
