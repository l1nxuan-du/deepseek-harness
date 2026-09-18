/**
 * The shipped presets are this package's own, not an assembly fact each app
 * must patch in: a roster configured with nothing still supplies the built-in
 * compositions, prepended so they always mount and win a duplicate id.
 * `includeShippedRoot: false` is how a deployment supplying purely its own
 * presets — or an embedder using the roster as bare machinery — opts out.
 *
 * `$DSH_HOME` is repointed per test for the same reason as the user-root
 * suite: the derived writable root is resolved in the constructor.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, { SHIPPED_PRESET_ROOT, type Config } from '@deepseek-ai/dsh-agent-presets'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SYSTEM_ROOT = join(FIXTURES, 'system')

let home: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DSH_HOME
  home = await mkdtemp(join(tmpdir(), 'dsh-shipped-root-'))
  process.env.DSH_HOME = home
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
})

/** Boot a roster with the shipped root left to the plugin's default. */
async function roster(config: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [],
    includeShippedRoot: true,
    includeUserRoot: true,
    ...config,
  })
  return ctx
}

interface ShippedEntry {
  id?: unknown
  disabled?: unknown
  config?: unknown
}

/** Find one entry through the shipped composition's nested groups. */
function findEntry(entries: unknown[], id: string): ShippedEntry | undefined {
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as ShippedEntry
    if (candidate.id === id) return candidate
    if (Array.isArray(candidate.config)) {
      const nested = findEntry(candidate.config, id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Read and validate one shipped preset's Cordis entry list. */
async function shippedEntries(id: string): Promise<unknown[]> {
  const source = await readFile(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
  const entries: unknown = yaml.load(source, { schema: entryListSchema })
  if (!Array.isArray(entries)) throw new TypeError(`${id} preset must contain a Cordis entry list`)
  return entries.map((entry: unknown) => entry)
}

describe('the shipped preset root', () => {
  it('rewrites linx-mode prompt references to the installed preset directory', async () => {
    const entries = await shippedEntries('linx-mode')
    const persona = findEntry(entries, 'persona')
    const prefix = (persona?.config as { prefix?: unknown } | undefined)?.prefix
    if (typeof prefix !== 'object' || prefix === null || !('__jsExpr' in prefix)) {
      throw new TypeError('linx-mode persona prefix must be a !!js expression')
    }
    const presetDir = join(SHIPPED_PRESET_ROOT, 'linx-mode')
    const prompt = evaluate(
      { baseUrl: pathToFileURL(join(presetDir, 'agent.cordis.yml')).href },
      (prefix as { __jsExpr: string }).__jsExpr,
    ) as string
    const root = presetDir.replaceAll('\\', '/')
    expect(prompt).toContain('# Do')
    expect(prompt).toContain(`${root}/.agent/AGENTS.md`)
    expect(prompt).toContain(`${root}/docs/development.md`)
    expect(prompt).not.toContain('__DSH_LINX_ROOT__')

    const sourcePrompt = await readFile(join(presetDir, 'linx.md'), 'utf8')
    const references = [...sourcePrompt.matchAll(/__DSH_LINX_ROOT__\/([^`\s]+)/g)]
      .flatMap(match => match[1] === undefined ? [] : [match[1]])
    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      expect(existsSync(join(presetDir, ...reference.split('/'))), reference).toBe(true)
    }
    const bundledInstructions = await readFile(join(presetDir, '.agent', 'AGENTS.md'), 'utf8')
    expect(bundledInstructions).toContain('`../docs/AGENTS.md`')
    expect(bundledInstructions).not.toContain('linx-mode\\docs')
  })

  it('supplies the built-in presets from a bare roster, healthy and system-trusted', async () => {
    const ctx = await roster({ includeUserRoot: false })

    const listed = await ctx.agentPresets.list()
    expect(listed.map(preset => preset.id).sort())
      .toEqual(['anchored-standard', 'codex-v5', 'codex-v6', 'cordis', 'linx-mode', 'ptc', 's1mple-mode'])
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    // Not `broken === undefined`: health asks whether each row's package is
    // installed above the base, and the shipped rows name packages the
    // deployment installs beside the roster. This fixture base is not that
    // install, so unresolved rows are the only reason it can report here —
    // malformed would be a different one, and this asserts there is none.
    expect(listed.map(preset => preset.broken)
      .filter(reason => reason !== undefined && !reason.includes('cannot be resolved'))).toEqual([])
  })

  it('prepends the shipped root before configured roots and the derived user root', async () => {
    const ctx = await roster({ roots: [{ path: SYSTEM_ROOT, trust: 'user' }] })

    expect(ctx.agentPresets.roots.map(root => root.path)).toEqual([
      SHIPPED_PRESET_ROOT,
      SYSTEM_ROOT,
      expect.stringContaining('.agent-presets'),
    ])
    expect(ctx.agentPresets.roots[0]).toEqual({ path: SHIPPED_PRESET_ROOT, trust: 'system' })
    // Prepended, so a configured directory claiming a shipped id is shadowed.
    // (This root is written here rather than added to the shared fixture, whose
    // inventory other suites enumerate.)
    const shadowing = join(home, '.agent-presets', 'cordis')
    await mkdir(shadowing, { recursive: true })
    await writeFile(join(shadowing, 'agent.cordis.yml'), '- id: shadowed\n  name: fixtures/plugins/contribute.js\n')
    const cordis = (await roster({ roots: [{ path: SYSTEM_ROOT, trust: 'user' }] })).agentPresets
    const resolved = (await cordis.list()).find(preset => preset.id === 'cordis')
    expect(resolved?.path.startsWith(SHIPPED_PRESET_ROOT)).toBe(true)
  })

  it('mounts a roster without the shipped set when includeShippedRoot is false', async () => {
    const ctx = await roster({
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: SYSTEM_ROOT, trust: 'system' }],
    })

    expect(ctx.agentPresets.roots).toEqual([{ path: SYSTEM_ROOT, trust: 'system' }])
    const minimal = (await ctx.agentPresets.list()).find(preset => preset.id === 'minimal')
    expect(minimal?.path.startsWith(SYSTEM_ROOT)).toBe(true)
  })

  it('enables web_fetch in each tool-bearing Web app preset', async () => {
    for (const id of ['cordis', 'linx-mode', 'ptc', 's1mple-mode']) {
      const entries = await shippedEntries(id)
      const toolWeb: unknown = entries.find((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === 'tool-web')
      if (typeof toolWeb !== 'object' || toolWeb === null || !('config' in toolWeb)
        || typeof toolWeb.config !== 'object' || toolWeb.config === null || !('fetch' in toolWeb.config)) {
        throw new TypeError(`${id} preset must configure tool-web.fetch`)
      }
      expect(toolWeb.config.fetch, id).toBe(true)
    }
  })

  it('omits the general workflow tool and its unused engine only from PTC', async () => {
    const ptc = await shippedEntries('ptc')
    expect(findEntry(ptc, 'tool-workflow')?.disabled).toBe(true)
    expect(findEntry(ptc, 'workflow-ptc')?.disabled).toBe(true)

    for (const id of ['s1mple-mode', 'linx-mode', 'cordis']) {
      const entries = await shippedEntries(id)
      expect(findEntry(entries, 'tool-workflow')?.disabled, id).not.toBe(true)
      expect(findEntry(entries, 'workflow-ptc')?.disabled, id).not.toBe(true)
    }
  })

  it('disables the ralph tool in every shipped preset that carries it', async () => {
    for (const id of ['cordis', 'linx-mode', 'ptc', 's1mple-mode', 'anchored-standard', 'codex-v5', 'codex-v6']) {
      expect(findEntry(await shippedEntries(id), 'tool-ralph')?.disabled, id).toBe(true)
    }
  })
})
