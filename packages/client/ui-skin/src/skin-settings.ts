/** Interface-skin preference projected from the Host configuration entry. */

import z from '@deepseek-ai/schemastery'

/** Selectable interface skins, in row order. */
export const SKIN_VARIANTS = ['classic', 'material'] as const

/**
 * Skin that renders the shipped chrome. The material root attribute is absent
 * for it, so every material rule stops selecting.
 */
export const CLASSIC_SKIN_VARIANT: SkinVariant = 'classic'

/** Configuration entry and namespace owned by the interface-skin plugin. */
export const SKIN_SETTINGS_NAMESPACE = 'ui-skin'

/** Field carrying the selected interface skin. */
export const SKIN_VARIANT_FIELD = 'variant'

/** Field carrying the material strength the sheet derives its surfaces from. */
export const STRENGTH_FIELD = 'strength'

/** Weakest accepted material strength (percent). */
export const STRENGTH_MIN = 0

/** Strongest accepted material strength (percent). */
export const STRENGTH_MAX = 100

/** Material strength when no override is stored (percent). */
export const DEFAULT_STRENGTH = 80

/** Strength step the settings row writes. */
export const STRENGTH_STEP = 10

/** The skin selected by the product Interface row. */
export type SkinVariant = typeof SKIN_VARIANTS[number]

/**
 * Skin used when no override is stored. The material chrome is the product
 * default; the classic chrome remains selectable.
 */
export const DEFAULT_SKIN_VARIANT: SkinVariant = 'material'

/** Root attribute selecting the material chrome; absent means classic. */
export const SKIN_ATTRIBUTE = 'data-dsh-skin'

/** Resolved skin section shared by the Host schema and the browser form. */
export interface SkinSettings {
  /** Selected interface skin. */
  variant: SkinVariant
  /** Material strength in percent within {@link STRENGTH_MIN}..{@link STRENGTH_MAX}. */
  strength: number
}

/** Field schema of the selected skin; the Host `Config` marks its copy volatile. */
export const SkinVariantField = z.union([...SKIN_VARIANTS]).default(DEFAULT_SKIN_VARIANT)

/** Field schema of the material strength; the Host `Config` marks its copy volatile. */
export const SkinStrengthField = z.number().step(1).min(STRENGTH_MIN).max(STRENGTH_MAX).default(DEFAULT_STRENGTH)

/** Durable skin schema; also the wire envelope the browser form validates against. */
export const SkinSettingsSchema: z<SkinSettings> = z.object({
  [SKIN_VARIANT_FIELD]: SkinVariantField,
  [STRENGTH_FIELD]: SkinStrengthField,
})

/**
 * Narrow one wire, configuration, or registry value to a selectable skin.
 * @param value - value crossing the configuration or bootstrap boundary.
 * @returns whether the value names an interface skin.
 */
export function isSkinVariant(value: unknown): value is SkinVariant {
  return SKIN_VARIANTS.some(variant => variant === value)
}
