/**
 * Build one publishable package that carries a whole fork release family.
 *
 * The family's entry package declares its siblings at the fork version, and
 * those siblings exist only as this repository's packed tarballs, so a consumer
 * that installs the entry package from a registry cannot resolve them. This
 * step copies the family tarballs into the published package's own
 * `node_modules` and declares them as bundled dependencies, which lets one
 * package name install the fork. Every other dependency stays an ordinary
 * registry dependency, resolved from the tree npm produces here.
 *
 * Usage: `tsx scripts/release/bundle-fork.ts --from <packed directory> [--from ...]
 * --name <package name> [--out <directory>] [--registry <url>] [--skip-verify]`.
 * The platform of the resolved tree decides which platform-specific packages the
 * bundle declares, so one bundle serves the platform it was built on.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity } from './tarball.ts'

const ENTRY_FAMILY = 'dsh'
const VENDOR_FAMILY = 'vendor'

/** One packed tarball selected for bundling. */
interface BundleInput {
  readonly tarball: string
  readonly name: string
  readonly version: string
}

/** Options resolved from the command line. */
interface BundleOptions {
  readonly directories: readonly string[]
  readonly name: string
  readonly out: string
  readonly registry: string | undefined
  readonly verify: boolean
}

/**
 * Run the npm CLI. Windows installs npm as a `.cmd` shim, which Node refuses to
 * spawn without a shell, so the CLI script next to the running Node wins.
 * @param args - npm arguments.
 * @param cwd - working directory.
 * @returns Trimmed standard output.
 */
function runNpm(args: readonly string[], cwd: string): string {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(cli)) return capture(process.execPath, [cli, ...args], { cwd })
  return capture(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd })
}

/** Parse and validate the command line. */
function parseOptions(argv: readonly string[]): BundleOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      from: { type: 'string', multiple: true },
      name: { type: 'string' },
      out: { type: 'string' },
      registry: { type: 'string' },
      'skip-verify': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.length === 0) {
    throw new Error('usage: bundle-fork.ts --from <packed directory> [--from ...] --name <package name> [--out <directory>] [--registry <url>] [--skip-verify]')
  }
  if (values.name === undefined || !values.name.includes('/')) {
    throw new Error('bundle-fork: --name must be a scoped package name such as @scope/dsh')
  }
  return {
    directories: values.from.map(directory => resolve(process.cwd(), directory)),
    name: values.name,
    out: resolve(process.cwd(), values.out ?? 'dist'),
    registry: values.registry,
    verify: !values['skip-verify'],
  }
}

/** Package names the two release families publish, which are the names to bundle. */
function familyNames(root: string): Set<string> {
  const names = new Set<string>()
  for (const id of [ENTRY_FAMILY, VENDOR_FAMILY]) {
    for (const member of releaseFamily(id).members(root)) names.add(member.name)
  }
  return names
}

/**
 * Select the family tarballs to bundle, and report the tarballs a packed
 * directory holds for packages outside the families.
 * @param directories - packed directories to read.
 * @param families - names the release families publish.
 * @returns The bundled inputs and the skipped package names.
 */
function selectInputs(directories: readonly string[], families: ReadonlySet<string>): { bundled: BundleInput[]; skipped: string[] } {
  const bundled: BundleInput[] = []
  const skipped: string[] = []
  for (const directory of directories) {
    if (!existsSync(directory)) throw new Error(`bundle-fork: ${directory} does not exist; run release:pack first`)
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      if (families.has(name)) bundled.push({ tarball, name, version })
      else skipped.push(`${name}@${version}`)
    }
  }
  if (bundled.length === 0) throw new Error('bundle-fork: the packed directories hold no release-family tarball')
  return { bundled, skipped }
}

/**
 * Write the throwaway consumer that resolves the family's external dependencies,
 * then install it.
 * @param root - consumer directory.
 * @param inputs - family tarballs to install.
 * @param registry - registry override for the install, or undefined.
 */
function installConsumer(root: string, inputs: readonly BundleInput[], registry: string | undefined): void {
  const dependencies = Object.fromEntries(inputs.map(input => [input.name, `file:${input.tarball.replaceAll('\\', '/')}`]))
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fork-bundle-resolve', version: '0.0.0', private: true, dependencies }, undefined, 2)}\n`)
  const args = ['install', '--no-audit', '--no-fund', '--package-lock=false']
  if (registry !== undefined) args.push('--registry', registry)
  runNpm(args, root)
}

/** Read one installed package's declared name and version. */
function installedIdentity(directory: string): { name: string; version: string } | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return undefined
    return { name: manifest.name, version: manifest.version }
  }
  catch {
    return undefined
  }
}

/**
 * Read every installed package's name and version, preferring the version npm
 * hoisted to the top level when a nested copy also exists.
 * @param modules - installed `node_modules` directory.
 * @returns Installed package name to version.
 */
function installedPackages(modules: string): Map<string, string> {
  const packages = new Map<string, string>()
  const nested: string[] = []
  const collect = (directory: string, recordHere: boolean): void => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const full = join(directory, entry.name)
      if (entry.name.startsWith('@')) { collect(full, recordHere); continue }
      if (recordHere) {
        const identity = installedIdentity(full)
        if (identity !== undefined && !packages.has(identity.name)) packages.set(identity.name, identity.version)
      }
      const inner = join(full, 'node_modules')
      if (existsSync(inner)) nested.push(inner)
    }
  }
  collect(modules, true)
  for (const directory of nested) collect(directory, true)
  return packages
}

/** Read one installed package's manifest. */
function packageManifest(directory: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`bundle-fork: ${directory} has no package manifest`)
  return parsed as Record<string, unknown>
}

/** Write the bundle package: launcher, manifest, and the copied family packages. */
function writeBundlePackage(
  options: BundleOptions,
  entryName: string,
  binPath: string,
  version: string,
  inputs: readonly BundleInput[],
  external: ReadonlyMap<string, string>,
  consumerModules: string,
): string {
  const directory = join(options.out, `${options.name.replace('@', '').replace('/', '-')}-${version}`)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(join(directory, 'bin'), { recursive: true })
  mkdirSync(join(directory, 'node_modules'), { recursive: true })

  const entry = packageManifest(join(consumerModules, ...entryName.split('/')))
  for (const input of inputs) {
    const from = join(consumerModules, ...input.name.split('/'))
    if (!existsSync(from)) throw new Error(`bundle-fork: the resolved tree omits ${input.name}`)
    cpSync(from, join(directory, 'node_modules', ...input.name.split('/')), { recursive: true, dereference: true })
  }

  const dependencies: Record<string, string> = {}
  for (const input of inputs) dependencies[input.name] = input.version
  for (const [name, resolved] of [...external].sort(([left], [right]) => left.localeCompare(right))) dependencies[name] = resolved

  const manifest = {
    name: options.name,
    version,
    description: `${typeof entry.description === 'string' ? entry.description : ''} (fork bundle: one package carries the whole release family)`.trim(),
    license: entry.license,
    type: 'module',
    bin: { dsh: 'bin/dsh.js' },
    files: ['bin'],
    engines: entry.engines,
    publishConfig: { access: 'public' },
    dependencies,
    bundledDependencies: inputs.map(input => input.name),
  }
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(directory, 'bin', 'dsh.js'), `#!/usr/bin/env node
// Launch the bundled family entry; it reads its own manifest for version reporting.
const cli = await import(${JSON.stringify(`${entryName}/${binPath}`)})

await cli.runCli()
`)
  return directory
}

/** Pack the bundle package and return the tarball path. */
function packBundle(directory: string, out: string): string {
  const filename = runNpm(['pack', '--pack-destination', out], directory).split('\n').at(-1)?.trim()
  if (filename === undefined || filename === '') throw new Error('bundle-fork: npm pack reported no filename')
  return join(out, filename)
}

/**
 * Install the bundle into a throwaway consumer and run its launcher, which
 * proves the published package carries everything the entry package needs.
 * @param tarball - bundle tarball.
 * @param options - bundle options.
 * @param binPath - the entry package's declared bin path.
 * @param version - the version the launcher must report.
 */
function verifyBundle(tarball: string, options: BundleOptions, binPath: string, version: string): void {
  const root = mkdtempSync(join(tmpdir(), 'fork-bundle-verify-'))
  try {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fork-bundle-consumer', version: '0.0.0', private: true }, undefined, 2)}\n`)
    const args = ['install', '--no-audit', '--no-fund', '--package-lock=false', tarball]
    if (options.registry !== undefined) args.push('--registry', options.registry)
    runNpm(args, root)
    const launcher = join(root, 'node_modules', ...options.name.split('/'), 'bin', 'dsh.js')
    const reported = capture(process.execPath, [launcher, '--version'], { cwd: root }).trim()
    if (reported !== version) throw new Error(`bundle-fork: installed launcher reported ${reported}, expected ${version}`)
    console.log(`bundle-fork: verified ${options.name}@${reported} through a throwaway install (entry bin ${binPath})`)
  }
  finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Build one bundle package from the packed family tarballs. */
function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const root = process.cwd()
  const families = familyNames(root)
  const { bundled, skipped } = selectInputs(options.directories, families)

  const entry = releaseFamily(ENTRY_FAMILY).installedEntry
  if (entry === undefined) throw new Error('bundle-fork: the dsh family declares no installed entry')
  const entryInput = bundled.find(input => input.name === entry.packageName)
  if (entryInput === undefined) throw new Error(`bundle-fork: the packed inputs omit ${entry.packageName}`)

  mkdirSync(options.out, { recursive: true })
  const resolutionRoot = mkdtempSync(join(tmpdir(), 'fork-bundle-resolve-'))
  let tarball: string
  let bundleDirectory: string
  let externalCount = 0
  try {
    installConsumer(resolutionRoot, bundled, options.registry)
    const modules = join(resolutionRoot, 'node_modules')
    const installed = installedPackages(modules)
    const bundledNames = new Set(bundled.map(input => input.name))
    const external = new Map([...installed].filter(([name]) => !bundledNames.has(name)))
    externalCount = external.size
    bundleDirectory = writeBundlePackage(options, entry.packageName, entry.binPath, entryInput.version, bundled, external, modules)
    tarball = packBundle(bundleDirectory, options.out)
  }
  finally {
    rmSync(resolutionRoot, { recursive: true, force: true })
  }

  const { size } = statSync(tarball)
  console.log(`bundle-fork: ${String(bundled.length)} family package(s) bundled, ${String(externalCount)} registry dependency(ies) declared`)
  if (skipped.length > 0) console.log(`bundle-fork: ignored ${String(skipped.length)} non-family tarball(s): ${skipped.join(', ')}`)
  console.log(`bundle-fork: ${tarball} (${(size / 1024 / 1024).toFixed(2)} MB)`)
  if (options.verify) verifyBundle(tarball, options, entry.binPath, entryInput.version)
  console.log(`bundle-fork: publish with \`npm publish ${tarball} --access public --tag latest\` (npm requires an explicit tag for a prerelease; \`--tag next\` keeps \`latest\` free), then consumers run \`npx ${options.name} web\``)
}

if (isEntry(import.meta.url)) main()
