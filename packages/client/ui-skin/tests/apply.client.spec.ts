// @vitest-environment jsdom
/** Interface-skin apply wiring: stylesheet, dictionaries, row registration,
 * scope adoption, and the document projection the row drives. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkinRow, type SkinRowInjected } from '../src/client/SkinRow.tsx'
import { StrengthRow, type StrengthRowInjected } from '../src/client/StrengthRow.tsx'
import { createSkinRowStore, createStrengthRowStore } from '../src/client/settings-store.ts'
import { apply, inject, SETTINGS_NS } from '../src/client/index.ts'
import { FIELD_ATTRIBUTE } from '../src/client/field-backdrop.ts'
import { SKIN_ATTRIBUTE, SKIN_SETTINGS_NAMESPACE, SkinSettingsSchema } from '../src/skin-settings.ts'

const SLOT = 'settings.general.item'
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-skin'

afterEach(() => {
  document.documentElement.removeAttribute(SKIN_ATTRIBUTE)
  document.querySelectorAll(`[${FIELD_ATTRIBUTE}]`).forEach((node) => { node.remove() })
  document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`).forEach((node) => { node.remove() })
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const section: Record<string, unknown> = { variant: 'material', strength: 80 }
  const namespace = () => ({
    ns: SKIN_SETTINGS_NAMESPACE,
    schema: SkinSettingsSchema.toJSON(),
    value: { ...section },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn((_ns: string, ops: { path: string[]; value: unknown }[]) => {
    const op = ops[0]!
    section[op.path[0]!] = op.value
    return Promise.resolve({ ok: true as const, value: namespace() })
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  events.$host = { home: undefined, isLoopback: true }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const overrideTokens = vi.fn((_source: string, _tokens: ThemeTokenOverrides) => () => {})
  ctx.provide('theme', {
    overrideTokens,
    getTheme: () => ({
      preference: 'light', fontSize: 14, themes: [], revision: 0,
      active: { id: 'light', colorScheme: 'light', tokens: {} },
    }),
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, mutate, overrideTokens }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === SkinRow)!
  const handle = entry.store as ReturnType<typeof createSkinRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => SkinRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-skin apply', () => {
  it('declares the services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme', 'remote', 'settingsScope'])
  })

  it('installs the scoped sheet, registers copy, and registers the row after the slot arrives', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(1)
    expect(b.locale.bind(SETTINGS_NS)('interface.title')).toBe('界面')
    b.locale.setLocale('en')
    expect(b.locale.bind(SETTINGS_NS)('interface.title')).toBe('Interface')

    expect(b.slots.entries(SLOT)).toHaveLength(0)
    declareItems(b.slots)
    await Promise.resolve()
    const { entry } = faceOf(b.slots)
    expect(entry.options).toMatchObject({ id: 'interface', order: 12 })
    expect(entry.locale).toBe(SETTINGS_NS)
    const strengthEntry = b.slots.entries(SLOT).find(e => e.component === StrengthRow)!
    expect(strengthEntry.options).toMatchObject({ id: 'interface-strength', order: 13 })
    expect(strengthEntry.locale).toBe(SETTINGS_NS)
    await fiber.dispose()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(0)
  })

  it('adopts the durable variant into the row store and routes face writes back', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot()).toEqual({ variant: 'material', revision: 0 })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).not.toBeNull()
    expect(b.overrideTokens).toHaveBeenCalledWith('ui-skin', expect.any(Object))

    face.setSkin('classic')
    await Promise.resolve()
    expect(b.mutate).toHaveBeenCalled()
    expect(instance.getSnapshot()).toMatchObject({ variant: 'classic' })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('classic')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()

    face.setSkin('material')
    await Promise.resolve()
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).not.toBeNull()
  })

  it('routes the strength row write back through the runtime', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(SLOT).find(e => e.component === StrengthRow)!
    const handle = entry.store as ReturnType<typeof createStrengthRowStore>
    const instance = handle.create()
    const face = (entry.inject as unknown as (a: typeof instance.actions) => StrengthRowInjected)(instance.actions)
    expect(instance.getSnapshot()).toEqual({ strength: 80, revision: 0 })
    face.setStrength(30)
    await Promise.resolve()
    expect(b.mutate).toHaveBeenCalled()
    expect(instance.getSnapshot()).toMatchObject({ strength: 30 })
    expect(document.documentElement.style.getPropertyValue('--dsh-skin-strength')).toBe('30')
  })
})
