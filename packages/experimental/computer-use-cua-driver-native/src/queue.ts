/** Process-wide FIFO serialization for native desktop operations. */

/**
 * Serialize operations that share one desktop. Callers wait for earlier work
 * before their operation starts; cancellation is checked at the queue head so
 * an abandoned caller never dispatches native input.
 */
export class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve()

  /**
   * Queue one operation.
   * @param operation - native operation, started only at the queue head.
   * @param signal - cancellation for this caller's wait and operation.
   * @returns the operation result or its cancellation/failure.
   */
  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const result = this.tail.then(async () => {
      signal.throwIfAborted()
      return await operation()
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
