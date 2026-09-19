import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { PlaywrightBrowserSession } from '../src/runtime.ts'
import * as Provider from '../src/index.ts'

function fakeSession() {
  return {
    navigate: vi.fn(async () => ({ content: [{ type: 'text', text: 'navigated' }] })),
    snapshot: vi.fn(async () => ({ content: [{ type: 'text', text: 'snapshotted' }] })),
    click: vi.fn(async () => ({ content: [{ type: 'text', text: 'clicked' }] })),
    type: vi.fn(async () => ({ content: [{ type: 'text', text: 'typed' }] })),
    select: vi.fn(async () => ({ content: [{ type: 'text', text: 'selected' }] })),
    press: vi.fn(async () => ({ content: [{ type: 'text', text: 'pressed' }] })),
    scroll: vi.fn(async () => ({ content: [{ type: 'text', text: 'scrolled' }] })),
    screenshot: vi.fn(async () => ({ content: [{ type: 'text', text: 'screenshot' }] })),
    tabs: vi.fn(async () => ({ content: [{ type: 'text', text: 'tabs' }] })),
    close: vi.fn(async () => {}),
  }
}

function harness() {
  const registrations: string[] = []
  const tools: ToolDefinition[] = []
  const section = vi.fn()
  const providerDispose = vi.fn(async () => {})
  const agentCtx = new Context()
  const agent = { id: 'agent-1', ctx: agentCtx } as unknown as ToolRunContext['agent']
  const agents = new Map([['agent-1', agent]])
  const ctx = new Context()
  ctx.provide('browserUse', {
    register: vi.fn((name: string) => {
      registrations.push(name)
      return providerDispose
    }),
  } as never)
  ctx.provide('tools', {
    register: vi.fn((tool: ToolDefinition) => {
      tools.push(tool)
      return () => {
        tools.splice(tools.indexOf(tool), 1)
      }
    }),
  } as never)
  ctx.provide('systemPrompt', {
    getSectionOrder: () => 0,
    section,
  } as never)
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  return { ctx, agent, registrations, tools, section, providerDispose }
}

function execute(
  h: ReturnType<typeof harness>,
  name: string,
  args: Record<string, unknown>,
  agent: ToolRunContext['agent'] | null = h.agent,
  signal = new AbortController().signal,
) {
  const tool = h.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return tool.execute(args, {
    ...agent === null ? {} : { agent },
    signal,
  } as unknown as ToolRunContext)
}

describe('experimental-browser-use-playwright-native provider', () => {
  it('registers one provider, fixed browser tools, and guidance', async () => {
    const h = harness()
    const fiber = h.ctx.plugin({ inject: Provider.inject, apply: Provider.apply }, { headless: true })
    await fiber.await()

    expect(h.registrations).toEqual(['experimental-browser-use-playwright-native'])
    expect(h.tools.map(tool => tool.name)).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_select',
      'browser_press',
      'browser_scroll',
      'browser_screenshot',
      'browser_tabs',
    ])
    expect(h.tools.every(tool => tool.parameters.type === 'object')).toBe(true)
    expect(h.section).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(h.tools).toEqual([])
  })

  it('applies schema defaults without launching a browser', async () => {
    const parsed = Provider.Config({})
    expect(parsed).toMatchObject({
      headless: true,
      timeoutMs: 30_000,
      viewportWidth: 1_280,
      viewportHeight: 720,
    })
  })

  it.each(['chrome', 'msedge', 'chromium'] as const)('accepts the %s channel', async (channel) => {
    const h = harness()
    const fiber = h.ctx.plugin({ inject: Provider.inject, apply: Provider.apply }, { channel })
    await fiber.await()
    await fiber.dispose()
  })

  it('routes every browser tool through one Session-owned Playwright resource', async () => {
    const h = harness()
    const session = fakeSession()
    const open = vi.spyOn(PlaywrightBrowserSession, 'open').mockResolvedValue(session as unknown as PlaywrightBrowserSession)
    const fiber = h.ctx.plugin({ inject: Provider.inject, apply: Provider.apply }, {
      headless: false,
      channel: 'chrome',
      executablePath: '/opt/chromium',
      timeoutMs: 2_000,
      viewportWidth: 1024,
      viewportHeight: 768,
      userAgent: 'fixture-agent',
    })
    await fiber.await()

    await execute(h, 'browser_navigate', { url: 'https://example.com' })
    await execute(h, 'browser_snapshot', { maxElements: 5 })
    await execute(h, 'browser_click', { token: 'E1' })
    await execute(h, 'browser_type', { token: 'E1', text: 'text' })
    await execute(h, 'browser_select', { token: 'E1', value: 'value' })
    await execute(h, 'browser_press', { key: 'Enter' })
    await execute(h, 'browser_scroll', { deltaX: 0, deltaY: 25 })
    await execute(h, 'browser_screenshot', { fullPage: true })
    await execute(h, 'browser_tabs', { action: 'list' })

    expect(session.navigate).toHaveBeenCalledWith('https://example.com')
    expect(session.snapshot).toHaveBeenCalledWith(5)
    expect(session.click).toHaveBeenCalledWith('E1')
    expect(session.type).toHaveBeenCalledWith('E1', 'text')
    expect(session.select).toHaveBeenCalledWith('E1', 'value')
    expect(session.press).toHaveBeenCalledWith('Enter')
    expect(session.scroll).toHaveBeenCalledWith(0, 25)
    expect(session.screenshot).toHaveBeenCalledWith(true)
    expect(session.tabs).toHaveBeenCalledWith('list', undefined, undefined)
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith({
      headless: false,
      channel: 'chrome',
      executablePath: '/opt/chromium',
      timeoutMs: 2_000,
      viewportWidth: 1024,
      viewportHeight: 768,
      userAgent: 'fixture-agent',
    }, expect.any(AbortSignal))

    await fiber.dispose()
    expect(session.close).toHaveBeenCalledOnce()
    expect(h.providerDispose).toHaveBeenCalledOnce()
    open.mockRestore()
  })

  it('rejects tool calls without a live Session before opening a browser', async () => {
    const h = harness()
    const open = vi.spyOn(PlaywrightBrowserSession, 'open')
    const fiber = h.ctx.plugin({ inject: Provider.inject, apply: Provider.apply })
    await fiber.await()
    await expect(execute(h, 'browser_snapshot', {}, null)).rejects.toThrow('requires a live Session')
    expect(open).not.toHaveBeenCalled()
    await fiber.dispose()
    open.mockRestore()
  })

  it('rejects an already-cancelled tool call before opening a browser', async () => {
    const h = harness()
    const open = vi.spyOn(PlaywrightBrowserSession, 'open')
    const fiber = h.ctx.plugin({ inject: Provider.inject, apply: Provider.apply })
    await fiber.await()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(execute(h, 'browser_snapshot', {}, h.agent, controller.signal)).rejects.toThrow('cancelled')
    expect(open).not.toHaveBeenCalled()
    await fiber.dispose()
    open.mockRestore()
  })
})
