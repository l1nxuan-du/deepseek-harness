/**
 * The fork's installer scripts are compiled by makensis only inside a Windows packaging run,
 * so a reference to a define nothing provides fails minutes into that run instead of at the
 * author's desk. `File` directives are the sharp case: an unresolved root compiles to a path
 * relative to the makensis working directory and aborts the build.
 *
 * This checks each `File` source against the defines the build actually supplies, which are
 * the file's own, the block `windows-directory-installer.mjs` prepends, and electron-builder's
 * command-line defines.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The scripts this repository authors; the rest of the installer comes from the pinned template. */
const AUTHORED_SCRIPTS = [
  new URL('../scripts/installer.nsh', import.meta.url),
  new URL('../scripts/installer-directories.nsh', import.meta.url),
] as const

/**
 * Defines electron-builder's `NsisTarget` and the pinned NSIS template put on the command line
 * or into the generated script. `FILE` is the parameter of the template's own
 * `installApplicationFiles` macro, bound at each insertion site.
 */
const BUILD_PROVIDED = new Set([
  'APP_64_UNPACKED_SIZE', 'APP_32_UNPACKED_SIZE', 'APP_ARM64_UNPACKED_SIZE',
  'APP_EXECUTABLE_FILENAME', 'APP_FILENAME', 'UNINSTALLER_ICON',
  'UNINSTALL_REGISTRY_KEY', 'FILE',
])

/** Defines `windows-directory-installer.mjs` prepends ahead of the generated script. */
const ADAPTER_PROVIDED = new Set(['DSH_UPDATER_CACHE_NAME', 'DSH_SEVENZIP_PATH', 'DSH_SEVENZIP_LICENSE_DIR'])

function sourceOf(url: URL): string {
  return readFileSync(url, 'utf8')
}

/** Every name the file declares itself, in either `!define` spelling. */
function declaredDefines(source: string): Set<string> {
  return new Set([...source.matchAll(/!define\s+(?:\/ifndef\s+)?([A-Za-z_][A-Za-z0-9_]*)/gu)].map(match => match[1]!))
}

/** The leading define of every `File` directive's source path, ignoring `/oname=` arguments. */
function fileDirectiveRoots(source: string): string[] {
  const roots: string[] = []
  for (const line of source.split('\n')) {
    const directive = /^\s*File\s+(.*)$/u.exec(line)
    if (directive === null) continue
    const source_ = /\s"([^"]+)"\s*$/u.exec(directive[1]!) ?? /(\S+)\s*$/u.exec(directive[1]!)
    const root = source_ === null ? undefined : /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/u.exec(source_[1]!)?.[1]
    if (root !== undefined) roots.push(root)
  }
  return roots
}

describe('authored installer scripts', () => {
  it.each(AUTHORED_SCRIPTS)('roots every File directive in a define the build supplies (%s)', (url) => {
    const source = sourceOf(url)
    const available = new Set([...declaredDefines(source), ...BUILD_PROVIDED, ...ADAPTER_PROVIDED])
    const unresolved = [...new Set(fileDirectiveRoots(source))].filter(root => !available.has(root))
    expect(unresolved).toEqual([])
  })

  it('points INSTALLER_BUILD_DIR at the directory the preparation step writes', () => {
    const source = sourceOf(AUTHORED_SCRIPTS[0])
    const declared = /!define\s+(?:\/ifndef\s+)?INSTALLER_BUILD_DIR\s+"([^"]+)"/u.exec(source)?.[1]
    expect(declared).toBeDefined()
    // `prepare-windows-installer.ps1` is invoked with `-OutputDirectory <buildPaths.root>/installer-ui`.
    expect(declared).toContain('.desktop-build')
    expect(declared!.endsWith('installer-ui')).toBe(true)
  })
})
