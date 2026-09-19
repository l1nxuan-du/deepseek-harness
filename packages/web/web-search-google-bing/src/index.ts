/**
 * Google-first, Bing-fallback `WebSearchProvider` plugin. It contributes to the
 * `ctx.web` registry without owning the service.
 * @module @deepseek-ai/dsh-web-search-google-bing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  BING_SEARCH_DEFAULT_BASE_URL,
  GOOGLE_BING_DEFAULT_LANGUAGE,
  GOOGLE_BING_DEFAULT_MAX_RESPONSE_BYTES,
  GOOGLE_BING_DEFAULT_USER_AGENT,
  GOOGLE_SEARCH_DEFAULT_BASE_URL,
  GoogleBingSearchProvider,
} from './provider.ts'

export {
  BING_SEARCH_DEFAULT_BASE_URL,
  GOOGLE_BING_DEFAULT_LANGUAGE,
  GOOGLE_BING_DEFAULT_MAX_RESPONSE_BYTES,
  GOOGLE_BING_DEFAULT_USER_AGENT,
  GOOGLE_BING_PROVIDER_ID,
  GOOGLE_SEARCH_DEFAULT_BASE_URL,
  GoogleBingSearchProvider,
  parseBingSearchHtml,
  parseGoogleSearchHtml,
} from './provider.ts'
export type { GoogleBingSearchOptions } from './provider.ts'
export type { SearchEngine } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-google-bing'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config for the two keyless HTML search endpoints. */
export interface Config {
  /** Google search endpoint. Defaults to the public Google Search page. */
  googleBaseURL?: string
  /** Bing fallback endpoint. Defaults to the public Bing Search page. */
  bingBaseURL?: string
  /** Browser-language preference sent to both engines. Defaults to en-US. */
  language?: string
  /** Explicit product user agent. Defaults to the harness identity. */
  userAgent?: string
  /** Maximum response bytes accepted per engine. Defaults to 2000000. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  googleBaseURL: z.string().default(GOOGLE_SEARCH_DEFAULT_BASE_URL),
  bingBaseURL: z.string().default(BING_SEARCH_DEFAULT_BASE_URL),
  language: z.string().default(GOOGLE_BING_DEFAULT_LANGUAGE),
  userAgent: z.string().default(GOOGLE_BING_DEFAULT_USER_AGENT),
  maxResponseBytes: z.number().default(GOOGLE_BING_DEFAULT_MAX_RESPONSE_BYTES),
})

/** Register the Google-first search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.web.registerSearchProvider(new GoogleBingSearchProvider({
    googleBaseURL: resolved.googleBaseURL,
    bingBaseURL: resolved.bingBaseURL,
    language: resolved.language,
    userAgent: resolved.userAgent,
    maxResponseBytes: resolved.maxResponseBytes,
  }))
}
