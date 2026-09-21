// @vitest-environment node
/** The frame geometry the skin's runtime-injected sheet must leave to the Windows caption. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const uiSkinRoot = join(import.meta.dirname, '..')
const materialSheet = readFileSync(join(uiSkinRoot, 'src', 'styles', 'material.css'), 'utf8')
const appFrameSheet = readFileSync(join(uiSkinRoot, '..', 'ui-layout', 'src', 'client', 'AppFrame.module.css'), 'utf8')
const sidebarSheet = readFileSync(join(uiSkinRoot, '..', 'ui-sidebar', 'src', 'client', 'SidebarRoot.module.css'), 'utf8')

/** Bodies of the rules whose selector mentions every fragment. */
function ruleBodies(sheet: string, ...fragments: string[]): string[] {
  const bodies: string[] = []
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (fragments.every(fragment => match[1]!.includes(fragment))) bodies.push(match[2]!)
  }
  return bodies
}

describe('material frame inset', () => {
  it('leaves the caption row to the Windows titlebar padding', () => {
    const [windowsRule] = ruleBodies(appFrameSheet, 'data-windows-titlebar', '.frame')
    expect(windowsRule).toContain('padding-top: var(--dsh-windows-titlebar-height) !important')
  })

  it('keeps the collapsed conversation off the window edge', () => {
    const [gapRule] = ruleBodies(appFrameSheet, 'data-windows-titlebar', 'data-sidebar-collapsed', '.centerCol')
    expect(gapRule).toContain('margin-left: var(--dsh-pane-inset, 8px)')
  })

  it('keeps both caption controls at the 28px rail size', () => {
    const [captionRule] = ruleBodies(sidebarSheet, 'data-windows-titlebar', '.collapsed .toggle', '.newSession')
    expect(captionRule).toContain('width: 28px !important')
    expect(captionRule).toContain('height: 28px !important')
    expect(captionRule).toContain('border-radius: 50% !important')
  })

  it('keeps the pane inset on the remaining frame sides', () => {
    const [frameRule] = ruleBodies(materialSheet, "[data-slot='root'] > [class*='_frame']")
    expect(frameRule).toMatch(/padding:\s+var\(--dsh-pane-inset\)/)
  })
})
