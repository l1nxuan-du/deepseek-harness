// @vitest-environment jsdom
/** StrengthRow behavior: value display, arrow clicks drive setStrength,
 * bound-value arrows disable, display follows the store mirror. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { StrengthRow, type StrengthRowComponentProps } from '../src/client/StrengthRow.tsx'
import { createStrengthRowStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'strength.title': 'Material strength',
  'strength.description': 'Density of the conversation and panel material (blur and fill)',
  'strength.increase': 'Strengthen the material',
  'strength.decrease': 'Weaken the material',
  'strength.unit': '%',
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

type AttentionSnapshot = Parameters<Parameters<StrengthRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: StrengthRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mount(strength = 60) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createStrengthRowStore().create()
  store.actions.sync(strength, 0)
  const setStrength = vi.fn()
  const props: StrengthRowComponentProps = {
    useSessions: emptySessions(),
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setStrength,
  }
  render(<StrengthRow {...props} />)
  return { store, setStrength }
}

describe('StrengthRow', () => {
  it('renders the title, the description, and the persisted percent', () => {
    mount(40)
    expect(screen.getByText('Material strength')).toBeDefined()
    expect(screen.getByText(/Density of the conversation/)).toBeDefined()
    expect(screen.getByText('40')).toBeDefined()
    expect(screen.getByText('%')).toBeDefined()
  })

  it('steps by ten and follows the store mirror rather than the click echo', () => {
    const b = mount(40)
    fireEvent.click(screen.getByRole('button', { name: /Strengthen/ }))
    expect(b.setStrength).toHaveBeenCalledWith(50)
    fireEvent.click(screen.getByRole('button', { name: /Weaken/ }))
    expect(b.setStrength).toHaveBeenCalledWith(30)
    // No store write yet: the display is unchanged.
    expect(screen.getByText('40')).toBeDefined()
    act(() => { b.store.actions.sync(70, 1) })
    expect(screen.getByText('70')).toBeDefined()
  })

  it('disables the arrows at the ends of the range', () => {
    mount(100)
    expect(screen.getByRole('button', { name: /Strengthen/ }).hasAttribute('disabled')).toBe(true)
    cleanup()
    mount(0)
    expect(screen.getByRole('button', { name: /Weaken/ }).hasAttribute('disabled')).toBe(true)
  })
})
