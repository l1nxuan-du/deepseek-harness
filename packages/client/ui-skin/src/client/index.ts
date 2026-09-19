/**
 * Interface skin plugin: the product's chrome selection. The plugin owns the
 * durable `ui-skin` section, publishes immutable snapshots to the General
 * section's Interface row, and projects the selection onto the document — the
 * root attribute the material stylesheet selects on, the material alias-token
 * layer, and the field backdrop. The material chrome is the default; the
 * classic variant retracts all three, so a user who selects it gets the
 * shipped chrome.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through services, never a value import (client bundle purity gate).
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SkinSettings, SkinVariant } from '../skin-settings.ts'
import type { SkinKey } from './locales.ts'
import { SkinRow, type SkinRowInjected } from './SkinRow.tsx'
import { en, zh } from './locales.ts'
import { createSkinRowStore } from './settings-store.ts'
import { SkinRuntime, type SkinSnapshot } from './skin-runtime.ts'
import { installSkinStyles } from './styles.ts'
import { SKIN_SETTINGS_NAMESPACE } from '../skin-settings.ts'

export type { SkinRowComponentProps, SkinRowInjected } from './SkinRow.tsx'
export type { SkinRowState } from './settings-store.ts'
export type { SkinSnapshot } from './skin-runtime.ts'
export type { FieldBackdrop } from './field-backdrop.ts'
export type { SkinKey } from './locales.ts'
export {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, SKIN_ATTRIBUTE, SKIN_SETTINGS_NAMESPACE, SKIN_VARIANT_FIELD, SKIN_VARIANTS,
  isSkinVariant,
  type SkinSettings, type SkinVariant,
} from '../skin-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.skin'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Interface settings row's copy. */
    'settings.skin': SkinKey
  }
}

/**
 * Required services: slots and locale for the Interface row, theme for the
 * material token layer, and the settings transport that carries the variant.
 */
export const inject = ['slots', 'locale', 'theme', 'remote', 'settingsScope']

/**
 * Client plugin body: install the scoped stylesheet, bind the durable variant
 * scope, project the selection onto the document, and register the Interface
 * row into the General section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installSkinStyles(ctx)
  const host: SettingsScope<SkinSettings> = ctx.settingsScope.bind<SkinSettings>({
    namespace: SKIN_SETTINGS_NAMESPACE,
  })

  const store = createSkinRowStore()
  let bound: BoundActions<typeof store> | undefined
  const skin = new SkinRuntime(ctx, host, (snapshot: SkinSnapshot) => {
    bound?.sync(snapshot.variant, snapshot.revision)
  })
  ctx.effect(() => () => { skin.dispose() }, 'ui-skin: document projection')

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-skin: settings row dictionaries')

  const injected = (actions: BoundActions<typeof store>): SkinRowInjected => {
    bound = actions
    // Re-sync from the getter so no change is lost between construction and
    // the first render (the store's revision guard drops stale duplicates).
    const snapshot = skin.getSkin()
    actions.sync(snapshot.variant, snapshot.revision)
    return {
      setSkin: (variant: SkinVariant) => { skin.setSkin(variant) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'interface',
    order: 12,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, SkinRow))
}
