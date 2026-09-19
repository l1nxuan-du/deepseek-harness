// @vitest-environment jsdom
/** Skin runtime: scope adoption, document projection, and retraction. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKIN_ATTRIBUTE, type SkinSettings } from '../src/skin-settings.ts'
import { FIELD_ATTRIBUTE } from '../src/client/field-backdrop.ts'
import { SkinRuntime } from '../src/client/skin-runtime.ts'

function bench(initial?: SkinSettings) {
  let section = initial
  const listeners = new Set<() => void>()
  const set = vi.fn(async (_field: string, value: unknown) => {
    section = { variant: value as SkinSettings['variant'] }
    for (const listener of [...listeners]) listener()
  })
  const host = {
    getSnapshot: (): SettingsScopeSnapshot<SkinSettings> => ({
      status: 'ready', value: section, base: section, user: {}, revision: 0, writable: true, mode: 'host',
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
  } as unknown as SettingsScope<SkinSettings>
  const disposeTokens = vi.fn()
  const overrideTokens = vi.fn(() => disposeTokens)
  const disposers: (() => void)[] = []
  const themeListeners = new Set<(snapshot: unknown) => void>()
  const ctx = {
    effect: (run: () => (() => void) | undefined) => {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => { disposer?.() }
    },
    on: (_event: string, listener: (snapshot: unknown) => void) => {
      themeListeners.add(listener)
      return () => { themeListeners.delete(listener) }
    },
    theme: {
      overrideTokens,
      getTheme: () => ({ active: { id: 'light', colorScheme: 'light', tokens: {} }, preference: 'light', fontSize: 14, themes: [], revision: 0 }),
    },
  } as unknown as ClientContext
  return { ctx, host, set, overrideTokens, disposeTokens, listeners, disposers, themeListeners }
}

afterEach(() => {
  document.documentElement.removeAttribute(SKIN_ATTRIBUTE)
  document.querySelectorAll(`[${FIELD_ATTRIBUTE}]`).forEach((node) => { node.remove() })
  vi.restoreAllMocks()
})

describe('skin runtime', () => {
  it('opens on the material default, projecting the attribute, the token layer, and the field', () => {
    const b = bench()
    const onChange = vi.fn()
    const runtime = new SkinRuntime(b.ctx, b.host, onChange)
    expect(runtime.getSkin()).toEqual({ variant: 'material', revision: 0 })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).not.toBeNull()
    expect(b.overrideTokens).toHaveBeenCalledWith('ui-skin', expect.any(Object))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts from the selection the Host published on the root element', () => {
    document.documentElement.setAttribute(SKIN_ATTRIBUTE, 'classic')
    const classic = bench()
    const runtime = new SkinRuntime(classic.ctx, classic.host)
    expect(runtime.getSkin()).toEqual({ variant: 'classic', revision: 0 })
    expect(classic.overrideTokens).not.toHaveBeenCalled()
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()

    // An unrecognized published value falls back to the product default.
    document.documentElement.setAttribute(SKIN_ATTRIBUTE, 'glass')
    const unknown = bench()
    const fallback = new SkinRuntime(unknown.ctx, unknown.host)
    expect(fallback.getSkin()).toEqual({ variant: 'material', revision: 0 })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
  })

  it('adopts the durable classic variant on construction and retracts the material layer', () => {
    const b = bench({ variant: 'classic' })
    const onChange = vi.fn()
    const runtime = new SkinRuntime(b.ctx, b.host, onChange)
    expect(runtime.getSkin()).toEqual({ variant: 'classic', revision: 1 })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('classic')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()
    // The runtime projects the default before the durable value lands, then
    // retracts the material layer it installed.
    expect(b.overrideTokens).toHaveBeenCalledTimes(1)
    expect(b.disposeTokens).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ variant: 'classic', revision: 1 })
  })

  it('writes an accepted switch once and reuses the live material layers', () => {
    const b = bench()
    const runtime = new SkinRuntime(b.ctx, b.host)
    runtime.setSkin('material')
    expect(b.set).not.toHaveBeenCalled()
    expect(b.overrideTokens).toHaveBeenCalledTimes(1)
    runtime.setSkin('classic')
    expect(b.set).toHaveBeenCalledWith('variant', 'classic')
    expect(runtime.getSkin()).toEqual({ variant: 'classic', revision: 1 })
    expect(b.disposeTokens).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('classic')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()

    runtime.setSkin('material')
    expect(b.overrideTokens).toHaveBeenCalledTimes(2)
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('material')
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).not.toBeNull()
  })

  it('refuses a variant the product does not offer', () => {
    const b = bench()
    const runtime = new SkinRuntime(b.ctx, b.host)
    expect(() => { runtime.setSkin('glass' as never) }).toThrow('skin "glass" is not selectable')
    expect(() => { runtime.setSkin(undefined as never) }).toThrow('skin "undefined" is not selectable')
  })

  it('follows the accepted durable value and ignores the snapshot it already holds', () => {
    const b = bench()
    const onChange = vi.fn()
    const runtime = new SkinRuntime(b.ctx, b.host, onChange)
    for (const listener of [...b.listeners]) listener()
    expect(onChange).not.toHaveBeenCalled()
    b.host.getSnapshot = () => ({
      status: 'ready', value: { variant: 'classic' }, base: undefined, user: {}, revision: 1, writable: true, mode: 'host',
    })
    for (const listener of [...b.listeners]) listener()
    expect(runtime.getSkin()).toEqual({ variant: 'classic', revision: 1 })
    expect(document.documentElement.getAttribute(SKIN_ATTRIBUTE)).toBe('classic')
  })

  it('follows the theme service into the field pattern', () => {
    const b = bench()
    const runtime = new SkinRuntime(b.ctx, b.host)
    expect(b.themeListeners.size).toBe(1)
    for (const listener of [...b.themeListeners]) {
      listener({ active: { colorScheme: 'dark' } })
    }
    expect(b.themeListeners.size).toBe(1)
    runtime.setSkin('classic')
    for (const listener of [...b.themeListeners]) listener({ active: { colorScheme: 'light' } })
    runtime.dispose()
  })

  it('retracts the token layer, the field, and the scope listener on dispose', () => {
    const b = bench()
    const runtime = new SkinRuntime(b.ctx, b.host)
    runtime.dispose()
    expect(b.disposeTokens).toHaveBeenCalledTimes(1)
    expect(document.querySelector(`[${FIELD_ATTRIBUTE}]`)).toBeNull()
    runtime.dispose()
    expect(b.disposeTokens).toHaveBeenCalledTimes(1)
    expect([...b.listeners]).toHaveLength(1)
    for (const dispose of b.disposers) dispose()
    expect([...b.listeners]).toHaveLength(0)
  })
})
