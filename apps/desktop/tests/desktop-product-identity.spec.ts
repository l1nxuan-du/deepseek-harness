import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESKTOP_EXECUTABLE_NAME, DESKTOP_PRODUCT_NAME } from '../scripts/desktop-product-identity.mjs'

const identity = JSON.parse(
  readFileSync(new URL('../scripts/desktop-product-identity.json', import.meta.url), 'utf8'),
) as { productName: string; executableName: string }

/**
 * The Electron main bundle cannot import the identity module, so `tsdown.config.ts`
 * inlines the same two values. Nothing else links the two sources; this does.
 */
describe('desktop product identity', () => {
  it('uses the shipped display name as the product name', () => {
    expect(DESKTOP_PRODUCT_NAME).toBe('DSH Remake')
    expect(identity.productName).toBe(DESKTOP_PRODUCT_NAME)
  })

  it('uses the kebab-case name for the bundle, executable, and Windows install folder', () => {
    expect(DESKTOP_EXECUTABLE_NAME).toBe('dsh-remake')
    expect(identity.executableName).toBe(DESKTOP_EXECUTABLE_NAME)
    // electron-builder takes the Windows default installation directory from the
    // executable name, so a display-style name here would move `C:\Program Files\dsh-remake`.
    expect(DESKTOP_EXECUTABLE_NAME).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('is the name the Electron main process reports in its about panel', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    // main.ts is bundled by tsdown, which packages only `lib/`; a relative request
    // out of it to this directory resolves to nothing at runtime.
    expect(main).not.toContain('scripts/desktop-product-identity')
    expect(main).toContain(`applicationName: '${DESKTOP_PRODUCT_NAME}'`)
  })
})
