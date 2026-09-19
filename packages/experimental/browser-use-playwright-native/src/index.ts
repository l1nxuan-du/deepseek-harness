/**
 * Provider-owned Playwright Chromium Browser Use tools.
 * The browser is isolated per live Session and controlled through Playwright's
 * Chromium CDP implementation; no sidebar or cross-origin iframe is involved.
 * @module @deepseek-ai/dsh-experimental-browser-use-playwright-native
 */

import type { Context } from '@deepseek-ai/cordis'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-browser-use'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { PlaywrightBrowserSession } from './runtime.ts'
import type { BrowserChannel, BrowserLaunchOptions } from './types.ts'

/** Cordis plugin identity. */
export const name = 'experimental-browser-use-playwright-native'

/** Services required by the Playwright provider. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

/** Plugin configuration. */
export interface Config {
  /** Hide the browser window. Defaults to true. */
  headless?: boolean
  /** Preferred Chromium channel. Omitted probes Chrome, Edge, then bundled Chromium. */
  channel?: BrowserChannel
  /** Explicit Chromium executable path. */
  executablePath?: string
  /** Per-operation timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number
  /** Initial viewport width. Defaults to 1280. */
  viewportWidth?: number
  /** Initial viewport height. Defaults to 720. */
  viewportHeight?: number
  /** Optional product user agent. */
  userAgent?: string
}

export const Config: Schema<Config> = Schema.object({
  headless: Schema.boolean().default(true),
  channel: Schema.union(['chrome', 'msedge', 'chromium'] as const),
  executablePath: Schema.string(),
  timeoutMs: Schema.number().min(1).default(30_000),
  viewportWidth: Schema.number().min(1).default(1_280),
  viewportHeight: Schema.number().min(1).default(720),
  userAgent: Schema.string(),
})

const GUIDANCE = 'Playwright browser tools operate a Chromium browser owned by this Session. Call browser_snapshot before interacting and use only element tokens from the latest snapshot. Tokens become stale after navigation, clicks, or another snapshot. Verify the result from fresh page state after each action. Browser input already delivered is not rolled back on cancellation.'

const TOOL_NAMES = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_select',
  'browser_press',
  'browser_scroll',
  'browser_screenshot',
  'browser_tabs',
] as const

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function definition(
  ctx: Context,
  resources: SessionResources<PlaywrightBrowserSession>,
  toolName: typeof TOOL_NAMES[number],
  description: string,
  inputSchema: Record<string, unknown>,
  call: (session: PlaywrightBrowserSession, args: Record<string, unknown>) => Promise<unknown>,
) {
  return createMcpToolDefinition(ctx, {
    name: toolName,
    rawName: toolName,
    description,
    inputSchema,
    async call(args, execution) {
      const agent = execution.agent
      if (agent === undefined) throw new Error(`${toolName} requires a live Session`)
      return resources.run(agent, execution.signal, (_session, signal) => {
        signal.throwIfAborted()
        return call(_session, args)
      })
    },
  })
}

/** Register the provider and its fixed browser action set. */
export function apply(ctx: Context, config: Config = {}): void {
  const options: BrowserLaunchOptions = {
    headless: config.headless ?? true,
    ...config.channel === undefined ? {} : { channel: config.channel },
    ...config.executablePath === undefined ? {} : { executablePath: config.executablePath },
    timeoutMs: config.timeoutMs ?? 30_000,
    viewportWidth: config.viewportWidth ?? 1_280,
    viewportHeight: config.viewportHeight ?? 720,
    ...config.userAgent === undefined ? {} : { userAgent: config.userAgent },
  }
  ctx.effect(function* () {
    yield ctx.browserUse.register(BrowserUseProviderName(name))
    const resources = new SessionResources<PlaywrightBrowserSession>(ctx, {
      label: name,
      exclusive: false,
      open: (_agent, signal) => PlaywrightBrowserSession.open(options, signal).then(session => ({
        value: session,
        close: () => session.close(),
      })),
    })
    const disposers = [
      definition(ctx, resources, 'browser_navigate', 'Navigate the Session-owned browser to an absolute HTTP(S) URL. Call browser_snapshot after navigation before interacting.', objectSchema({ url: { type: 'string' } }, ['url']), (session, args) => session.navigate(args['url'])),
      definition(ctx, resources, 'browser_snapshot', 'Read the current URL, title, page text, and indexed interactive elements. Use returned tokens with browser_click, browser_type, or browser_select. Tokens expire after navigation or another snapshot.', objectSchema({ maxElements: { type: 'integer', minimum: 1, maximum: 200 } }), (session, args) => session.snapshot(args['maxElements'])),
      definition(ctx, resources, 'browser_click', 'Click one element token returned by the latest browser_snapshot.', objectSchema({ token: { type: 'string' } }, ['token']), (session, args) => session.click(args['token'])),
      definition(ctx, resources, 'browser_type', 'Fill one input or contenteditable element token returned by the latest browser_snapshot.', objectSchema({ token: { type: 'string' }, text: { type: 'string' } }, ['token', 'text']), (session, args) => session.type(args['token'], args['text'])),
      definition(ctx, resources, 'browser_select', 'Select an option in one select element token returned by the latest browser_snapshot.', objectSchema({ token: { type: 'string' }, value: { type: 'string' } }, ['token', 'value']), (session, args) => session.select(args['token'], args['value'])),
      definition(ctx, resources, 'browser_press', 'Press a Playwright keyboard key on the active page, such as Enter, Tab, ArrowDown, or Control+L.', objectSchema({ key: { type: 'string' } }, ['key']), (session, args) => session.press(args['key'])),
      definition(ctx, resources, 'browser_scroll', 'Scroll the active page by CSS-pixel deltas. At least one delta must be nonzero.', objectSchema({ deltaX: { type: 'integer' }, deltaY: { type: 'integer' } }), (session, args) => session.scroll(args['deltaX'], args['deltaY'])),
      definition(ctx, resources, 'browser_screenshot', 'Capture a PNG screenshot of the active page. Set fullPage to capture the complete document.', objectSchema({ fullPage: { type: 'boolean' } }), (session, args) => session.screenshot(args['fullPage'])),
      definition(ctx, resources, 'browser_tabs', 'List, create, select, or close tabs in the Session-owned browser. Tab indices come from action=list.', objectSchema({
        action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        index: { type: 'integer', minimum: 0 },
        url: { type: 'string' },
      }, ['action']), (session, args) => session.tabs(args['action'], args['index'], args['url'])),
    ].map(tool => ctx.tools.register(tool))
    yield async () => {
      for (const dispose of disposers.reverse()) dispose()
      await resources.dispose()
    }
  }, `${name}.provider`)
  ctx.systemPrompt.section({
    name: 'browser-use:playwright',
    order: ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
    text: GUIDANCE,
  })
}

export { PlaywrightBrowserSession } from './runtime.ts'
export type { BrowserChannel, BrowserLaunchOptions, BrowserElement } from './types.ts'
