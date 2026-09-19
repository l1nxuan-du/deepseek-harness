/**
 * Interface-skin runtime: owns the selected variant, publishes immutable
 * snapshots for the settings row, and projects the selection onto the document
 * — the root attribute the material stylesheet selects on, the material
 * alias-token layer, and the field backdrop. The material chrome is the
 * default; selecting the classic variant leaves every one of those removed, so
 * the shipped chrome renders exactly as it does without this plugin.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.theme Context merge (the token override entry point).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CLASSIC_SKIN_VARIANT, DEFAULT_SKIN_VARIANT, SKIN_ATTRIBUTE, SKIN_VARIANT_FIELD, isSkinVariant,
  type SkinSettings, type SkinVariant,
} from '../skin-settings.ts'
import { createFieldBackdrop, type FieldBackdrop } from './field-backdrop.ts'
import { MATERIAL_TOKEN_OVERRIDES } from './material-tokens.ts'

/** Immutable skin state published on every accepted change. */
export interface SkinSnapshot {
  /** The selected interface skin. */
  variant: SkinVariant
  /** Monotonic change counter. */
  revision: number
}

/** Alias-token layer source; one live layer at a time. */
const TOKEN_SOURCE = 'ui-skin'

/**
 * Read the selection the Host boot script published on the root element, so
 * the first projection matches the chrome the page already painted instead of
 * flashing the schema default while the durable value is still in flight.
 * Non-browser runs and pages without the bootstrap fall back to the default.
 */
function bootstrapVariant(): SkinVariant {
  /* v8 ignore next 2 -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
  if (typeof document === 'undefined') return DEFAULT_SKIN_VARIANT
  const published = document.documentElement.getAttribute(SKIN_ATTRIBUTE)
  return isSkinVariant(published) ? published : DEFAULT_SKIN_VARIANT
}

/** Applies the material chrome; one instance per plugin fiber. */
export class SkinRuntime {
  private variant: SkinVariant
  private revision = 0
  private snapshot: SkinSnapshot
  private tokens: (() => void) | undefined
  private field: FieldBackdrop | undefined

  /**
   * @param ctx - owning context (theme token layers and the scope listener are released through it).
   * @param host - durable variant scope owned by the same plugin.
   * @param onChange - sink notified after every accepted variant change.
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly host: SettingsScope<SkinSettings>,
    private readonly onChange: (snapshot: SkinSnapshot) => void = () => {},
  ) {
    this.variant = bootstrapVariant()
    this.snapshot = { variant: this.variant, revision: this.revision }
    this.ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-skin: settings scope adoption')
    // The flow pattern carries its own palette, so the field follows the
    // resolved colour scheme instead of only the stylesheet's tokens.
    this.ctx.effect(() => this.ctx.on('theme/change', (snapshot) => {
      this.field?.setColorScheme(snapshot.active.colorScheme)
    }), 'ui-skin: field colour scheme')
    // Project the default before the durable value arrives: a scope that is
    // still loading, exposed as memory-only, or absent entirely must still
    // render the product default.
    this.project()
    this.adopt()
  }

  /**
   * Read the current immutable skin snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getSkin(): SkinSnapshot {
    return this.snapshot
  }

  /**
   * Switch the interface skin — the only user preference write entry. The
   * write goes through the settings scope; unknown variants throw.
   * @param variant - a selectable skin.
   */
  setSkin(variant: SkinVariant): void {
    // Model-authored callers pass untyped JS through the dynamic-package façade,
    // so the guard reads the value as unknown before narrowing it.
    const requested: unknown = variant
    if (!isSkinVariant(requested)) {
      const label = typeof requested === 'string' ? requested : String(requested)
      throw new Error(`skin "${label}" is not selectable`)
    }
    if (this.variant === requested) return
    this.variant = requested
    void this.host.set(SKIN_VARIANT_FIELD, variant)
    this.publish()
  }

  /** Retract every document-level write this runtime installed. */
  dispose(): void {
    this.tokens?.()
    this.tokens = undefined
    this.field?.dispose()
    this.field = undefined
  }

  /** Adopt the scope's accepted durable variant without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || section.variant === this.variant) return
    this.variant = section.variant
    this.publish()
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = { variant: this.variant, revision: this.revision }
    this.project()
    this.onChange(this.snapshot)
  }

  /** Project the variant onto the document: attribute, tokens, and field. */
  private project(): void {
    /* v8 ignore next 2 -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.setAttribute(SKIN_ATTRIBUTE, this.variant)
    if (this.variant === CLASSIC_SKIN_VARIANT) {
      this.tokens?.()
      this.tokens = undefined
      this.field?.dispose()
      this.field = undefined
      return
    }
    this.tokens ??= this.ctx.theme.overrideTokens(TOKEN_SOURCE, MATERIAL_TOKEN_OVERRIDES)
    this.field ??= createFieldBackdrop(this.ctx.theme.getTheme().active.colorScheme)
  }
}
