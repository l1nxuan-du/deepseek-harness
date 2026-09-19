/**
 * Keyless Google search with an automatic Bing fallback. The provider reads
 * the public result pages through explicit search URLs, parses only result
 * anchors and snippets, and sends no cookies or account credentials.
 * @module @deepseek-ai/dsh-web-search-google-bing/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SearchEngine } from './types.ts'

/** Stable id this provider registers under. */
export const GOOGLE_BING_PROVIDER_ID = 'google-bing'

/** Default Google search endpoint. */
export const GOOGLE_SEARCH_DEFAULT_BASE_URL = 'https://www.google.com/search'

/** Default Bing search endpoint. */
export const BING_SEARCH_DEFAULT_BASE_URL = 'https://www.bing.com/search'

/** Default browser-language preference sent to both engines. */
export const GOOGLE_BING_DEFAULT_LANGUAGE = 'en-US'

/** Default explicit product user agent; never disguised as a browser. */
export const GOOGLE_BING_DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Default maximum response bytes accepted from either search page. */
export const GOOGLE_BING_DEFAULT_MAX_RESPONSE_BYTES = 2_000_000

/** Resolved provider options supplied by the plugin config. */
export interface GoogleBingSearchOptions {
  /** Google search endpoint. */
  readonly googleBaseURL: string
  /** Bing search endpoint used when Google fails or yields no parsed sources. */
  readonly bingBaseURL: string
  /** Explicit browser-language preference. */
  readonly language: string
  /** Explicit product user agent. */
  readonly userAgent: string
  /** Maximum response bytes accepted per engine. */
  readonly maxResponseBytes: number
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/giu, (entity) => {
    switch (entity.toLowerCase()) {
      case '&amp;': return '&'
      case '&lt;': return '<'
      case '&gt;': return '>'
      case '&quot;': return '"'
      case '&apos;': return "'"
      case '&#39;': return "'"
      default: {
        const numeric = entity.startsWith('&#x') || entity.startsWith('&#X')
          ? Number.parseInt(entity.slice(3, -1), 16)
          : Number.parseInt(entity.slice(2, -1), 10)
        return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10FFFF
          ? String.fromCodePoint(numeric)
          : entity
      }
    }
  })
}

function normalizedText(value: string | null | undefined): string {
  return decodeHtml(value ?? '').replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu'))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function resultUrl(engine: SearchEngine, href: string | null): string | undefined {
  if (href === null || href.length === 0) return undefined
  const decoded = decodeHtml(href).trim()
  let parsed: URL
  try {
    parsed = new URL(decoded, engine === 'google' ? 'https://www.google.com' : 'https://www.bing.com')
  } catch {
    return undefined
  }
  if (engine === 'google' && parsed.hostname.endsWith('google.com') && parsed.pathname === '/url') {
    const redirected = parsed.searchParams.get('q')
    if (redirected === null) return undefined
    try {
      parsed = new URL(redirected)
    } catch {
      return undefined
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  if (parsed.hostname.endsWith('google.com') || parsed.hostname.endsWith('bing.com')) return undefined
  return parsed.toString()
}

function source(
  engine: SearchEngine,
  href: string | null,
  title: string,
  snippet: string,
): WebSearchSource | undefined {
  const url = resultUrl(engine, href)
  if (url === undefined) return undefined
  return {
    url,
    ...title.length === 0 ? {} : { title },
    ...snippet.length === 0 ? {} : { snippet },
  }
}

function uniqueSources(sources: readonly WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

/**
 * Parse Google's public search page. This accepts only the result-link shape
 * (`a` → `h3`) instead of executing page scripts or trusting arbitrary markup.
 * @param html - decoded Google search HTML.
 * @returns parsed sources in page order.
 */
export function parseGoogleSearchHtml(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const result = /<a\b([^>]*)>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/giu
  for (const match of html.matchAll(result)) {
    const title = normalizedText(match[2])
    const after = html.slice(match.index + match[0].length)
    const mapped = source(
      'google',
      attr(match[1] ?? '', 'href') ?? null,
      title,
      normalizedText(after.slice(0, after.search(/<\/div>|<\/li>/iu) === -1 ? after.length : after.search(/<\/div>|<\/li>/iu))),
    )
    if (mapped !== undefined) sources.push(mapped)
  }
  return uniqueSources(sources)
}

/**
 * Parse Bing's public search page result list. This accepts only the
 * `li.b_algo` → `h2 a` shape and leaves page scripts untouched.
 * @param html - decoded Bing search HTML.
 * @returns parsed sources in page order.
 */
export function parseBingSearchHtml(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const result = /<li\b[^>]*class=(?:"[^"]*\bb_algo\b[^"]*"|'[^']*\bb_algo\b[^']*')[^>]*>([\s\S]*?)<\/li>/giu
  for (const match of html.matchAll(result)) {
    const block = match[1] ?? ''
    const anchor = block.match(/<h2\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/iu)
    const snippet = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/iu)?.[1]
    const mapped = source(
      'bing',
      anchor === null ? null : attr(anchor[1] ?? '', 'href') ?? null,
      normalizedText(anchor?.[2]),
      normalizedText(snippet),
    )
    if (mapped !== undefined) sources.push(mapped)
  }
  return uniqueSources(sources)
}

function requestUrl(engine: SearchEngine, query: string, maxResults: number, options: GoogleBingSearchOptions): URL {
  const url = new URL(engine === 'google' ? options.googleBaseURL : options.bingBaseURL)
  url.searchParams.set('q', query)
  if (engine === 'google') {
    url.searchParams.set('num', String(maxResults))
    url.searchParams.set('hl', options.language)
  } else {
    url.searchParams.set('count', String(maxResults))
    url.searchParams.set('setlang', options.language)
  }
  return url
}

async function readHtml(response: Response, maxResponseBytes: number): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxResponseBytes) {
    throw new WebError('search response exceeded the configured byte limit', 'WEB_PROVIDER_ERROR')
  }
  return new TextDecoder().decode(bytes)
}

async function searchEngine(
  engine: SearchEngine,
  request: WebSearchRequest,
  options: GoogleBingSearchOptions,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const response = await fetch(requestUrl(engine, request.query, request.maxResults ?? 10, options), {
    method: 'GET',
    redirect: 'error',
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': options.language,
      'user-agent': options.userAgent,
    },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new WebError(`${engine} search returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
  }
  const html = await readHtml(response, options.maxResponseBytes)
  const sources = engine === 'google' ? parseGoogleSearchHtml(html) : parseBingSearchHtml(html)
  if (sources.length === 0) {
    throw new WebError(`${engine} search returned no parseable results`, 'WEB_PROVIDER_ERROR')
  }
  return { sources, truncated: false }
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}

/** Google-first provider with Bing as its only automatic fallback. */
export class GoogleBingSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_BING_PROVIDER_ID

  constructor(private readonly options: GoogleBingSearchOptions) {}

  available(): boolean {
    return isHttpUrl(this.options.googleBaseURL)
      && isHttpUrl(this.options.bingBaseURL)
      && this.options.language.trim().length > 0
      && this.options.userAgent.trim().length > 0
      && Number.isSafeInteger(this.options.maxResponseBytes)
      && this.options.maxResponseBytes > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (signal?.aborted) throw new WebError('Google/Bing search aborted', 'WEB_ABORTED')
    let googleError: unknown
    try {
      return await searchEngine('google', request, this.options, signal)
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('Google/Bing search aborted', 'WEB_ABORTED', { cause: error })
      googleError = error
    }
    try {
      return await searchEngine('bing', request, this.options, signal)
    } catch (error: unknown) {
      if (signal?.aborted) throw new WebError('Google/Bing search aborted', 'WEB_ABORTED', { cause: error })
      const googleMessage = googleError instanceof Error ? googleError.message : String(googleError)
      const bingMessage = error instanceof Error ? error.message : String(error)
      throw new WebError(
        `Google search failed (${googleMessage}); Bing fallback failed (${bingMessage})`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }
}
