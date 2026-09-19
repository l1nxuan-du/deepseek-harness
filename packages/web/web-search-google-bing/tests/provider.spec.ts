import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  GOOGLE_BING_PROVIDER_ID,
  GoogleBingSearchProvider,
  parseBingSearchHtml,
  parseGoogleSearchHtml,
} from '../src/index.ts'

const GOOGLE_HTML = `<!doctype html><html><body>
<div class="g"><a href="/url?q=https%3A%2F%2Fexample.com%2Falpha&amp;sa=U"><h3>Alpha result</h3></a><div class="VwiC3b">Alpha snippet</div></div>
<div class="g"><a href="https://example.com/beta"><h3>Beta result</h3></a><div class="VwiC3b">Beta snippet</div></div>
</body></html>`

const BING_HTML = `<!doctype html><html><body><ol>
<li class="b_algo"><h2><a href="https://example.com/bing-a">Bing Alpha</a></h2><p>Bing alpha snippet</p></li>
<li class="b_algo"><h2><a href="https://example.com/bing-b">Bing Beta</a></h2><p>Bing beta snippet</p></li>
</ol></body></html>`

const OPTIONS = {
  googleBaseURL: 'https://www.google.com/search',
  bingBaseURL: 'https://www.bing.com/search',
  language: 'en-US',
  userAgent: 'dsh-test',
  maxResponseBytes: 1_000_000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Google and Bing HTML parsing', () => {
  it('parses Google result links, titles, and snippets', () => {
    expect(parseGoogleSearchHtml(GOOGLE_HTML)).toEqual([
      { url: 'https://example.com/alpha', title: 'Alpha result', snippet: 'Alpha snippet' },
      { url: 'https://example.com/beta', title: 'Beta result', snippet: 'Beta snippet' },
    ])
  })

  it('parses Bing result blocks', () => {
    expect(parseBingSearchHtml(BING_HTML)).toEqual([
      { url: 'https://example.com/bing-a', title: 'Bing Alpha', snippet: 'Bing alpha snippet' },
      { url: 'https://example.com/bing-b', title: 'Bing Beta', snippet: 'Bing beta snippet' },
    ])
  })
})

describe('GoogleBingSearchProvider', () => {
  it('uses Google first and does not request Bing after a parseable Google result', async () => {
    const fetchMock = vi.fn(async () => new Response(GOOGLE_HTML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new GoogleBingSearchProvider(OPTIONS)

    await expect(provider.search({ query: 'alpha', maxResults: 2 })).resolves.toMatchObject({
      sources: [
        { url: 'https://example.com/alpha', title: 'Alpha result' },
        { url: 'https://example.com/beta', title: 'Beta result' },
      ],
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to Bing when Google is unavailable or unparsable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('blocked', { status: 429 }))
      .mockResolvedValueOnce(new Response(BING_HTML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new GoogleBingSearchProvider(OPTIONS)

    await expect(provider.search({ query: 'alpha', maxResults: 2 })).resolves.toMatchObject({
      sources: [
        { url: 'https://example.com/bing-a', title: 'Bing Alpha' },
        { url: 'https://example.com/bing-b', title: 'Bing Beta' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports both engine failures', async () => {
    const fetchMock = vi.fn(async () => new Response('no results', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new GoogleBingSearchProvider(OPTIONS)

    let failure: unknown
    try {
      await provider.search({ query: 'alpha' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(WebError)
    expect((failure as Error).message).toContain('Google search failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not start Bing after caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new GoogleBingSearchProvider(OPTIONS)

    await expect(provider.search({ query: 'alpha' }, controller.signal)).rejects.toMatchObject({
      code: 'WEB_ABORTED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(provider.id).toBe(GOOGLE_BING_PROVIDER_ID)
  })
})
