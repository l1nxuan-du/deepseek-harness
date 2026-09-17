/**
 * Decode the Responses SSE byte stream into frames. Framing — chunk
 * reassembly, UTF-8/CRLF/BOM handling, comment and non-data field skipping,
 * multi-`data:` joining — is `eventsource-parser`'s. Comments are reported only
 * through an optional transport-activity callback.
 *
 * The Responses protocol has no `[DONE]` sentinel: each frame carries an
 * `event:` name and the stream terminates at its own terminal event, so this
 * module consumes frames and leaves termination to the translator. Framing is
 * spec-strict: an event dispatches only on its blank-line terminator, so an
 * unterminated tail at EOF is truncation, not a flushable payload.
 *
 * @module dsh-llm-deepseek/protocols/responses/sse
 */

import { EventSourceParserStream } from 'eventsource-parser/stream'

/** One SSE frame: its optional `event:` name and its joined `data:` payload. */
export interface SseFrame {
  /** `event:` field of this frame; the Responses wire sends one per frame. */
  event?: string
  /** Joined `data:` payload of this frame. */
  data: string
}

/**
 * Parse an SSE byte stream into frames, in arrival order.
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @param onComment - optional transport-activity callback; comments never enter the yielded frames.
 * @returns each frame of the stream, and nothing else; the stream's own end is not an error here.
 */
export async function* parseSseFrames(
  stream: ReadableStream<BufferSource>,
  onComment?: (comment: string) => void,
): AsyncGenerator<SseFrame> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const event of events) {
    yield event.event === undefined ? { data: event.data } : { event: event.event, data: event.data }
  }
}
