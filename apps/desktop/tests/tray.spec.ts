// @vitest-environment node
/** The tray module owns two commands and must not leak its icon past disposal. */
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopLocale } from '../src/locale.ts'
import { en } from '../src/locale.ts'

const harness = vi.hoisted(() => {
  const trays: FakeTray[] = []
  class FakeTray {
    toolTip = ''
    menu: { label?: string; type?: string; click?: () => void }[] = []
    destroyed = false
    clickHandler: (() => void) | undefined
    constructor(readonly icon: unknown) { trays.push(this) }
    setToolTip(value: string): void { this.toolTip = value }
    setContextMenu(menu: { items?: { label?: string; type?: string; click?: () => void }[] }): void {
      this.menu = menu.items ?? []
    }
    on(event: string, handler: () => void): void { if (event === 'click') this.clickHandler = handler }
    destroy(): void { this.destroyed = true }
  }
  const menu = { buildFromTemplate: vi.fn((template: unknown[]) => ({ items: template })) }
  return {
    trays,
    FakeTray,
    menu,
    app: { getName: () => 'DeepSeek Harness' },
    nativeImage: { createFromPath: vi.fn((path: string) => ({ path })) },
  }
})

vi.mock('electron', () => ({
  app: harness.app,
  Menu: harness.menu,
  Tray: harness.FakeTray,
  nativeImage: harness.nativeImage,
}))

const { installDesktopTray } = await import('../src/tray.ts')

afterEach(() => {
  harness.trays.length = 0
  harness.menu.buildFromTemplate.mockClear()
})

const locale: DesktopLocale = { id: 'en', messages: en }

it('offers Open Window and Exit with the shell locale copy', () => {
  const tray = installDesktopTray({ iconPath: 'tray.png', locale: () => locale, show: () => {}, quit: () => {} })
  expect(tray?.active).toBe(true)
  const created = harness.trays[0]!
  expect(created.toolTip).toBe('DeepSeek Harness')
  expect(created.menu.map(item => item.label ?? item.type)).toEqual([en.trayOpen, 'separator', en.trayExit])
  expect(harness.nativeImage.createFromPath).toHaveBeenCalledWith('tray.png')
})

it('opens the window from the menu command and from a tray click', () => {
  const show = vi.fn()
  const tray = installDesktopTray({ iconPath: 'tray.png', locale: () => locale, show, quit: () => {} })
  const created = harness.trays[0]!
  created.menu[0]!.click!()
  created.clickHandler!()
  expect(show).toHaveBeenCalledTimes(2)
  tray?.open()
  expect(show).toHaveBeenCalledTimes(3)
})

it('quits only from the Exit command and releases the icon', () => {
  const quit = vi.fn()
  const tray = installDesktopTray({ iconPath: 'tray.png', locale: () => locale, show: () => {}, quit })
  const created = harness.trays[0]!
  expect(quit).not.toHaveBeenCalled()
  created.menu[2]!.click!()
  expect(quit).toHaveBeenCalledOnce()
  tray!.dispose()
  expect(created.destroyed).toBe(true)
  tray!.dispose()
  expect(harness.trays).toHaveLength(1)
})

it('survives a platform that cannot host a tray', () => {
  const failing = vi.spyOn(harness.nativeImage, 'createFromPath').mockImplementationOnce(() => { throw new Error('no tray') })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const tray = installDesktopTray({ iconPath: 'tray.png', locale: () => locale, show: () => {}, quit: () => {} })
  expect(tray).toBeUndefined()
  expect(error).toHaveBeenCalled()
  failing.mockRestore()
  error.mockRestore()
})
