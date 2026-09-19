/** The sheet installer is inert outside a browser document. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { installSkinStyles } from '../src/client/styles.ts'

describe('interface-skin styles without a document', () => {
  it('registers no effect when there is no document to mount into', () => {
    const ctx = new Context()
    const effect = vi.spyOn(ctx, 'effect')
    installSkinStyles(ctx)
    expect(effect).not.toHaveBeenCalled()
  })
})
