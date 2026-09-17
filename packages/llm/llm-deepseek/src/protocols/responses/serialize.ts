/**
 * Serialize harness messages into a DeepSeek Responses request. Text-only
 * content keeps the compact string form; images become `input_image` parts
 * inside a user message or a function-call output, carrying either a Files API
 * id or an inline data URL. Assistant tool calls and reasoning replay as their
 * own `function_call` and `reasoning` items, and tool results become
 * `function_call_output` items.
 *
 * The Responses wire carries no `stop` sequences, no `tool_choice`, and no
 * `text.format` on a harness request: the first is refused rather than
 * dropped, and the other two are outside the harness request vocabulary.
 *
 * @module dsh-llm-deepseek/serialize-responses
 */

import { contentHasImage, LlmError, offloadedImageText, projectOffloadedImages, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { assertRetainedImagesFit } from '../../common/image-offload.ts'
import type { ImageSerializationOptions } from '../../common/image-offload.ts'
import type { ImageWireLocation } from '../../common/request-files.ts'
import { flattenText, resolveThinking } from '../../common/thinking.ts'
import type { ResolvedThinking } from '../../common/thinking.ts'
import type { RequestDefaults } from '../../common/types.ts'
import type {
  WireResponsesContentPart,
  WireResponsesFunctionCallOutputItem,
  WireResponsesImagePart,
  WireResponsesInputItem,
  WireResponsesReasoningEffort,
  WireResponsesRequest,
  WireResponsesTextPart,
  WireResponsesTool,
} from './types.ts'

const NO_OUTPUT = '(no output)'

/**
 * Map one request's resolved thinking policy onto the canonical Responses
 * effort. `off` (including deployment-disabled thinking) is the wire's `none`;
 * an unresolved policy stays unset, which leaves the provider's default
 * (thinking enabled) in force exactly as the chat-completions wire leaves its
 * `thinking` field unset.
 * @param resolved - thinking policy resolved from the harness request and adapter defaults.
 * @returns the canonical effort to send, or `undefined` to send no `reasoning` field.
 */
function responsesEffort(resolved: ResolvedThinking): WireResponsesReasoningEffort | undefined {
  if (resolved.thinking === 'disabled') return 'none'
  return resolved.reasoningEffort
}

/**
 * Reject a harness request the Responses wire cannot carry. Stop sequences have
 * no Responses parameter and silently ignoring them would change what the model
 * produces, so a deployment that needs them selects the chat-completions wire.
 * @param options - the harness request about to be serialized.
 */
function assertRepresentable(options: GenerateOptions): void {
  if (options.stop !== undefined) {
    throw new LlmError(
      'DeepSeek does not support stop sequences on the responses wire API; select the chat-completions wire API for requests that need them',
      'UNSUPPORTED_OPTION',
    )
  }
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The DeepSeek responses adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Reject roles whose Responses input format cannot carry image input. */
function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `The DeepSeek responses adapter cannot represent image content in a ${message.role} message.`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

/** Keep text-only content on the compact string form accepted by every content slot. */
function compactContent(parts: readonly WireResponsesContentPart[]): string | WireResponsesContentPart[] {
  const text: string[] = []
  for (const part of parts) {
    if (part.type !== 'input_text' && part.type !== 'output_text') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

/** Render one tool result's ordered parts, keeping the placeholder text an empty result needs. */
function toolOutput(parts: readonly WireResponsesContentPart[]): string | WireResponsesContentPart[] {
  const content = compactContent(parts)
  return typeof content === 'string' ? content || NO_OUTPUT : content
}

/** Convert one assistant message into its ordered reasoning, text, and tool-call items. */
function assistantItems(message: Message): WireResponsesInputItem[] {
  const items: WireResponsesInputItem[] = []
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  if (reasoning.length > 0) {
    items.push({ type: 'reasoning', content: [{ type: 'reasoning_text', text: reasoning }] })
  }
  const text = flattenText(message.content)
  // A text-less turn contributes no message item: the Responses input format
  // merges reasoning and function calls into the assistant turn they belong
  // to, so an empty message would carry nothing.
  if (text.length > 0) {
    items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
  }
  for (const block of message.content) {
    if (block.type === 'tool-call') {
      items.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: block.arguments,
      })
    }
  }
  return items
}

/** Resolve one durable image into its descriptor and transient `input_image` part. */
async function imageParts(
  block: Extract<ContentBlock, { type: 'image' }>,
  images: ImageSerializationOptions,
  location: ImageWireLocation,
  precededByContent: boolean,
): Promise<[WireResponsesTextPart, WireResponsesImagePart]> {
  const version = images.requestImages.get(block.attachment.attachmentId)
  if (version === undefined) {
    throw new LlmError(
      `DeepSeek request image ${block.attachment.attachmentId} was not prepared.`,
      'INVALID_REQUEST',
    )
  }
  const image: WireResponsesImagePart = images.representation.kind === 'file'
    ? { type: 'input_image', file_id: await images.representation.resolveFileId(version, block, location) }
    : {
      type: 'input_image',
      image_url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`,
    }
  const handle = requestImageHandleText(block.attachment, version, images.resolveImageAccess?.(block.attachment))
  return [{ type: 'input_text', text: `${precededByContent ? '\n' : ''}${handle}` }, image]
}

/** Convert user or nested tool-result blocks into ordered content parts. */
async function contentParts(
  blocks: readonly ContentBlock[],
  images: ImageSerializationOptions,
  message: number,
  nextImage: { value: number },
): Promise<WireResponsesContentPart[]> {
  const parts: WireResponsesContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'input_text', text: block.text })
        break
      case 'image':
        nextImage.value += 1
        parts.push(...await imageParts(block, images, { message, image: nextImage.value }, parts.length > 0))
        break
      case 'tool-result':
        parts.push(...await contentParts(block.content, images, message, nextImage))
        break
      default:
        // Other merge-extensible blocks are not DeepSeek user-input vocabulary.
        break
    }
  }
  return parts
}

/**
 * Assemble the request fields shared by the text-only and image-capable conversion.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param input - ordered input items of this request.
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the Responses request body without unsupported fields.
 */
function requestWithInput(
  options: GenerateOptions,
  input: WireResponsesInputItem[],
  defaults: RequestDefaults,
): WireResponsesRequest {
  assertRepresentable(options)
  // A tool carrying a grammar is offered as a custom tool, so the model writes
  // its input freely instead of JSON-escaping it; every other tool keeps the
  // function form both wires share.
  const tools: WireResponsesTool[] | undefined = options.tools?.map(tool => tool.format === undefined
    ? {
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }
    : {
      type: 'custom' as const,
      name: tool.name,
      description: tool.description,
      format: tool.format,
    })
  const effort = responsesEffort(resolveThinking(options, defaults))
  return {
    model: options.model,
    input,
    stream: true,
    ...options.system === undefined ? {} : { instructions: options.system },
    ...effort === undefined ? {} : { reasoning: { effort } },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
  }
}

/** Serialize text-only history into input items; images are offloaded before this point. */
function textInputItems(messages: readonly Message[]): WireResponsesInputItem[] {
  const items: WireResponsesInputItem[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      items.push({ type: 'message', role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      items.push(...assistantItems(message))
      continue
    }
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      items.push({ type: 'message', role: 'user', content: text })
    }
    for (const result of toolResults) {
      items.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        output: flattenText(result.content) || NO_OUTPUT,
      })
    }
  }
  return items
}

/** Serialize image-capable history after resolving durable attachments. */
async function imageInputItems(
  messages: readonly Message[],
  images: ImageSerializationOptions,
): Promise<WireResponsesInputItem[]> {
  const items: WireResponsesInputItem[] = []
  for (const [messageIndex, message] of messages.entries()) {
    const nextImage = { value: 0 }
    if (message.role === 'system') {
      items.push({ type: 'message', role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      items.push(...assistantItems(message))
      continue
    }
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const toolResults = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    const content = compactContent(await contentParts(regular, images, messageIndex + 1, nextImage))
    if (content.length > 0 || toolResults.length === 0) {
      items.push({ type: 'message', role: 'user', content })
    }
    for (const result of toolResults) {
      const output: WireResponsesFunctionCallOutputItem['output'] = toolOutput(
        await contentParts(result.content, images, messageIndex + 1, nextImage),
      )
      items.push({ type: 'function_call_output', call_id: result.toolCallId, output })
    }
  }
  return items
}

/**
 * Build a text-only Responses request. Always streaming; optional fields are
 * omitted rather than sent as null, so provider defaults apply. `options.system`
 * fills the dedicated `instructions` slot — the wire inserts it as the leading
 * system message — so it is never repeated as an input item.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the Responses request body.
 */
export function serializeResponsesRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireResponsesRequest {
  return requestWithInput(options, textInputItems(options.messages), defaults)
}

/**
 * Build one image-capable Responses request while keeping durable bytes out of
 * session messages. Oversized oldest images become per-image text after their
 * exact request-version byte lengths are known and before provider serialization.
 * @param options - harness request containing image-capable user content.
 * @param images - request versions, optional current access resolver, and request bounds.
 * @param defaults - adapter-level thinking defaults.
 * @returns the fully materialized Responses request body.
 */
export async function serializeResponsesRequestWithImages(
  options: GenerateOptions,
  images: ImageSerializationOptions,
  defaults: RequestDefaults = {},
): Promise<WireResponsesRequest> {
  assertSupportedImageRoles(options.messages)
  assertRetainedImagesFit(options.messages, images)
  const requestMessages = projectOffloadedImages(
    options.messages,
    ref => offloadedImageText(ref, images.resolveImageAccess?.(ref)),
  )
  return requestWithInput(options, await imageInputItems(requestMessages, images), defaults)
}
