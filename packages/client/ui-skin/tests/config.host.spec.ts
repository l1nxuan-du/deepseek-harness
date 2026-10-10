import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, Config, apply,
} from '@deepseek-ai/dsh-client-ui-skin'

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** Narrow a skin style or script row and return its text. */
function rowText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script' && row?.kind !== 'style') throw new Error('expected a style or script row')
  return row.text
}

describe('interface-skin host', () => {
  it('registers, validates, and disposes the live skin configuration with its fiber', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(DEFAULT_SKIN_VARIANT).toBe('material')
    expect(plainConfig(configuration.fiber.config)).toEqual({ variant: DEFAULT_SKIN_VARIANT, strength: DEFAULT_STRENGTH })
    await configuration.update({ variant: 'classic', strength: 40 })
    expect(plainConfig(configuration.fiber.config)).toEqual({ variant: 'classic', strength: 40 })
    await expect(configuration.update({ variant: 'glass' })).rejects.toThrow()
    await expect(configuration.update({ strength: 101 })).rejects.toThrow()
    await fiber.dispose()
  })

  it('answers each collection with the current variant until disposal', async () => {
    const ctx = new Context()
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: 'window.afterSkin=true' })
    })
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    // A foreign listener registered first keeps its row; the skin rows ride beside it.
    expect(collect(ctx)).toHaveLength(3)
    expect(collect(ctx).filter(row => row.kind === 'style')).toHaveLength(1)
    await configuration.update({ variant: 'classic' })
    const rows = collect(ctx)
    expect(rows).toHaveLength(2)
    expect(rows.filter(row => row.kind === 'style')).toHaveLength(0)
    const skinRows = rows.filter(row => row.kind === 'script' && row.placement === 'body')
    expect(skinRows).toHaveLength(1)
    expect(rowText(skinRows[0])).toContain('"classic"')
    await fiber.dispose()
    expect(collect(ctx)).toEqual([{ kind: 'script', placement: 'head', text: 'window.afterSkin=true' }])
  })

  it('uses the material default without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ Config, apply }).await()
    expect(collect(ctx)).toMatchObject([{ kind: 'style' }, { kind: 'script', placement: 'body' }])
    expect(rowText(collect(ctx)[1])).toContain('"material"')
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
