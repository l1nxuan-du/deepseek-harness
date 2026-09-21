/** Shell-owned modal windows cover the parent's content without replacing its native window controls. */
import { BrowserWindow } from 'electron'

/**
 * @param parent - Product window whose content is blocked while the overlay is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @returns A transparent child that follows its parent's content bounds and releases its listeners on close.
 */
export function createUpdateOverlay(parent: BrowserWindow, preload: string, title: string): BrowserWindow {
  const window = new BrowserWindow({
    parent, modal: true, show: false, frame: false, transparent: true,
    ...parent.getContentBounds(), resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, hasShadow: false, title,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  const follow = (): void => { if (!window.isDestroyed()) window.setBounds(parent.getContentBounds()) }
  parent.on('move', follow)
  parent.on('resize', follow)
  // The blur has to be undone on the same path that reaches the parent, and the key only
  // exists after insertion resolves. Tracking 'pending', the key, and 'removed' keeps a
  // close that lands inside that gap from leaving the parent filtered forever.
  let blurKey: string | undefined
  let blurDone = false
  const unblur = (): void => {
    blurDone = true
    const key = blurKey
    blurKey = undefined
    if (key === undefined || parent.isDestroyed()) return
    void parent.webContents.removeInsertedCSS(key).catch((error: unknown) => { console.warn('desktop update: could not remove background blur', error) })
  }
  void parent.webContents.insertCSS('body { filter: blur(2px) !important; }').then((key) => {
    if (blurDone) {
      if (!parent.isDestroyed()) void parent.webContents.removeInsertedCSS(key).catch((error: unknown) => { console.warn('desktop update: could not remove background blur', error) })
      return
    }
    blurKey = key
  }).catch((error: unknown) => { console.warn('desktop update: could not blur background', error) })
  window.once('closed', () => { unblur() })
  window.once('closed', () => { parent.off('move', follow); parent.off('resize', follow) })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/// How long an overlay may stay silent before the shell assumes it will never present itself.
const OVERLAY_LOAD_TIMEOUT_MS = 15_000

/**
 * Close an overlay that never became ready. A transparent, frameless child blocks the parent
 * window whether or not it paints, so one that cannot load its document leaves a window the
 * user can neither see nor operate. Its close also releases the parent's input.
 * @param window - Overlay opened for a shell prompt.
 * @param ready - Resolves once the overlay document has presented itself.
 * @returns nothing; the overlay is destroyed when it stays unready past the timeout.
 */
export function closeUnreadyOverlay(window: BrowserWindow, ready: Promise<unknown>): void {
  let settled = false
  const timer = setTimeout(() => {
    if (settled || window.isDestroyed()) return
    window.destroy()
  }, OVERLAY_LOAD_TIMEOUT_MS)
  const finish = (): void => { settled = true; clearTimeout(timer) }
  void ready.then(finish, () => {
    finish()
    if (!window.isDestroyed()) window.destroy()
  })
}

/** A native Windows modal retains its own title bar while the product window remains blocked. */
export function createMandatoryUpdateWindow(parent: BrowserWindow, preload: string, title: string,
  platform: NodeJS.Platform = process.platform): BrowserWindow {
  if (platform !== 'win32') return createUpdateOverlay(parent, preload, title)
  const window = new BrowserWindow({
    parent, modal: true, show: false, title,
    width: 640, height: 560, minWidth: 480, minHeight: 360,
    movable: true, resizable: true, maximizable: true,
    backgroundColor: '#f5f5f5',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
