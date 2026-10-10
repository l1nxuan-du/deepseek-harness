/**
 * The product identity the Desktop build ships under.
 *
 * One home for the two names because electron-builder derives several artifacts
 * from them: the NSIS `Name`/window title, the application bundle and executable
 * file names, and — through `executableName` — the Windows installation
 * directory (`$PROGRAMFILES64\${APP_FILENAME}`), which must stay the kebab-case
 * folder rather than the display name.
 *
 * The Electron main process reports the display name on its about panel, but it
 * cannot import this module: tsdown bundles only `lib/`, so a relative request
 * out of it resolves to nothing at runtime. `src/main.ts` repeats the display
 * name as a literal and `desktop-product-identity.spec.ts` holds the two in step.
 */

import identity from './desktop-product-identity.json' with { type: 'json' }

/** Display name shown by the window, menus, installer, and macOS bundle. */
export const DESKTOP_PRODUCT_NAME = identity.productName

/** Application bundle and executable file name, and the Windows install folder. */
export const DESKTOP_EXECUTABLE_NAME = identity.executableName
