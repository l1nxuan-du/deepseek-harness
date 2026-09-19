import { Buffer } from 'node:buffer'
import type { BrowserContext, Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaywrightBrowserSession } from '../src/runtime.ts'
import type { BrowserLaunchOptions } from '../src/types.ts'

const mocks = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('playwright-core', () => ({ chromium: { launch: mocks.launch } }))

interface ElementOptions {
  tagName?: string
  role?: string
  ariaLabel?: string
  placeholder?: string
  text?: string
  value?: string
  visible?: boolean
  enabled?: boolean
  visibleError?: boolean
  enabledError?: boolean
  evaluateError?: boolean
}

class FakeElement {
  readonly tagName: string
  readonly textContent: string
  readonly value: string

  constructor(private readonly options: ElementOptions) {
    this.tagName = options.tagName ?? 'BUTTON'
    this.textContent = options.text ?? ''
    this.value = options.value ?? ''
  }

  getAttribute(name: string): string | null {
    if (name === 'role') return this.options.role ?? null
    if (name === 'aria-label') return this.options.ariaLabel ?? null
    if (name === 'placeholder') return this.options.placeholder ?? null
    return null
  }
}

class FakeLocator {
  private readonly element: FakeElement
  visible = true
  enabled = true
  visibleError = false
  enabledError = false
  evaluateError = false

  constructor(options: ElementOptions = {}) {
    this.element = new FakeElement(options)
    this.visible = options.visible ?? true
    this.enabled = options.enabled ?? true
    this.visibleError = options.visibleError ?? false
    this.enabledError = options.enabledError ?? false
    this.evaluateError = options.evaluateError ?? false
  }

  readonly isVisible = vi.fn(async () => {
    if (this.visibleError) throw new Error('not visible')
    return this.visible
  })

  readonly isEnabled = vi.fn(async () => {
    if (this.enabledError) throw new Error('not enabled')
    return this.enabled
  })

  readonly evaluate = vi.fn(async (callback: (element: FakeElement) => unknown) => {
    if (this.evaluateError) throw new Error('evaluate failed')
    return callback(this.element)
  })

  readonly click = vi.fn(async () => {})
  readonly fill = vi.fn(async (_text: string) => {})
  readonly selectOption = vi.fn(async (_option: { value: string }) => {})
}

class FakePage {
  currentUrl = 'about:blank'
  readonly elementLocators: FakeLocator[]
  bodyText: string
  bodyError = false
  waitError = false
  gotoError = false
  screenshotError = false
  closeListeners: Array<() => void> = []

  constructor(options: {
    elements?: readonly ElementOptions[]
    bodyText?: string
    bodyError?: boolean
    waitError?: boolean
    gotoError?: boolean
    screenshotError?: boolean
  } = {}) {
    this.elementLocators = (options.elements ?? []).map(element => new FakeLocator(element))
    this.bodyText = options.bodyText ?? 'Body text'
    this.bodyError = options.bodyError ?? false
    this.waitError = options.waitError ?? false
    this.gotoError = options.gotoError ?? false
    this.screenshotError = options.screenshotError ?? false
  }

  readonly url = vi.fn(() => this.currentUrl)
  readonly title = vi.fn(async () => 'Fixture title')
  readonly goto = vi.fn(async (url: string) => {
    if (this.gotoError) throw new Error('navigation failed')
    this.currentUrl = url
  })
  readonly waitForLoadState = vi.fn(async () => {
    if (this.waitError) throw new Error('load state failed')
  })
  readonly locator = vi.fn((selector: string) => selector === 'body'
    ? {
      innerText: vi.fn(async () => {
        if (this.bodyError) throw new Error('body text failed')
        return this.bodyText
      }),
    }
    : { all: vi.fn(async () => this.elementLocators) })
  readonly keyboard = { press: vi.fn(async () => {}) }
  readonly mouse = { wheel: vi.fn(async () => {}) }
  readonly screenshot = vi.fn(async () => {
    if (this.screenshotError) throw new Error('screenshot failed')
    return Buffer.from('png')
  })
  readonly bringToFront = vi.fn(async () => {})
  readonly close = vi.fn(async () => {
    for (const listener of this.closeListeners) listener()
  })

  once(event: string, listener: () => void): void {
    if (event === 'close') this.closeListeners.push(listener)
  }
}

class FakeContext {
  readonly created: FakePage[] = []
  pageFactory = (): FakePage => new FakePage()
  readonly pageListeners: Array<(page: Page) => void> = []
  newPageError = false

  readonly pages = vi.fn(() => this.created as unknown as Page[])
  readonly newPage = vi.fn(async () => {
    if (this.newPageError) throw new Error('new page failed')
    const page = this.pageFactory()
    this.created.push(page)
    for (const listener of this.pageListeners) listener(page as unknown as Page)
    return page as unknown as Page
  })
  readonly on = vi.fn((event: string, listener: (page: Page) => void) => {
    if (event === 'page') this.pageListeners.push(listener)
  })
}

class FakeBrowser {
  context = new FakeContext()
  newContextError = false
  closeError = false
  closed = false

  readonly newContext = vi.fn(async () => {
    if (this.newContextError) throw new Error('context failed')
    return this.context as unknown as BrowserContext
  })
  readonly close = vi.fn(async () => {
    this.closed = true
    if (this.closeError) throw new Error('close failed')
  })
}

const DEFAULT_OPTIONS: BrowserLaunchOptions = {
  headless: true,
  timeoutMs: 1_000,
  viewportWidth: 800,
  viewportHeight: 600,
}

const launch = mocks.launch
afterEach(() => { vi.clearAllMocks() })

async function openSession(options: BrowserLaunchOptions = DEFAULT_OPTIONS, browser = new FakeBrowser()) {
  launch.mockResolvedValue(browser)
  const session = await PlaywrightBrowserSession.open(options, new AbortController().signal)
  const page = browser.context.created[0]
  if (page === undefined) throw new Error('fixture did not create a page')
  return { browser, context: browser.context, page, session }
}

describe('PlaywrightBrowserSession launch and cleanup', () => {
  it('rejects an already-aborted startup before importing Playwright', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(PlaywrightBrowserSession.open(DEFAULT_OPTIONS, controller.signal)).rejects.toThrow()
    expect(launch).not.toHaveBeenCalled()
  })

  it('launches the first available channel with the configured context and closes the browser', async () => {
    const { browser, context, session } = await openSession({ ...DEFAULT_OPTIONS, userAgent: 'fixture-agent' })
    expect(launch).toHaveBeenCalledWith({ headless: true, channel: 'chrome' })
    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 800, height: 600 },
      userAgent: 'fixture-agent',
    })
    expect(context.newPage).toHaveBeenCalledOnce()
    await session.close()
    expect(browser.closed).toBe(true)
  })

  it('uses an explicit executable path without channel probing', async () => {
    const { session } = await openSession({ ...DEFAULT_OPTIONS, executablePath: '/opt/chromium' })
    expect(launch).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith({ headless: true, executablePath: '/opt/chromium' })
    await session.close()
  })

  it('uses an explicitly configured channel without fallback', async () => {
    const { session } = await openSession({ ...DEFAULT_OPTIONS, channel: 'msedge' })
    expect(launch).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith({ headless: true, channel: 'msedge' })
    await session.close()
  })

  it('falls back from Chrome to Edge to bundled Chromium', async () => {
    const browser = new FakeBrowser()
    launch
      .mockRejectedValueOnce(new Error('chrome unavailable'))
      .mockRejectedValueOnce(new Error('edge unavailable'))
      .mockResolvedValueOnce(browser)
    const session = await PlaywrightBrowserSession.open(DEFAULT_OPTIONS, new AbortController().signal)
    expect(launch.mock.calls).toEqual([
      [{ headless: true, channel: 'chrome' }],
      [{ headless: true, channel: 'msedge' }],
      [{ headless: true }],
    ])
    await session.close()
  })

  it('reports all launch failures with the platform and remediation', async () => {
    launch.mockRejectedValue(new Error('not installed'))
    await expect(PlaywrightBrowserSession.open({ ...DEFAULT_OPTIONS, executablePath: '/missing' }, new AbortController().signal))
      .rejects.toThrow(`Playwright could not launch Chromium on ${process.platform}`)
  })

  it('closes a launched browser when context setup fails', async () => {
    const browser = new FakeBrowser()
    browser.newContextError = true
    launch.mockResolvedValue(browser)
    await expect(PlaywrightBrowserSession.open({ ...DEFAULT_OPTIONS, executablePath: '/opt/chromium' }, new AbortController().signal))
      .rejects.toThrow('Playwright could not launch Chromium')
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('closes a launched browser when startup is canceled after launch', async () => {
    const browser = new FakeBrowser()
    const controller = new AbortController()
    browser.newContext.mockImplementation(async () => {
      controller.abort(new Error('startup canceled'))
      return browser.context as unknown as BrowserContext
    })
    browser.context.newPageError = true
    launch.mockResolvedValue(browser)
    await expect(PlaywrightBrowserSession.open({ ...DEFAULT_OPTIONS, executablePath: '/opt/chromium' }, controller.signal))
      .rejects.toThrow('startup canceled')
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('preserves the launch failure when cleanup also fails', async () => {
    const browser = new FakeBrowser()
    browser.newContextError = true
    browser.closeError = true
    launch.mockResolvedValue(browser)
    await expect(PlaywrightBrowserSession.open({ ...DEFAULT_OPTIONS, executablePath: '/opt/chromium' }, new AbortController().signal))
      .rejects.toThrow('Playwright could not launch Chromium')
  })
})

describe('PlaywrightBrowserSession actions', () => {
  it('navigates to HTTP(S) URLs and invalidates prior tokens', async () => {
    const page = new FakePage()
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)
    await expect(session.navigate('https://example.com/path')).resolves.toMatchObject({
      structuredContent: { url: 'https://example.com/path', title: 'Fixture title' },
    })
    expect(page.goto).toHaveBeenCalledWith('https://example.com/path', { waitUntil: 'domcontentloaded', timeout: 1_000 })
    await session.close()
  })

  it.each([
    [undefined, 'url must be a non-empty string'],
    ['', 'url must be a non-empty string'],
    ['/relative', 'url must be an absolute HTTP(S) URL'],
    ['ftp://example.com', 'url must use HTTP or HTTPS'],
  ])('rejects invalid navigation URL %j', async (url, message) => {
    const { session } = await openSession()
    await expect(session.navigate(url)).rejects.toThrow(message)
    await session.close()
  })

  it('returns a bounded snapshot with visible enabled elements and input values', async () => {
    const page = new FakePage({
      elements: [
        { ariaLabel: 'Go' },
        { tagName: 'INPUT', placeholder: 'Name', value: 'Ada' },
        { text: 'Second', visible: false },
        { text: 'Third', enabled: false },
        { text: 'Fourth', visibleError: true },
        { text: 'Fifth', enabledError: true },
        { text: 'Sixth', evaluateError: true },
      ],
      bodyText: 'x'.repeat(8_001),
    })
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)

    const result = await session.snapshot(2) as { content: Array<{ text: string }>; structuredContent: { elements: string[] } }
    expect(result.content[0]?.text).toContain('[E1] button "Go"')
    expect(result.content[0]?.text).toContain('[E2] input "Name" value="Ada"')
    expect(result.content[0]?.text).toContain('… truncated')
    expect(result.structuredContent.elements).toEqual(['E1', 'E2'])
    await session.close()
  })

  it('returns an empty snapshot and tolerates load-state, visibility, enablement, evaluation, and body-read failures', async () => {
    const page = new FakePage({
      waitError: true,
      bodyError: true,
      elements: [
        { enabled: false },
        { visibleError: true },
        { enabledError: true, evaluateError: true },
        { evaluateError: true },
      ],
    })
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)
    const result = await session.snapshot(undefined) as { content: Array<{ text: string }> }
    expect(result.content[0]?.text).toContain('Interactive elements:\n(none)')
    await session.close()
  })

  it('covers role, placeholder, text, and tag-derived element labels', async () => {
    const page = new FakePage({
      elements: [
        { role: 'button', text: 'Role' },
        { tagName: 'INPUT', placeholder: 'Placeholder' },
        { tagName: 'A', text: '  Link   label  ' },
        { tagName: 'DIV', text: 'Plain' },
      ],
    })
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)
    const result = await session.snapshot(100) as { content: Array<{ text: string }> }
    expect(result.content[0]?.text).toContain('[E1] button "Role"')
    expect(result.content[0]?.text).toContain('[E2] input "Placeholder"')
    expect(result.content[0]?.text).toContain('[E3] a "Link label"')
    expect(result.content[0]?.text).toContain('[E4] div "Plain"')
    await session.close()
  })

  it('clicks, fills, selects, presses, scrolls, and screenshots through the active page', async () => {
    const page = new FakePage({ elements: [{ ariaLabel: 'Go' }, { ariaLabel: 'Name' }, { ariaLabel: 'Choice' }] })
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)
    await session.snapshot(undefined)
    await session.click('E1')
    await session.snapshot(undefined)
    await session.type('E1', 'text')
    await session.snapshot(undefined)
    await session.select('E1', 'value')
    await session.press('Enter')
    await session.scroll(0, 25)
    const screenshot = await session.screenshot(false) as { content: Array<{ type: string }> }
    expect(page.elementLocators[0]?.click).toHaveBeenCalledWith({ timeout: 1_000 })
    expect(page.elementLocators[0]?.fill).toHaveBeenCalledWith('text', { timeout: 1_000 })
    expect(page.elementLocators[0]?.selectOption).toHaveBeenCalledWith({ value: 'value' }, { timeout: 1_000 })
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 25)
    expect(screenshot.content).toEqual([
      { type: 'text', text: 'Screenshot of about:blank.' },
      { type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' },
    ])
    await session.close()
  })

  it('captures full-page screenshots and validates screenshot flags', async () => {
    const { session, page } = await openSession()
    await session.screenshot(true)
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true })
    await expect(session.screenshot('yes')).rejects.toThrow('fullPage must be boolean')
    await session.close()
  })

  it.each(['E', 'E0x', 7])('rejects token %j', async (token) => {
    const { session } = await openSession()
    await expect(session.click(token)).rejects.toThrow('token must come from browser_snapshot')
    await session.close()
  })

  it('reports stale tokens and validates typed action arguments', async () => {
    const page = new FakePage({ elements: [{ ariaLabel: 'Go' }] })
    const browser = new FakeBrowser()
    browser.context.pageFactory = () => page
    const { session } = await openSession(DEFAULT_OPTIONS, browser)
    await expect(session.click('E1')).rejects.toThrow('E1 is stale')
    await session.snapshot(undefined)
    await expect(session.type('E1', 7)).rejects.toThrow('text must be a string')
    await expect(session.select('E1', 7)).rejects.toThrow('value must be a string')
    await expect(session.press(7)).rejects.toThrow('key must be a string')
    await expect(session.scroll(0, 0)).rejects.toThrow('deltaX or deltaY must be nonzero')
    await expect(session.scroll(1.5, 1)).rejects.toThrow('deltaX must be an integer')
    await session.close()
  })

  it('lists, opens, selects, and closes tabs', async () => {
    const { session, context, page } = await openSession()
    page.currentUrl = 'https://first.example'
    const listed = await session.tabs('list', undefined, undefined) as { content: Array<{ text: string }> }
    expect(listed.content[0]?.text).toContain('[0] https://first.example (active)')

    const opened = await session.tabs('new', undefined, 'https://second.example') as { content: Array<{ text: string }> }
    expect(opened.content[0]?.text).toBe('Opened tab 1.')
    expect(context.created[1]?.goto).toHaveBeenCalledWith('https://second.example/', { waitUntil: 'domcontentloaded', timeout: 1_000 })

    await session.tabs('select', 0, undefined)
    expect(context.created[0]?.bringToFront).toHaveBeenCalledOnce()
    await session.tabs('close', 0, undefined)
    expect(context.created[0]?.close).toHaveBeenCalledOnce()
    await session.close()
  })

  it('opens a blank tab and closes the active tab', async () => {
    const { session, context } = await openSession()
    await session.tabs('new', undefined, undefined)
    await session.tabs('close', 1, undefined)
    expect(context.created[1]?.close).toHaveBeenCalledOnce()
    await session.close()
  })

  it('closes an inactive tab without changing the active page', async () => {
    const { session, context } = await openSession()
    await session.tabs('new', undefined, undefined)
    await session.tabs('select', 0, undefined)
    await session.tabs('close', 1, undefined)
    const listed = await session.tabs('list', undefined, undefined) as { content: Array<{ text: string }> }
    expect(listed.content[0]?.text).toContain('[0] about:blank (active)')
    expect(context.created[1]?.close).toHaveBeenCalledOnce()
    await session.close()
  })

  it('validates tab actions, indices, and the last remaining tab', async () => {
    const { session } = await openSession()
    await expect(session.tabs('invalid', undefined, undefined)).rejects.toThrow('action must be list, new, select, or close')
    await expect(session.tabs('select', 8, undefined)).rejects.toThrow('index must name a current browser tab')
    await expect(session.tabs('close', 0, undefined)).rejects.toThrow('cannot close the only browser tab')
    await session.close()
  })

  it('tracks pages that the context creates without a tabs call', async () => {
    const { session, context } = await openSession()
    const external = new FakePage()
    external.currentUrl = 'https://external.example'
    context.pageFactory = () => external
    await context.newPage()
    const listed = await session.tabs('list', undefined, undefined) as { content: Array<{ text: string }> }
    expect(listed.content[0]?.text).toContain('https://external.example')
    await session.close()
  })
})
