/**
 * Harness-block assembly shared by the DeepSeek wire translators. One block
 * per streamed content, reasoning, or tool call accumulates text and tool
 * identity until the stream's terminal event, which emits every block-end in
 * open order, then the latest usage, then the finish reason — so no chunk ever
 * follows `finish` and every wire protocol reaches the harness with the same
 * block order. A normal stop that produced no block at all is the degenerate
 * `EMPTY_RESPONSE` failure rather than a successful empty message.
 *
 * @module dsh-llm-deepseek/common/blocks
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { EMPTY_RESPONSE_CODE } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'

/** One open block under assembly. */
export interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only, absent until a delta carries a non-empty value. */
  callId?: string | undefined
  name?: string | undefined
}

/**
 * Accept one streamed identity field for a tool call. `id` and `name` are
 * identity, not accumulation: the wire sends each once, on the call's first
 * delta. A continuation delta that re-sends the field empty — or `null`, which
 * some OpenAI-compatible gateways fill in — means "no update", never "clear".
 * @param current - the identity established by an earlier delta of this call.
 * @param incoming - the field as parsed from this delta. The wire type is a
 *   claim about a remote encoder, so anything but a non-empty string leaves the
 *   established value alone rather than overwriting it.
 * @returns the identity in force after this delta.
 */
export function acceptIdentity(current: string | undefined, incoming: unknown): string | undefined {
  return typeof incoming === 'string' && incoming.length > 0 ? incoming : current
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: brandString<ToolCallId>(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/** Ordered blocks of one streamed response, plus the terminal emission they share. */
export class BlockAssembly {
  private nextIndex = 0
  private readonly opened: OpenBlock[] = []

  /**
   * Open the next block of this response, in stream order.
   * @param kind - block type the arriving delta or item establishes.
   * @returns the open block, whose index the deltas of that block carry.
   */
  open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: this.nextIndex++, kind, text: '' }
    this.opened.push(block)
    return block
  }

  /**
   * Whether this response opened a tool-call block. The Responses wire carries
   * no `finish_reason`, so its normal completion maps onto `tool-calls` from
   * the blocks the model actually produced.
   * @returns true once any tool-call block has been opened.
   */
  get hasToolCalls(): boolean {
    return this.opened.some(block => block.kind === 'tool-call')
  }

  /**
   * Emit the terminal sequence of one response.
   * @param usage - latest token accounting of this response, omitted when the wire reported none.
   * @param reason - finish reason the wire's terminal event established.
   * @returns each opened block in open order, then usage, then the finish reason;
   *   a `stop` with no opened block becomes an `EMPTY_RESPONSE` error finish.
   */
  *flush(usage: TokenUsage | undefined, reason: FinishReason): Generator<StreamChunk> {
    for (const block of this.opened) {
      yield { type: 'block-end', index: block.index, block: closeBlock(block) }
    }
    if (usage !== undefined) yield { type: 'usage', usage }
    yield {
      type: 'finish',
      reason: reason.kind === 'stop' && this.opened.length === 0
        ? {
          kind: 'error',
          failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
        }
        : reason,
    }
  }
}
