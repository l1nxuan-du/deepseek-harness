/** Interface row store: the revision guard and the mirrored variant. */
import { describe, expect, it } from 'vitest'
import { createSkinRowStore, createStrengthRowStore } from '../src/client/settings-store.ts'

describe('interface row store', () => {
  it('opens on the material default at the pre-sync revision', () => {
    const store = createSkinRowStore().create()
    expect(store.getSnapshot()).toEqual({ variant: 'material', revision: -1 })
  })

  it('adopts newer revisions and drops stale or duplicate ones', () => {
    const store = createSkinRowStore().create()
    store.actions.sync('material', 0)
    expect(store.getSnapshot()).toEqual({ variant: 'material', revision: 0 })
    store.actions.sync('classic', 1)
    expect(store.getSnapshot()).toEqual({ variant: 'classic', revision: 1 })
    store.actions.sync('material', 1)
    expect(store.getSnapshot()).toEqual({ variant: 'classic', revision: 1 })
    store.actions.sync('material', 0)
    expect(store.getSnapshot()).toEqual({ variant: 'classic', revision: 1 })
  })
})

describe('material strength row store', () => {
  it('opens on the default strength at the pre-sync revision', () => {
    const store = createStrengthRowStore().create()
    expect(store.getSnapshot()).toEqual({ strength: 60, revision: -1 })
  })

  it('adopts newer revisions and drops stale ones', () => {
    const store = createStrengthRowStore().create()
    store.actions.sync(30, 0)
    expect(store.getSnapshot()).toEqual({ strength: 30, revision: 0 })
    store.actions.sync(80, 1)
    expect(store.getSnapshot()).toEqual({ strength: 80, revision: 1 })
    store.actions.sync(10, 1)
    expect(store.getSnapshot()).toEqual({ strength: 80, revision: 1 })
    store.actions.sync(10, 0)
    expect(store.getSnapshot()).toEqual({ strength: 80, revision: 1 })
  })
})
