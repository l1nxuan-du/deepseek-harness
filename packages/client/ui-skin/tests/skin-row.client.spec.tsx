// @vitest-environment jsdom
/** Interface row: copy, selection from the store mirror, and the write face. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SkinRow, type SkinRowComponentProps } from '../src/client/SkinRow.tsx'
import { createSkinRowStore } from '../src/client/settings-store.ts'
import type { SkinVariant } from '../src/skin-settings.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'interface.title': 'Interface',
  'interface.description': 'The new interface adds the glass chrome and gradient field; classic stays unchanged',
  'interface.classic': 'Classic',
  'interface.material': 'New',
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, phase: 'ready', subagentsByParent: {}, jobsBySession: {} })
  return bindSnapshotSelector(store)
}

function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<SkinRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: SkinRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mount(variant: SkinVariant = 'classic') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createSkinRowStore().create()
  store.actions.sync(variant, 0)
  const setSkin = vi.fn()
  const props: SkinRowComponentProps = {
    useSessions: emptySessions(),
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setSkin,
  }
  render(<SkinRow {...props} />)
  return { store, setSkin }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('SkinRow', () => {
  it('renders the title, the description, and two cubes with the persisted variant selected', () => {
    mount('material')
    expect(screen.getByText('Interface')).toBeDefined()
    expect(screen.getByText(/glass chrome and gradient field/)).toBeDefined()
    expect(pressed(/New/)).toBe('true')
    expect(pressed(/Classic/)).toBe('false')
  })

  it('click drives setSkin; selection follows the store mirror, not the click echo', () => {
    const b = mount('material')
    fireEvent.click(screen.getByRole('button', { name: /Classic/ }))
    expect(b.setSkin).toHaveBeenCalledWith('classic')
    expect(pressed(/New/)).toBe('true')
    act(() => { b.store.actions.sync('classic', 1) })
    expect(pressed(/Classic/)).toBe('true')
    expect(pressed(/New/)).toBe('false')
  })
})
