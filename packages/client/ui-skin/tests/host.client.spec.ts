/** Host half: the durable interface-skin section and its index bootstrap rows. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_SKIN_VARIANT, SKIN_SETTINGS_NAMESPACE, apply } from '@deepseek-ai/dsh-client-ui-skin'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** The bootstrap body script row the plugin published for this collection. */
function skinScript(ctx: Context): IndexInjection | undefined {
  return collect(ctx).find(row => row.kind === 'script' && row.placement === 'body')
}

/** Narrow a bootstrap script row and return its text. */
function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('interface-skin host', () => {
  it('registers, validates, and disposes the durable skin namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(DEFAULT_SKIN_VARIANT).toBe('material')
    expect(ctx.settings.get(SKIN_SETTINGS_NAMESPACE)).toEqual({ variant: DEFAULT_SKIN_VARIANT, strength: 80 })
    await ctx.settings.update(SKIN_SETTINGS_NAMESPACE, { variant: 'classic', strength: 40 })
    expect(ctx.settings.get(SKIN_SETTINGS_NAMESPACE)).toEqual({ variant: 'classic', strength: 40 })
    await expect(ctx.settings.update(SKIN_SETTINGS_NAMESPACE, { variant: 'glass' })).rejects.toThrow()
    await expect(ctx.settings.update(SKIN_SETTINGS_NAMESPACE, { strength: 101 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(SKIN_SETTINGS_NAMESPACE)
  })

  it('answers each collection with the current durable variant until disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: 'window.afterSkin=true' })
    })
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    // A foreign listener registered first keeps its row; the skin row rides beside it.
    expect(collect(ctx)).toHaveLength(3)
    expect(collect(ctx).filter(row => row.kind === 'style')).toHaveLength(1)
    await ctx.settings.update(SKIN_SETTINGS_NAMESPACE, { variant: 'classic' })
    const rows = collect(ctx)
    expect(rows).toHaveLength(2)
    expect(rows.filter(row => row.kind === 'style')).toHaveLength(0)
    const skinRows = rows.filter(row => row.kind === 'script' && row.placement === 'body')
    expect(skinRows).toHaveLength(1)
    expect(scriptText(skinRows[0])).toContain('"classic"')
    await fiber.dispose()
    expect(collect(ctx)).toHaveLength(1)
  })

  it('falls back to the material default when the durable section is absent', async () => {
    const ctx = new Context()
    ctx.provide('settings', { register: () => {}, get: () => undefined } as never)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(scriptText(skinScript(ctx))).toContain('"material"')
    await fiber.dispose()
  })

  it('falls back to the material default without a settings provider', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(collect(ctx)).toMatchObject([{ kind: 'style' }, { kind: 'script', placement: 'body' }])
    expect(scriptText(skinScript(ctx))).toContain('"material"')
    await fiber.dispose()
  })
})
