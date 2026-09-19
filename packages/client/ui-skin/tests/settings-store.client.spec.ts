/** Interface row store: the revision guard and the mirrored variant. */
import { describe, expect, it } from 'vitest'
import { createSkinRowStore } from '../src/client/settings-store.ts'

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
