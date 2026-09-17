/**
 * Translate a DeepSeek Responses SSE stream into the harness `StreamChunk`
 * protocol. There is no `[DONE]` sentinel: `response.completed`,
 * `response.incomplete`, and `response.failed` each end the stream, and every
 * block-end, the usage, and the finish reason are deferred to that terminal
 * event, so the harness observes exactly what the chat-completions wire
 * produces for the same turn. One block is opened per streamed item, so several
 * content parts of one message item accumulate into its single text block.
 * Informational events (`response.created`, `response.in_progress`, the
 * content-part and `*.done` lifecycles) carry nothing the harness protocol
 * needs, because the deltas are the content.
 *
 * @module dsh-llm-deepseek/translate-responses
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { acceptIdentity, BlockAssembly } from '../../common/blocks.ts'
import type { OpenBlock } from '../../common/blocks.ts'
import type { SseFrame } from './sse.ts'
import { mapFinishReason, mapUsage } from '../chat-completions/translate.ts'
import type { WireResponsesEvent, WireResponsesUsage } from './types.ts'

/** One of the three events that end a Responses stream. */
export type WireResponsesTerminalEvent = WireResponsesEvent & {
  type: 'response.completed' | 'response.incomplete' | 'response.failed'
}

/** Tool identity one output item contributes to its delta events. */
interface ItemFacts {
  name?: string | undefined
  callId?: string | undefined
}

/**
 * Map Responses usage onto the harness counts. The Responses vocabulary
 * renames the chat-completions fields, so this normalizes onto {@link mapUsage},
 * which owns the disjoint-cache accounting and the exact-total rule.
 * @param usage - usage of one finished response; `input_tokens` includes cache hits.
 * @returns disjoint harness counts.
 */
export function mapResponsesUsage(usage: WireResponsesUsage): TokenUsage {
  return mapUsage({
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    ...usage.total_tokens === undefined ? {} : { total_tokens: usage.total_tokens },
    ...usage.input_tokens_details === undefined ? {} : { prompt_tokens_details: usage.input_tokens_details },
    ...usage.output_tokens_details === undefined ? {} : { completion_tokens_details: usage.output_tokens_details },
  })
}

/**
 * Map one terminal event onto the harness finish reason.
 * @param event - the terminal event of a streamed response.
 * @param hasToolCalls - whether the stream opened a tool-call block; the Responses
 *   wire carries no `finish_reason`, so a normal completion with tool calls maps
 *   onto `tool-calls` exactly as the chat-completions wire reports it.
 * @returns the finish reason; `incomplete` maps `max_output_tokens` onto
 *   `max-tokens` and any other reason through the chat-completions attribution,
 *   and `failed` becomes an `error` finish carrying the provider's code and message.
 */
export function mapTerminalFinish(event: WireResponsesTerminalEvent, hasToolCalls: boolean): FinishReason {
  switch (event.type) {
    case 'response.completed':
      return hasToolCalls ? { kind: 'tool-calls' } : { kind: 'stop' }
    case 'response.incomplete': {
      const reason = event.response?.incomplete_details?.reason
      if (reason === undefined) {
        return { kind: 'error', failure: { message: 'model stopped: incomplete response', code: 'INCOMPLETE' } }
      }
      if (reason === 'max_output_tokens') return { kind: 'max-tokens' }
      // content_filter, insufficient_system_resource, future reasons.
      return mapFinishReason(reason)
    }
    case 'response.failed': {
      const code = event.response?.error?.code ?? 'response_failed'
      return {
        kind: 'error',
        failure: { message: event.response?.error?.message ?? `model stopped: ${code}`, code: code.toUpperCase() },
      }
    }
  }
}

/** Whether one event ends the response. */
function isTerminalEvent(event: WireResponsesEvent): event is WireResponsesTerminalEvent {
  return event.type === 'response.completed'
    || event.type === 'response.incomplete'
    || event.type === 'response.failed'
}

/**
 * Every key one event's item may be filed under, in lookup order: the item id,
 * the call id the reference client also accepts, then the item's output
 * position.
 * @param event - the event whose item identity to describe.
 * @returns the candidate keys, most specific first.
 * @throws LlmError `MALFORMED_RESPONSE` when the event carries no identity at all.
 */
function candidateKeys(event: WireResponsesEvent): string[] {
  const keys: string[] = []
  if (typeof event.item_id === 'string' && event.item_id.length > 0) keys.push(event.item_id)
  if (typeof event.call_id === 'string' && event.call_id.length > 0) keys.push(event.call_id)
  if (typeof event.output_index === 'number') keys.push(`#${event.output_index}`)
  if (keys.length === 0) throw new LlmError('malformed Responses event without an item identity', 'MALFORMED_RESPONSE')
  return keys
}

/**
 * File one announced item's tool identity under every key its deltas may use.
 * `response.function_call_arguments.delta` carries no name or call id, so a
 * tool call is representable only after its item announced them, which is what
 * makes an identity-less argument delta a protocol violation.
 * @param items - identity facts collected so far, keyed by {@link candidateKeys}.
 * @param event - `response.output_item.added` or `response.output_item.done` payload.
 */
function rememberItem(items: Map<string, ItemFacts>, event: WireResponsesEvent): void {
  const item = event.item
  // A grammar-backed tool answers with `custom_tool_call` instead of
  // `function_call`; both carry the same name and call id.
  if (item?.type !== 'function_call' && item?.type !== 'custom_tool_call') return
  const facts: ItemFacts = { name: item.name, callId: item.call_id }
  for (const key of candidateKeys({
    type: event.type,
    ...item.id === undefined ? {} : { item_id: item.id },
    ...item.call_id === undefined ? {} : { call_id: item.call_id },
    ...event.output_index === undefined ? {} : { output_index: event.output_index },
  })) {
    items.set(key, facts)
  }
}

/** Parse one SSE frame into its event payload, refusing a frame that contradicts itself. */
function parseEvent(frame: SseFrame): WireResponsesEvent {
  let event: WireResponsesEvent
  try {
    event = JSON.parse(frame.data) as WireResponsesEvent
  } catch {
    throw new LlmError(`malformed SSE payload: ${frame.data.slice(0, 120)}`, 'MALFORMED_RESPONSE')
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw new LlmError(`malformed SSE payload without an event type: ${frame.data.slice(0, 120)}`, 'MALFORMED_RESPONSE')
  }
  // The wire names every frame (`event:` plus the payload's `type`); a
  // disagreement means the stream is not the response this request started.
  if (frame.event !== undefined && frame.event !== event.type) {
    throw new LlmError(
      `SSE event name ${JSON.stringify(frame.event)} does not match payload type ${JSON.stringify(event.type)}`,
      'MALFORMED_RESPONSE',
    )
  }
  return event
}

/**
 * Consume a Responses SSE frame stream and yield StreamChunks.
 * @param frames - frames from {@link parseSseFrames}, terminal event included.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all
 *   deferred to the stream's terminal event. A completed response with no
 *   opened blocks becomes an `EMPTY_RESPONSE` error finish rather than a
 *   successful empty message, and a stream that ends without a terminal event
 *   is a truncated response: `STREAM_CLOSED`.
 */
export async function* translateResponses(frames: AsyncIterable<SseFrame>): AsyncGenerator<StreamChunk> {
  const blocks = new BlockAssembly()
  const textBlocks = new Map<string, OpenBlock>()
  const reasoningBlocks = new Map<string, OpenBlock>()
  const toolBlocks = new Map<string, OpenBlock>()
  const items = new Map<string, ItemFacts>()
  let pendingUsage: TokenUsage | undefined

  /** Append one streamed fragment to its item's text or reasoning block, opening the block on first content. */
  function appendText(kind: 'text' | 'reasoning', key: string, fragment: string): StreamChunk[] {
    const open = kind === 'text' ? textBlocks : reasoningBlocks
    let block = open.get(key)
    const chunks: StreamChunk[] = []
    if (block === undefined) {
      block = blocks.open(kind)
      open.set(key, block)
      chunks.push({ type: 'block-start', index: block.index, blockType: kind })
    }
    block.text += fragment
    chunks.push(kind === 'text'
      ? { type: 'text-delta', index: block.index, text: fragment }
      : { type: 'reasoning-delta', index: block.index, text: fragment })
    return chunks
  }

  /** Append one function-call argument fragment to its item's tool block, opening the block on first content. */
  function appendArguments(key: string, fragment: string): StreamChunk[] {
    const facts = items.get(key)
    if (facts === undefined) {
      throw new LlmError(
        `malformed Responses stream: arguments for undeclared item ${JSON.stringify(key)}`,
        'MALFORMED_RESPONSE',
      )
    }
    let block = toolBlocks.get(key)
    const chunks: StreamChunk[] = []
    if (block === undefined) {
      block = blocks.open('tool-call')
      toolBlocks.set(key, block)
      chunks.push({ type: 'block-start', index: block.index, blockType: 'tool-call' })
    }
    block.callId = acceptIdentity(block.callId, facts.callId)
    block.name = acceptIdentity(block.name, facts.name)
    block.text += fragment
    chunks.push({
      type: 'tool-call-delta',
      index: block.index,
      id: brandString<ToolCallId>(block.callId ?? ''),
      ...block.name !== undefined ? { name: block.name } : {},
      argumentsDelta: fragment,
    })
    return chunks
  }

  for await (const frame of frames) {
    const event = parseEvent(frame)

    if (isTerminalEvent(event)) {
      if (event.response?.usage) pendingUsage = mapResponsesUsage(event.response.usage)
      yield* blocks.flush(pendingUsage, mapTerminalFinish(event, blocks.hasToolCalls))
      return
    }

    switch (event.type) {
      case 'response.reasoning_text.delta':
      case 'response.output_text.delta': {
        const fragment = event.delta
        if (typeof fragment === 'string' && fragment.length > 0) {
          const key = candidateKeys(event)[0] as string
          for (const chunk of appendText(
            event.type === 'response.output_text.delta' ? 'text' : 'reasoning',
            key,
            fragment,
          )) yield chunk
        }
        break
      }
      // A custom tool's freeform input streams exactly like function arguments:
      // the harness receives the text, and its tool layer delivers it as the
      // parameter that tool declared.
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta': {
        const fragment = event.delta
        if (typeof fragment === 'string' && fragment.length > 0) {
          for (const chunk of appendArguments(candidateKeys(event)[0] as string, fragment)) yield chunk
        }
        break
      }
      case 'response.output_item.added':
        rememberItem(items, event)
        break
      case 'response.output_item.done':
        rememberItem(items, event)
        // A tool call whose arguments never streamed still has to reach the
        // harness: the completed item carries the whole argument JSON, and a
        // completed custom call carries its whole freeform input.
        if (event.item?.type === 'function_call' && typeof event.item.arguments === 'string') {
          const keys = candidateKeys({
            type: event.type,
            ...event.item.id === undefined ? {} : { item_id: event.item.id },
            ...event.item.call_id === undefined ? {} : { call_id: event.item.call_id },
            ...event.output_index === undefined ? {} : { output_index: event.output_index },
          })
          if (keys.every(key => !toolBlocks.has(key))) {
            for (const chunk of appendArguments(keys[0] as string, event.item.arguments)) yield chunk
          }
        } else if (event.item?.type === 'custom_tool_call' && typeof event.item.input === 'string') {
          const keys = candidateKeys({
            type: event.type,
            ...event.item.id === undefined ? {} : { item_id: event.item.id },
            ...event.item.call_id === undefined ? {} : { call_id: event.item.call_id },
            ...event.output_index === undefined ? {} : { output_index: event.output_index },
          })
          if (keys.every(key => !toolBlocks.has(key))) {
            for (const chunk of appendArguments(keys[0] as string, event.item.input)) yield chunk
          }
        }
        break
      default:
        // Informational and unconsumed families: response.created,
        // response.in_progress, the content-part and *.done lifecycles, web
        // search actions, custom tools, and future additions. None of them
        // carries content the harness protocol does not already receive as a delta.
        break
    }
  }

  // A stream ends only at its terminal event; EOF before it is truncation, and
  // the model call cannot be trusted.
  throw new LlmError('Responses stream ended without a terminal event', 'STREAM_CLOSED')
}
