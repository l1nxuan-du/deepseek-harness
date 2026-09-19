/**
 * Interface row slot store: a mirror of the skin runtime snapshot. The
 * plugin's change listener is the only writer; the row reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_SKIN_VARIANT, DEFAULT_STRENGTH, type SkinVariant } from '../skin-settings.ts'

/** Store state mirrored from the skin snapshot. */
export interface SkinRowState {
  /** Persisted variant (selection reads this, never a resolved default). */
  variant: SkinVariant
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type SkinRowActions = {
  sync: (draft: SkinRowState, variant: SkinVariant, revision: number) => void
}

/**
 * Declares the Interface row state and write surface.
 * @returns the store handle.
 */
export function createSkinRowStore(): EngineStoreHandle<SkinRowState, SkinRowActions> {
  return defineStore({
    init: (): SkinRowState => ({ variant: DEFAULT_SKIN_VARIANT, revision: -1 }),
    actions: {
      sync: (d, variant: SkinVariant, revision: number) => {
        if (revision <= d.revision) return
        d.variant = variant
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the skin snapshot's material strength. */
export interface StrengthRowState {
  /** Persisted strength in percent. */
  strength: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type StrengthRowActions = {
  sync: (draft: StrengthRowState, strength: number, revision: number) => void
}

/**
 * Declares the strength row state and write surface.
 * @returns the store handle.
 */
export function createStrengthRowStore(): EngineStoreHandle<StrengthRowState, StrengthRowActions> {
  return defineStore({
    init: (): StrengthRowState => ({ strength: DEFAULT_STRENGTH, revision: -1 }),
    actions: {
      sync: (d, strength: number, revision: number) => {
        if (revision <= d.revision) return
        d.strength = strength
        d.revision = revision
      },
    },
  })
}
