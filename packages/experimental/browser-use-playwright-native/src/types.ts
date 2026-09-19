/** Shared Playwright browser configuration and action types. */

/** Chromium channel selected by the deployment. */
export type BrowserChannel = 'chrome' | 'msedge' | 'chromium'

/** Resolved Playwright launch settings. */
export interface BrowserLaunchOptions {
  /** Hide the browser window. */
  readonly headless: boolean
  /** Preferred browser channel; omitted probes Chrome, Edge, then bundled Chromium. */
  readonly channel?: BrowserChannel
  /** Explicit Chromium executable override for managed deployments. */
  readonly executablePath?: string
  /** Operation timeout in milliseconds. */
  readonly timeoutMs: number
  /** Initial page viewport width. */
  readonly viewportWidth: number
  /** Initial page viewport height. */
  readonly viewportHeight: number
  /** Optional product user agent. */
  readonly userAgent?: string
}

/** One element exposed by the latest browser snapshot. */
export interface BrowserElement {
  /** Stable token valid until the next snapshot or navigation. */
  readonly token: string
  /** Element role or HTML tag used in the model-facing line. */
  readonly role: string
  /** Concise accessible/visible name. */
  readonly name: string
  /** Current input value, when the element has one. */
  readonly value?: string
}
