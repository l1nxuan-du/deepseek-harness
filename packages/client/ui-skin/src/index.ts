/** Host registration for the browser interface-skin preference and pre-plugin attribute. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { bootSkinInjections } from './boot-skin.ts'
import {
  SKIN_VARIANT_FIELD, STRENGTH_FIELD, SkinSettingsFields,
  type SkinVariant,
} from './skin-settings.ts'

export {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, SKIN_ATTRIBUTE, SKIN_SETTINGS_NAMESPACE,
  SKIN_VARIANT_FIELD, SKIN_VARIANTS, STRENGTH_FIELD, STRENGTH_MAX, STRENGTH_MIN, STRENGTH_STEP,
  SkinSettingsSchema, isSkinVariant,
  type SkinSettings, type SkinVariant,
} from './skin-settings.ts'

/** Runtime skin preferences projected to the browser. */
export interface Config {
  /** Selected interface skin. */
  variant: Volatile<SkinVariant>
  /** Material strength in percent within {@link STRENGTH_MIN}..{@link STRENGTH_MAX}. */
  strength: Volatile<number>
}

/** Live interface-skin preferences. */
export const Config = z.object({
  [SKIN_VARIANT_FIELD]: SkinSettingsFields[SKIN_VARIANT_FIELD].volatile(),
  [STRENGTH_FIELD]: SkinSettingsFields[STRENGTH_FIELD].volatile(),
})

/**
 * Supply the selected skin before browser plugins start, and expose the
 * preference as a configuration form the General section's Interface rows own.
 * @param ctx - Host plugin context.
 * @param config - validated live skin preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootSkinInjections(config.variant.get()))
  })
}
