/** Playwright-owned Chromium session and normalized page actions. */

import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import type { BrowserElement, BrowserLaunchOptions } from './types.ts'

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const MAX_TEXT_CHARS = 8_000

interface LaunchAttempt {
  readonly channel?: string
  readonly executablePath?: string
}

function launchAttempts(options: BrowserLaunchOptions): readonly LaunchAttempt[] {
  if (options.executablePath !== undefined) return [{ executablePath: options.executablePath }]
  if (options.channel !== undefined) return [{ channel: options.channel }]
  return [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
}

function parseHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('url must be a non-empty string')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('url must be an absolute HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must use HTTP or HTTPS')
  return url.href
}

function parseToken(value: unknown): string {
  if (typeof value !== 'string' || !/^E\d+$/u.test(value)) throw new Error('token must come from browser_snapshot')
  return value
}

function parseText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function parseInteger(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${field} must be an integer`)
  return value
}

function textResult(text: string, structuredContent?: unknown): unknown {
  return {
    content: [{ type: 'text', text }],
    ...structuredContent === undefined ? {} : { structuredContent },
  }
}

function truncate(value: string, maximum = MAX_TEXT_CHARS): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n… truncated`
}

/** One provider-owned Chromium context with the normalized action set. */
export class PlaywrightBrowserSession {
  private elements = new Map<string, Locator>()
  private active: Page
  private readonly pages = new Set<Page>()

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly options: BrowserLaunchOptions,
  ) {
    this.active = context.pages()[0] as Page
    this.track(this.active)
    context.on('page', (page) => { this.track(page) })
  }

  /**
   * Launch one isolated Chromium context using Playwright's cross-platform
   * channel/executable discovery.
   * @param options - resolved launch options.
   * @param signal - startup cancellation.
   * @returns the ready session.
   */
  static async open(options: BrowserLaunchOptions, signal: AbortSignal): Promise<PlaywrightBrowserSession> {
    signal.throwIfAborted()
    const { chromium } = await import('playwright-core')
    let lastError: unknown
    for (const attempt of launchAttempts(options)) {
      let browser: Browser | undefined
      try {
        signal.throwIfAborted()
        browser = await chromium.launch({
          headless: options.headless,
          ...attempt,
        })
        signal.throwIfAborted()
        const context = await browser.newContext({
          viewport: { width: options.viewportWidth, height: options.viewportHeight },
          ...options.userAgent === undefined ? {} : { userAgent: options.userAgent },
        })
        await context.newPage()
        signal.throwIfAborted()
        return new PlaywrightBrowserSession(browser, context, options)
      } catch (error: unknown) {
        try {
          await browser?.close()
        } catch (closeError: unknown) {
          // Preserve the launch or cancellation failure; this browser is discarded.
          void closeError
        }
        signal.throwIfAborted()
        lastError = error
      }
    }
    throw new Error(
      `Playwright could not launch Chromium on ${process.platform}; set experimental-browser-use-playwright-native.executablePath or install Chrome/Edge`,
      { cause: lastError },
    )
  }

  /**
   * Close the browser and all owned pages.
   * @returns after Playwright closes the process.
   */
  async close(): Promise<void> {
    this.elements.clear()
    await this.browser.close()
  }

  /**
   * Navigate the active page and invalidate prior element tokens.
   * @param rawUrl - absolute HTTP(S) URL.
   * @returns the navigation result.
   */
  async navigate(rawUrl: unknown): Promise<unknown> {
    const url = parseHttpUrl(rawUrl)
    await this.active.goto(url, { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs })
    this.elements.clear()
    return textResult(`Navigated to ${this.active.url()}`, { url: this.active.url(), title: await this.active.title() })
  }

  /**
   * Return a bounded interactive page snapshot with stable action tokens.
   * @param rawMaxElements - optional snapshot element bound.
   * @returns the page snapshot result.
   */
  async snapshot(rawMaxElements: unknown): Promise<unknown> {
    const maxElements = Math.min(200, Math.max(1, parseInteger(rawMaxElements, 'maxElements', 100)))
    this.elements.clear()
    await this.active.waitForLoadState('domcontentloaded', { timeout: this.options.timeoutMs }).catch(() => {})
    const locators = await this.active.locator(INTERACTIVE_SELECTOR).all()
    const lines: string[] = []
    let index = 0
    for (const locator of locators) {
      if (index >= maxElements) break
      if (!await locator.isVisible().catch(() => false)) continue
      if (!await locator.isEnabled().catch(() => true)) continue
      const info = await locator.evaluate((element) => {
        const tagName = element.tagName.toLowerCase()
        const value = tagName === 'input' || tagName === 'textarea' || tagName === 'select'
          ? (element as HTMLInputElement).value
          : undefined
        const name = element.getAttribute('aria-label')
          ?? element.getAttribute('placeholder')
          ?? element.textContent.trim().replace(/\s+/gu, ' ').slice(0, 200)
        return {
          role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
          name,
          ...value === undefined ? {} : { value },
        }
      }).catch(() => undefined)
      if (info === undefined) continue
      const token = `E${String(++index)}`
      this.elements.set(token, locator)
      lines.push(`[${token}] ${info.role} ${JSON.stringify(info.name)}${info.value === undefined ? '' : ` value=${JSON.stringify(info.value)}`}`)
    }
    const body = await this.active.locator('body').innerText({ timeout: this.options.timeoutMs }).catch(() => '')
    const text = [
      `URL: ${this.active.url()}`,
      `Title: ${await this.active.title()}`,
      'Interactive elements:',
      ...lines.length === 0 ? ['(none)'] : lines,
      '',
      'Page text:',
      truncate(body),
    ].join('\n')
    return textResult(text, {
      url: this.active.url(),
      title: await this.active.title(),
      elements: [...this.elements.keys()] as readonly BrowserElement['token'][],
    })
  }

  /**
   * Click one token from the latest snapshot.
   * @param rawToken - element token.
   * @returns the click result.
   */
  async click(rawToken: unknown): Promise<unknown> {
    const locator = this.locator(rawToken)
    await locator.click({ timeout: this.options.timeoutMs })
    this.elements.clear()
    return textResult(`Clicked ${parseToken(rawToken)}.`)
  }

  /**
   * Fill one input token from the latest snapshot.
   * @param rawToken - element token.
   * @param rawText - replacement text.
   * @returns the fill result.
   */
  async type(rawToken: unknown, rawText: unknown): Promise<unknown> {
    const token = parseToken(rawToken)
    const text = parseText(rawText, 'text')
    await this.locator(token).fill(text, { timeout: this.options.timeoutMs })
    this.elements.clear()
    return textResult(`Filled ${token}.`)
  }

  /**
   * Select one option in a select token.
   * @param rawToken - element token.
   * @param rawValue - option value.
   * @returns the selection result.
   */
  async select(rawToken: unknown, rawValue: unknown): Promise<unknown> {
    const token = parseToken(rawToken)
    const value = parseText(rawValue, 'value')
    await this.locator(token).selectOption({ value }, { timeout: this.options.timeoutMs })
    this.elements.clear()
    return textResult(`Selected ${JSON.stringify(value)} in ${token}.`)
  }

  /**
   * Press a browser key on the active page.
   * @param rawKey - Playwright key name.
   * @returns the key result.
   */
  async press(rawKey: unknown): Promise<unknown> {
    const key = parseText(rawKey, 'key')
    await this.active.keyboard.press(key)
    this.elements.clear()
    return textResult(`Pressed ${JSON.stringify(key)}.`)
  }

  /**
   * Scroll the active page in CSS pixels.
   * @param rawDeltaX - horizontal delta.
   * @param rawDeltaY - vertical delta.
   * @returns the scroll result.
   */
  async scroll(rawDeltaX: unknown, rawDeltaY: unknown): Promise<unknown> {
    const deltaX = parseInteger(rawDeltaX, 'deltaX', 0)
    const deltaY = parseInteger(rawDeltaY, 'deltaY', 0)
    if (deltaX === 0 && deltaY === 0) throw new Error('deltaX or deltaY must be nonzero')
    await this.active.mouse.wheel(deltaX, deltaY)
    this.elements.clear()
    return textResult(`Scrolled by (${String(deltaX)}, ${String(deltaY)}).`)
  }

  /**
   * Take a screenshot of the active page.
   * @param rawFullPage - whether to capture the full document.
   * @returns the screenshot result.
   */
  async screenshot(rawFullPage: unknown): Promise<unknown> {
    if (rawFullPage !== undefined && typeof rawFullPage !== 'boolean') throw new Error('fullPage must be boolean')
    const bytes = await this.active.screenshot({ type: 'png', fullPage: rawFullPage === true })
    return {
      content: [
        { type: 'text', text: `Screenshot of ${this.active.url()}.` },
        { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' },
      ],
    }
  }

  /**
   * List, create, select, or close browser tabs.
   * @param rawAction - tab operation.
   * @param rawIndex - tab index for select or close.
   * @param rawUrl - optional URL for a new tab.
   * @returns the tab-management result.
   */
  async tabs(rawAction: unknown, rawIndex: unknown, rawUrl: unknown): Promise<unknown> {
    const action = parseText(rawAction, 'action')
    if (action === 'list') {
      return textResult(this.pageLines().join('\n'), { tabs: this.pageLines() })
    }
    if (action === 'new') {
      const page = await this.context.newPage()
      if (rawUrl !== undefined) await page.goto(parseHttpUrl(rawUrl), { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs })
      this.active = page
      this.track(page)
      this.elements.clear()
      return textResult(`Opened tab ${String([...this.pages].indexOf(page))}.`)
    }
    if (action === 'select' || action === 'close') {
      const index = parseInteger(rawIndex, 'index')
      const page = [...this.pages][index]
      if (page === undefined) throw new Error('index must name a current browser tab')
      if (action === 'select') {
        this.active = page
        await page.bringToFront()
        this.elements.clear()
        return textResult(`Selected tab ${String(index)}.`)
      }
      if (this.pages.size === 1) throw new Error('cannot close the only browser tab')
      await page.close()
      this.pages.delete(page)
      if (this.active === page) this.active = [...this.pages][0] as Page
      this.elements.clear()
      return textResult(`Closed tab ${String(index)}.`)
    }
    throw new Error('action must be list, new, select, or close')
  }

  private locator(rawToken: unknown): Locator {
    const token = parseToken(rawToken)
    const locator = this.elements.get(token)
    if (locator === undefined) throw new Error(`${token} is stale; call browser_snapshot again`)
    return locator
  }

  private track(page: Page): void {
    this.pages.add(page)
    page.once('close', () => { this.pages.delete(page) })
  }

  private pageLines(): string[] {
    const lines: string[] = []
    for (const [index, page] of [...this.pages].entries()) {
      lines.push(`[${String(index)}] ${page.url()}${page === this.active ? ' (active)' : ''}`)
    }
    return lines
  }
}
