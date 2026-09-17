/**
 * DeepSeek Responses wire format (OpenAI-compatible). Types only.
 *
 * Source of truth: the official API docs at
 * `~/repos/deepsuite-docs/apps/docs/docs` (api/create-response,
 * guides/responses_api, guides/thinking_mode.mdx, guides/tool_calls.md),
 * cross-checked against the Codex Responses fixture under
 * `packages/subagent/subagent-codex/tests/`.
 *
 * @module dsh-llm-deepseek/protocols/responses/types
 */

/**
 * Canonical Responses thinking efforts. The provider also accepts the
 * compatibility aliases `minimal` (read as `low`), `medium` and `xhigh` (read
 * as `high`); the adapter resolves harness efforts onto the canonical set.
 */
export type WireResponsesReasoningEffort = 'none' | 'low' | 'high' | 'max'

/** Request body for `POST {baseURL}/responses`. */
export interface WireResponsesRequest {
  model: string
  /** Ordered input items; `instructions` plus an empty item list is legal, and at least one of the two is required. */
  input: WireResponsesInputItem[]
  stream: true
  /** System-level instruction, inserted as the first system message of the model's context. */
  instructions?: string
  /** Function and custom tools; the Responses list is flat, unlike the chat-completions nesting. */
  tools?: WireResponsesTool[]
  /** Thinking-mode toggle and effort; omission leaves the provider's default (thinking enabled). */
  reasoning?: { effort: WireResponsesReasoningEffort }
  temperature?: number
  max_output_tokens?: number
}

/**
 * One entry of the Responses request `tools` array. A harness tool declares a
 * JSON `parameters` schema for wires without custom tools; a tool that also
 * carries a grammar is offered as a custom tool, whose input the model writes
 * freely under that grammar.
 */
export type WireResponsesTool = WireResponsesFunctionTool | WireResponsesCustomTool

/** JSON-schema function tool, the shape every Responses endpoint accepts. */
export interface WireResponsesFunctionTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Grammar-constrained freeform tool; `format.definition` is a Lark grammar. */
export interface WireResponsesCustomTool {
  type: 'custom'
  name: string
  description: string
  format: { type: 'grammar'; syntax: string; definition: string }
}

/** Text part inside a message item or a function-call output. */
export interface WireResponsesTextPart {
  type: 'input_text' | 'output_text'
  text: string
}

/** Chain-of-thought part inside a reasoning item. */
export interface WireResponsesReasoningPart {
  type: 'reasoning_text'
  text: string
}

/**
 * Image part inside a user message or a function-call output. `image_url` (an
 * http(s) URL or a base64 data URL) and `file_id` (a Files API image id) are
 * mutually exclusive, so exactly one of the two is ever present.
 */
export type WireResponsesImagePart =
  | { type: 'input_image'; image_url: string }
  | { type: 'input_image'; file_id: string }

/** Ordered content part accepted by a message item or a function-call output. */
export type WireResponsesContentPart = WireResponsesTextPart | WireResponsesImagePart

/** Message item: text-only content stays a string, ordered parts carry images. */
export interface WireResponsesMessageItem {
  type: 'message'
  /** `developer` is the provider's alias for `user`. */
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string | WireResponsesContentPart[]
}

/** Assistant tool call replayed as its own item; `arguments` is the raw JSON string. */
export interface WireResponsesFunctionCallItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

/** Tool result; every `function_call` needs one output item carrying its `call_id`. */
export interface WireResponsesFunctionCallOutputItem {
  type: 'function_call_output'
  call_id: string
  /** Text-only output stays a string, ordered parts carry images produced by the tool. */
  output: string | WireResponsesContentPart[]
}

/** Prior-turn chain of thought, replayed before the assistant message it preceded. */
export interface WireResponsesReasoningItem {
  type: 'reasoning'
  content: WireResponsesReasoningPart[]
}

/** One entry of the request `input` array. */
export type WireResponsesInputItem =
  | WireResponsesMessageItem
  | WireResponsesFunctionCallItem
  | WireResponsesFunctionCallOutputItem
  | WireResponsesReasoningItem

/** One output item of a response (message, reasoning, or function call). */
export interface WireResponsesItem {
  /** Item kind; only `message`, `reasoning`, and `function_call` carry harness content. */
  type: string
  /** Item id, which the item's delta events repeat as `item_id`. */
  id?: string
  role?: string
  /** `output_text` parts on a message item, `reasoning_text` parts on a reasoning item. */
  content?: Array<WireResponsesTextPart | WireResponsesReasoningPart> | null
  /** `function_call` items: the id pairing the call with its `function_call_output`. */
  call_id?: string
  /** `function_call` items: the tool name. */
  name?: string
  /** `function_call` items: complete argument JSON, which the argument deltas also deliver incrementally. */
  arguments?: string
  /** `custom_tool_call` items: the complete freeform input, which its deltas also deliver incrementally. */
  input?: string
}

/** The `response` object carried by `response.created`, `response.in_progress`, and every terminal event. */
export interface WireResponsesResponse {
  id?: string
  status?: 'in_progress' | 'completed' | 'incomplete' | 'failed'
  /** Present when the response failed; `code` is the machine-routable class, `message` the provider text. */
  error?: { code?: string; message?: string } | null
  /** Present when the response is incomplete; `reason` is `max_output_tokens` or `content_filter`. */
  incomplete_details?: { reason?: string } | null
  /** Completed output items, in output order. */
  output?: WireResponsesItem[]
  /** Provider token accounting for the finished response. */
  usage?: WireResponsesUsage | null
}

/**
 * Responses token accounting. `input_tokens` INCLUDES cache hits, matching the
 * chat-completions convention, so `mapResponsesUsage` subtracts
 * `input_tokens_details.cached_tokens` to keep the harness's disjoint counts.
 */
export interface WireResponsesUsage {
  input_tokens: number
  output_tokens: number
  /** Provider-reported aggregate across input and output tokens. */
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

/**
 * One streamed event payload. `type` selects the event; the fields below are
 * grouped by the event families that carry them, and every unconsumed family
 * (content-part lifecycle, web search, custom tools, future additions) leaves
 * them absent.
 */
export interface WireResponsesEvent {
  /** Event name, repeated from the SSE frame's `event:` field. */
  type: string
  /** Monotonic event ordinal within the response. */
  sequence_number?: number
  /** `response.created`, `response.in_progress`, and every terminal event. */
  response?: WireResponsesResponse
  /** `response.output_item.added` / `response.output_item.done`. */
  item?: WireResponsesItem
  /** `response.output_item.added` / `.done`: the item's position in `response.output`. */
  output_index?: number
  /** Delta and content-part events: the id of the item they belong to. */
  item_id?: string
  /** Tool-call events: the call id, which the reference client also accepts as the item's identity. */
  call_id?: string
  /** `response.content_part.added` / `.done`. */
  content_index?: number
  /** `response.content_part.added` / `.done`: the part that started or finished. */
  part?: WireResponsesTextPart | WireResponsesReasoningPart | WireResponsesImagePart
  /** `response.reasoning_text.delta` / `response.output_text.delta` / `response.function_call_arguments.delta`. */
  delta?: string
  /** `response.reasoning_text.done` / `response.output_text.done`: the complete text of that part. */
  text?: string
  /** `response.function_call_arguments.done`: the complete argument JSON. */
  arguments?: string
}

/** Non-2xx error body. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}
