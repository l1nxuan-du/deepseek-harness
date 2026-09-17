import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/anchored-standard', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const PROMPT = "Use the bash tool to run exactly: printf 'ANCHORED_STANDARD_BASH_CARD_OK\\n'. Then reply exactly ANCHORED_STANDARD_REQUEST_OK and stop."

/** Rendered text of the system prompt surface node, or undefined when the surface carries none. */
function systemPromptText(session: Session): string | undefined {
  const message = session.deriveMessages().find(candidate => candidate.role === 'system')
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe.skipIf(process.platform === 'win32')('anchored-standard agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let disposeInjectedPrompt: () => void
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole> | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: true, paceMs: 10 })
    disposeInjectedPrompt = scaffold.ctx.systemPrompt.section({
      name: 'test:injected-prompt',
      order: 999,
      text: 'THIS TEXT MUST NOT REACH THE MODEL.',
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('anchored-standard-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'anchored-standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'anchored-standard').then(() => undefined),
    })
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    try {
      disposeInjectedPrompt?.()
    } catch (error: unknown) {
      failures.push(error)
    }
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'anchored-standard preset smoke teardown failed')
  })

  it('sends the exact RL prompt and shell schema, then executes the persistent shell', async () => {
    const requestHeader = agentHandle.agent.session.snapshotEvents().find(
      (event): event is SessionEvent<'request/header'> => event.type === 'request/header'
        && event.data.reason === 'initial',
    )?.data.header
    if (requestHeader === undefined) throw new Error('the anchored-standard agent issued no initial model request')
    const systemPrompt = systemPromptText(agentHandle.agent.session)
    if (systemPrompt === undefined) throw new Error('the anchored-standard agent issued no system prompt')
    expect(agentHandle.agent.session.snapshotEvents().some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
    const stateDir = join(scaffold.workspaceCwd, 'persistent-state')
    await mkdir(stateDir)
    const signal = new AbortController().signal
    await scaffold.ctx.tools.execute({
      signal,
      callId: ToolCallId('anchored-standard-bash-state-setup'),
      name: 'bash',
      arguments: { command: `cd ${JSON.stringify(stateDir)} && export DSH_ANCHORED_STANDARD_STATE=PERSISTED` },
      agent: agentHandle.agent,
    })
    const bash = await scaffold.ctx.tools.execute({
      signal,
      callId: ToolCallId('anchored-standard-bash-state-read'),
      name: 'bash',
      arguments: { command: 'printf \'%s:%s\n\' "$DSH_ANCHORED_STANDARD_STATE" "$PWD"' },
      agent: agentHandle.agent,
    })
    const text = (result: typeof bash): string => result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .replaceAll(scaffold.workspaceCwd, '{{cwd}}')
      .trimEnd()

    expect({
      prompt: systemPrompt,
      tools: requestHeader.tools?.map(tool => tool.name),
      bash: text(bash),
    }).toMatchInlineSnapshot(`
      {
        "bash": "PERSISTED:{{cwd}}/persistent-state
      [Command finished with exit code 0]",
        "prompt": "You are a helpful software engineer assistant.",
        "tools": [
          "bash",
          "str_replace_editor",
        ],
      }
    `)
  })

  it.skipIf(MODE === 'record')('expands the completed persistent Bash call in the Web conversation', async () => {
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'web-anchored-standard-persistent-bash-card') })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText('ANCHORED_STANDARD_REQUEST_OK', { exact: true }).waitFor({ timeout: 15_000 })

    const process = page.locator('[data-turn-process]')
    await process.waitFor({ timeout: 15_000 })
    await expect.poll(() => process.getAttribute('aria-expanded')).toBe('false')
    await process.click()
    await expect.poll(() => process.getAttribute('aria-expanded')).toBe('true')

    const row = page.locator('[data-sample="bash"]').first()
    await row.waitFor({ timeout: 15_000 })
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
    await row.click()

    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
    const call = row.locator('xpath=..')
    await call.getByText('IN', { exact: true }).waitFor()
    await call.getByText('OUT', { exact: true }).waitFor()
    await call.getByText('ANCHORED_STANDARD_BASH_CARD_OK\n[Command finished with exit code 0]', { exact: true }).waitFor()
    await call.getByText(/"command": "printf 'ANCHORED_STANDARD_BASH_CARD_OK/).waitFor()

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v3.jsonl',
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
      'ui.expected.md',
    ])
  })
})
