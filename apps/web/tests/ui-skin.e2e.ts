// Web e2e scenario: the interface-skin choice. The plugin ships both chromes
// and opens on the product default (the material chrome); the Interface row in
// Settings moves the document onto the classic chrome and back. The assertions
// cover the projection (root attribute, field backdrop, pane geometry) rather
// than a pixel golden, because the sheet's contract is which chrome the
// document selected, not one rendering of it.
import { basename, dirname } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SEED_ID = 'ui-skin-web-e2e'

/** One settled user turn, so the scenario has a real session title and pane. */
function seedLog(): string {
  const time = 1784974100000
  const at = (index: number, event: Record<string, unknown>): string =>
    JSON.stringify({ ...event, seq: index, time: time + index })
  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: time, cwd: '{{cwd}}/workspace', isSeeded: false, delegationDepth: 0,
    }),
    at(0, { type: 'turn/start', data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'seed' } } } }),
    at(1, { type: 'step/start', data: { turn: 1, step: 1 } }),
    at(2, {
      type: 'system/message',
      data: { turn: 1, step: 1, message: createSystemMessage('', '@deepseek-ai/dsh-system-prompt') },
      surfaceOp: 'append',
    }),
    at(3, {
      type: 'user/message',
      data: {
        id: '00000000-0000-4000-9000-000000000001',
        role: 'user',
        content: [{ type: 'text', text: 'Reply with exactly one word: PONG' }],
        source: { kind: 'user', rpcId: 'seed' },
      },
      surfaceOp: 'append',
    }),
    at(4, { type: 'session/title', data: { title: 'One-word reply test PONG', messageSeqs: [3], source: { kind: 'fallback' } } }),
    at(5, { type: 'step/end', data: { turn: 1, step: 1 } }),
    at(6, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\n')
}

/** Mirrors the Client constant of the same name (this lane never imports Client packages). */
const SKIN_ATTRIBUTE = 'data-dsh-skin'
/** Marks the material backdrop element. */
const FIELD_SELECTOR = '[data-dsh-field]'

/** Open the seeded session through the sidebar's session search. */
async function openSeededSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill('Reply with exactly one word: PONG')
  await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
}

/**
 * Conversation pane, right panel, and the gap the material chrome keeps between
 * them. Returns null until the panel has settled: while it slides in, the frame
 * has not reserved its track yet and the box still sits off the frame's edge.
 * @param page - the scenario page.
 * @returns the settled measurements, or null while the panel is still moving.
 */
async function geometry(page: Page): Promise<{
  gap: number
  paneRadius: string
  panelRadius: string
  panelBlur: string
} | null> {
  return await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[class*="_frame"]')
    const pane = document.querySelector<HTMLElement>('[class*="_centerCol"]')
    const panel = document.querySelector<HTMLElement>('[data-sidebar-right-panel="push"]')
    if (frame === null || pane === null || panel === null) return null
    if (!panel.hasAttribute('data-sidebar-right-open')) return null
    if (frame.hasAttribute('data-rightbar-collapsed')) return null
    if (getComputedStyle(panel).transform !== 'none') return null
    const paneBox = pane.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    return {
      gap: Math.round((panelBox.left - paneBox.right) * 10) / 10,
      paneRadius: getComputedStyle(pane).borderTopLeftRadius,
      panelRadius: getComputedStyle(panel).borderTopLeftRadius,
      panelBlur: getComputedStyle(panel).backdropFilter,
    }
  })
}

describe('web e2e: interface skin', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, seedLog(), SEED_ID, 'anchored-standard')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The seeded session belongs to the scaffold's workspace directory itself.
    await connectFreshWorkspace(page, dirname(scaffold.workspaceCwd), basename(scaffold.workspaceCwd))
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens on the material chrome the deployment defaults to', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ui-skin-material'))
    await expect.poll(() => page.getAttribute('html', SKIN_ATTRIBUTE)).toBe('material')
    await expect.poll(() => page.locator(FIELD_SELECTOR).count()).toBe(1)
    const insetPane = await page.locator('[class*="_centerCol"]').evaluate((pane) => {
      const style = getComputedStyle(pane)
      return { radius: style.borderTopLeftRadius, backdrop: style.backdropFilter, background: style.backgroundColor }
    })
    expect(insetPane.radius).toBe('24px')
    expect(insetPane.backdrop).toContain('blur')
    // Light keeps the study's mica film, scaled by the default strength (80).
    expect(insetPane.background).toBe('rgba(255, 255, 255, 0.4)')
    // The field is the wash plus the flow pattern: no lattice, and the pattern
    // canvas is sized and visible wherever the browser renders WebGL2.
    await expect.poll(() => page.locator('[data-dsh-field-layer="grid"]').count()).toBe(0)
    const pattern = await page.locator('[data-dsh-field-layer="pattern"]').evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement
      return { hidden: element.hidden, width: element.width, height: element.height }
    })
    expect(pattern.hidden).toBe(false)
    expect(pattern.width).toBeGreaterThan(0)
    expect(pattern.height).toBeGreaterThan(0)
    // The input is mica: a mostly opaque fill under a short blur, so transcript
    // rows scrolling behind it cannot be read through the card.
    const composer = await page.locator('[data-composer-card]').first().evaluate((card) => {
      const style = getComputedStyle(card)
      const frost = getComputedStyle(card, '::before')
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
        blur: style.backdropFilter,
        frost: frost.backdropFilter,
      }
    })
    // The fill is the card's own token: mica, not the shipped acrylic.
    expect(composer.background).toBe('rgba(255, 255, 255, 0.5)')
    // Elevated surfaces take their boundary from the elevation shadow, never
    // from a border, and the frost rides the pseudo-element.
    expect(composer.border).toBe('0px')
    expect(composer.blur).toBe('none')
    expect(composer.frost).toBe('blur(24px) saturate(1.8)')
  })

  it('moves to the classic chrome from Settings and back', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ui-skin-classic'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 20_000 })

    await dialog.getByRole('button', { name: 'Classic', exact: true }).click()
    await expect.poll(() => page.getAttribute('html', SKIN_ATTRIBUTE), { timeout: 10_000 }).toBe('classic')
    await expect.poll(() => page.locator(FIELD_SELECTOR).count()).toBe(0)
    // The classic chrome keeps the frame's own geometry: no pane inset, no rounded centre.
    const classic = await page.locator('[class*="_frame"]').evaluate(frame => getComputedStyle(frame).paddingLeft)
    expect(classic).toBe('0px')
    expect(await page.locator('[class*="_centerCol"]').evaluate(pane => getComputedStyle(pane).borderTopLeftRadius))
      .toBe('0px')

    await dialog.getByRole('button', { name: 'New', exact: true }).click()
    await expect.poll(() => page.getAttribute('html', SKIN_ATTRIBUTE), { timeout: 10_000 }).toBe('material')
    await expect.poll(() => page.locator(FIELD_SELECTOR).count()).toBe(1)

    // The strength row scales the material, and the root variable it writes is
    // what the sheet derives the panes' fill and blur from.
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-skin-strength')))
      .toBe('80')
    await dialog.getByRole('button', { name: 'Strengthen the material' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-skin-strength')))
      .toBe('90')
    const scaled = await page.locator('[class*="_centerCol"]').evaluate(pane => getComputedStyle(pane).backgroundColor)
    expect(scaled).toBe('rgba(255, 255, 255, 0.45)')
    await dialog.getByRole('button', { name: 'Weaken the material' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-skin-strength')))
      .toBe('80')

    await dialog.getByRole('button', { name: 'Close' }).last().click()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('styles the right panel as the conversation pane and keeps a 5px gap', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ui-skin-rightbar'))
    await openSeededSession(page)
    await page.locator('[data-sidebar-right-expand]').click()
    await page.locator('[data-sidebar-right-open]').waitFor({ timeout: 10_000 })
    await expect.poll(() => geometry(page), { timeout: 10_000 }).not.toBeNull()
    const measured = await geometry(page)
    if (measured === null) throw new Error('right panel geometry missing')
    expect(measured).toMatchObject({ gap: 5 })
    expect(measured.panelRadius).toBe(measured.paneRadius)
    expect(measured.panelBlur).toContain('blur')
    // The session titles are plain rows in the material chrome.
    const titleDecoration = await page.locator('[data-slot="sidebar"] [class*="_sessionRow"] [class*="_title"]').first()
      .evaluate(title => getComputedStyle(title).textDecorationLine)
    expect(titleDecoration).toBe('none')
    // An active session's composer seat paints the shipped 36px fade into the
    // page fill; the material chrome drops it, so the field stays continuous
    // behind the input.
    const seat = await page.locator('[class*="_composerSeat"]').first().evaluate((element) => {
      const style = getComputedStyle(element)
      const band = getComputedStyle(element, '::before')
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        blur: style.backdropFilter,
        bandImage: band.backgroundImage,
      }
    })
    // The seat is clear: the card is the material, and the shipped fade plus
    // any band stay off.
    expect(seat.backgroundImage).toBe('none')
    expect(seat.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(seat.blur).toBe('none')
    expect(seat.bandImage).toBe('none')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
