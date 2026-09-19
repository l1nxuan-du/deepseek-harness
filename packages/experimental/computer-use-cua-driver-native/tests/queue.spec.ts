import { describe, expect, it } from 'vitest'
import { SerialOperationQueue } from '../src/queue.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SerialOperationQueue', () => {
  it('runs native operations in FIFO order without overlap', async () => {
    const queue = new SerialOperationQueue()
    const release = deferred()
    const events: string[] = []
    const first = queue.run(async () => {
      events.push('first:start')
      await release.promise
      events.push('first:end')
      return 1
    }, new AbortController().signal)
    const second = queue.run(async () => {
      events.push('second:start')
      return 2
    }, new AbortController().signal)

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    release.resolve()
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('does not dispatch an operation canceled while queued', async () => {
    const queue = new SerialOperationQueue()
    const release = deferred()
    const controller = new AbortController()
    const first = queue.run(async () => {
      await release.promise
    }, new AbortController().signal)
    const second = queue.run(async () => 'dispatched', controller.signal)

    controller.abort(new Error('cancelled while queued'))
    release.resolve()
    await first
    await expect(second).rejects.toThrow('cancelled while queued')
  })
})
