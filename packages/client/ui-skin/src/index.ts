/** Host registration for the browser interface-skin preference. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { bootSkinInjections } from './boot-skin.ts'
import {
  DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, SKIN_SETTINGS_NAMESPACE, SkinSettingsSchema, type SkinSettings,
} from './skin-settings.ts'

export {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, SKIN_ATTRIBUTE, SKIN_SETTINGS_NAMESPACE,
  SKIN_VARIANT_FIELD, SKIN_VARIANTS, STRENGTH_FIELD, STRENGTH_MAX, STRENGTH_MIN,
  SkinSettingsSchema, isSkinVariant,
  type SkinSettings, type SkinVariant,
} from './skin-settings.ts'

/** Read the registered skin section, or the schema default without a settings provider. */
function readSection(ctx: Context): SkinSettings {
  const fallback: SkinSettings = { variant: DEFAULT_SKIN_VARIANT, strength: DEFAULT_STRENGTH }
  const settings = ctx.get('settings')
  if (settings === undefined) return fallback
  return (settings.get(SKIN_SETTINGS_NAMESPACE) as SkinSettings | undefined) ?? fallback
}

/**
 * Register the durable skin section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * variant so the served page selects the chrome before the shell mounts.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(SKIN_SETTINGS_NAMESPACE, SkinSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootSkinInjections(readSection(ctx).variant))
  })
}
