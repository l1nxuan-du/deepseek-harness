/** Shell-owned system tray: keeps the window reachable while the app runs in the background. */
import { app, Menu, Tray, nativeImage } from 'electron'
import type { DesktopLocale } from './locale.ts'

/** Tray presence and the two actions the tray owns. */
export interface DesktopTray {
  /** Icon and menu are installed and the process survives an empty window list. */
  readonly active: boolean
  /** Bring the application window back to the foreground. */
  open(): void
  /** Apply the current shell locale to the tray menu. */
  update(): void
  /** Remove the icon before the process quits. */
  dispose(): void
}

/** Callbacks the tray invokes on the shell's behalf. */
export interface DesktopTrayOptions {
  /** Absolute PNG shown in the notification area. */
  readonly iconPath: string
  /** Current shell copy; read on every menu rebuild so a language change is reflected. */
  readonly locale: () => DesktopLocale
  /** Reveal the application window. */
  readonly show: () => void
  /** Stop the application, including its Host process. */
  readonly quit: () => void
}

/** One tray icon whose menu stays valid while the shell locale changes. */
class ShellTray implements DesktopTray {
  private readonly tray: Tray
  private disposed = false

  constructor(private readonly options: DesktopTrayOptions) {
    this.tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray.setToolTip(app.getName())
    this.update()
    this.tray.on('click', () => { this.open() })
  }

  get active(): boolean { return true }

  open(): void {
    if (this.disposed) return
    this.options.show()
  }

  update(): void {
    if (this.disposed) return
    const { messages } = this.options.locale()
    this.tray.setToolTip(app.getName())
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: messages.trayOpen, click: () => { this.open() } },
      { type: 'separator' },
      { label: messages.trayExit, click: () => { this.options.quit() } },
    ]))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tray.destroy()
  }
}



/**
 * Install the shell tray when the platform can host one.
 * @param options - icon, copy, and the two shell actions the tray triggers.
 * @returns the installed tray, or undefined when the platform cannot support one.
 */
export function installDesktopTray(options: DesktopTrayOptions): DesktopTray | undefined {
  try {
    return new ShellTray(options)
  } catch (error) {
    console.error('Desktop tray unavailable:', error)
    return undefined
  }
}
