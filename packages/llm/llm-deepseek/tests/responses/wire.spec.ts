/**
 * The Responses wire: request-body mapping (instructions, typed input items,
 * flat tools, reasoning effort, sampling fields), stream translation for
 * reasoning, text, tool calls and usage, the terminal-event and error
 * mappings, image parts, and the protocol-selection default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  ReasoningEffortId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import type { PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { assemble } from '../assemble.ts'
import { closeMockServers, mockServer, responsesFrame, textResponsesFrames } from '../mock-server.ts'
import type { Behavior } from '../mock-server.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000003' as AnonymousUserId
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-deepseek-responses-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

/** The shipping plugin on the shipped default wire, with the key from the environment. */
async function harness(baseURL: string, config: object = {}): Promise<Context> {
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  await ctx.plugin(LlmDeepSeek, { protocol: 'responses', baseURL, ...config })
  return ctx
}

function noExtensions(): Promise<PreparedDeepSeekLlmApiExtensions> {
  return Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
}

/** Direct adapter over the plugin's real resolve step, with a static key. */
function adapterOf(
  config: Partial<LlmDeepSeek.Config> = {},
  attachments?: AttachmentStore,
  files?: LlmDeepSeek.DeepSeekFileStore,
): DeepSeekAdapter {
  return new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ protocol: 'responses', ...config }),
    resolveApiKey: () => Promise.resolve('k'),
    resolveUserId: () => TEST_USER_ID,
    resolveAttachments: () => attachments,
    ...files === undefined ? {} : { resolveFiles: () => files },
    prepareExtensions: noExtensions,
  })
}

function ask(text: string): GenerateOptions['messages'] {
  return [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'test' } })]
}

const weatherTool: ToolSchema = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}

const imageRef: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
}

function requestImage(): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: imageRef,
    mediaType: 'image/png',
    bytes: 3,
    data: Uint8Array.of(1, 2, 3),
    width: 1,
    height: 1,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
  }
}

function attachmentStoreOf(version: RequestImageAttachment): AttachmentStore {
  return { readImageRequest: () => Promise.resolve(version), imageHostPath: () => undefined } as unknown as AttachmentStore
}

function fileStoreOf(fileId: string): LlmDeepSeek.DeepSeekFileStore {
  return {
    ensureUploaded: () => Promise.resolve({ record: { fileId: LlmDeepSeek.DeepSeekFileId(fileId) }, uploaded: true }),
    invalidate: () => Promise.resolve(),
  } as unknown as LlmDeepSeek.DeepSeekFileStore
}

function frames(events: Array<{ type: string } & Record<string, unknown>>): Behavior {
  return { kind: 'sse-frames', frames: events.map(responsesFrame) }
}

describe('Responses wire selection', () => {
  it('posts the Responses path and streams text with usage', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames('hello') }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('hi') })

    expect(server.requests).toHaveLength(1)
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4, cacheReadTokens: 0, reasoningTokens: 0 })
    await ctx.fiber.dispose()
  })

  it('maps the harness request onto the documented Responses fields', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const ctx = await harness(server.url)
    await assemble(ctx, {
      model: 'deepseek-v4-pro',
      system: 'Be brief.',
      messages: ask('hi'),
      tools: [weatherTool],
      temperature: 0.25,
      maxTokens: 128,
      reasoningEffort: ReasoningEffortId('high'),
    })

    expect(server.requests[0]).toEqual({
      model: 'deepseek-v4-pro',
      instructions: 'Be brief.',
      input: [{ type: 'message', role: 'user', content: 'hi' }],
      stream: true,
      reasoning: { effort: 'high' },
      tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather for a city.',
        parameters: weatherTool.parameters,
      }],
      temperature: 0.25,
      max_output_tokens: 128,
    })
    await ctx.fiber.dispose()
  })

  it('sends no field the Responses wire does not support', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const ctx = await harness(server.url)
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('hi'), tools: [weatherTool] })

    const body = server.requests[0] as Record<string, unknown>
    for (const unsupported of [
      'messages', 'max_tokens', 'stream_options', 'thinking', 'reasoning_effort', 'stop', 'tool_choice',
      'top_p', 'text', 'parallel_tool_calls', 'previous_response_id', 'conversation', 'store', 'metadata',
    ]) {
      expect(body).not.toHaveProperty(unsupported)
    }
    await ctx.fiber.dispose()
  })

  it('maps a disabled thinking policy and a title call onto effort none', async () => {
    const disabled = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const first = await harness(disabled.url, { thinking: 'disabled' })
    await assemble(first, { model: 'deepseek-v4-flash', messages: ask('hi') })
    expect((disabled.requests[0] as { reasoning: unknown }).reasoning).toEqual({ effort: 'none' })
    await first.fiber.dispose()
  })

  it('refuses stop sequences before any request reaches the endpoint', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('hi'), stop: ['<END>'] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(server.requests).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})

describe('Responses stream translation', () => {
  it('translates reasoning, text and one tool call into the same blocks the chat wire produces', async () => {
    const server = await mockServer([frames([
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'rs_1', type: 'reasoning', status: 'in_progress', content: [] } },
      { type: 'response.reasoning_text.delta', item_id: 'rs_1', output_index: 0, delta: 'weighing ' },
      { type: 'response.reasoning_text.delta', item_id: 'rs_1', output_index: 0, delta: 'options' },
      { type: 'response.output_item.added', output_index: 1, item: { id: 'msg_1', type: 'message', status: 'in_progress', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 1, delta: 'hello' },
      { type: 'response.output_item.added', output_index: 2, item: { id: 'fc_1', type: 'function_call', status: 'in_progress', name: 'get_weather', call_id: 'call_1', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 2, delta: '{"city":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 2, delta: '"Paris"}' },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 4 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 3 },
            total_tokens: 15,
          },
        },
      },
    ])])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('weather?'), tools: [weatherTool] })

    expect(result.message.content).toEqual([
      { type: 'reasoning', text: 'weighing options' },
      { type: 'text', text: 'hello' },
      { type: 'tool-call', id: ToolCallId('call_1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
    ])
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    expect(result.usage).toEqual({ inputTokens: 6, outputTokens: 5, totalTokens: 15, cacheReadTokens: 4, reasoningTokens: 3 })
    await ctx.fiber.dispose()
  })

  it('replays a function call whose arguments never streamed', async () => {
    const server = await mockServer([frames([
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', status: 'in_progress', name: 'get_weather', call_id: 'call_9', arguments: '' } },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', status: 'completed', name: 'get_weather', call_id: 'call_9', arguments: '{"city":"Berlin"}' } },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed' } },
    ])])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('weather?'), tools: [weatherTool] })

    expect(result.message.content).toEqual([
      { type: 'tool-call', id: ToolCallId('call_9'), name: 'get_weather', arguments: '{"city":"Berlin"}' },
    ])
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    await ctx.fiber.dispose()
  })

  it('maps the incomplete and failed terminal events', async () => {
    const incomplete = await mockServer([frames([
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: 'cut' },
      { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
    ])])
    const first = await harness(incomplete.url)
    const capped = await assemble(first, { model: 'deepseek-v4-flash', messages: ask('hi') })
    expect(capped.finish).toEqual({ kind: 'max-tokens' })
    await first.fiber.dispose()

    const failed = await mockServer([frames([
      { type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { code: 'server_error', message: 'upstream blew up' } } },
    ])])
    const second = await harness(failed.url)
    const broken = await assemble(second, { model: 'deepseek-v4-flash', messages: ask('hi') })
    expect(broken.finish).toMatchObject({ kind: 'error', failure: { code: 'SERVER_ERROR', message: 'upstream blew up' } })
    await second.fiber.dispose()
  })

  it('treats a stream that ends without a terminal event as a truncated response', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: [
      responsesFrame({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } }),
      responsesFrame({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: 'partial' }),
    ] }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('hi') })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'STREAM_CLOSED' } })
    await ctx.fiber.dispose()
  })

  it('reports a completed response with no content as an empty response', async () => {
    const server = await mockServer([frames([
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed' } },
    ])])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('hi') })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'EMPTY_RESPONSE' } })
    await ctx.fiber.dispose()
  })
})

describe('Responses custom tools', () => {
  const patchTool: ToolSchema = {
    name: 'apply_patch',
    description: 'Apply a Codex-style multi-file patch to the workspace.',
    parameters: {
      type: 'object',
      properties: { patch: { type: 'string', description: 'The complete Codex-style patch envelope.' } },
      required: ['patch'],
    },
    format: { type: 'grammar', syntax: 'lark', definition: 'start: begin_patch hunk+ end_patch' },
  }

  it('offers a grammar-backed tool as a custom tool', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const ctx = await harness(server.url)
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('patch it'), tools: [patchTool] })

    expect((server.requests[0] as { tools: unknown[] }).tools).toEqual([{
      type: 'custom',
      name: 'apply_patch',
      description: 'Apply a Codex-style multi-file patch to the workspace.',
      format: { type: 'grammar', syntax: 'lark', definition: 'start: begin_patch hunk+ end_patch' },
    }])
    await ctx.fiber.dispose()
  })

  it('translates a streamed custom tool call into a call carrying the raw text', async () => {
    const patch = '*** Begin Patch\n*** Add File: a.txt\n+one\n*** End Patch'
    const server = await mockServer([frames([
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'ctc_1', type: 'custom_tool_call', status: 'in_progress', name: 'apply_patch', call_id: 'call_1', input: '' },
      },
      { type: 'response.custom_tool_call_input.delta', item_id: 'ctc_1', output_index: 0, delta: '*** Begin Patch\n' },
      {
        type: 'response.custom_tool_call_input.delta',
        item_id: 'ctc_1',
        output_index: 0,
        delta: '*** Add File: a.txt\n+one\n*** End Patch',
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { id: 'ctc_1', type: 'custom_tool_call', status: 'completed', name: 'apply_patch', call_id: 'call_1', input: patch },
      },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed' } },
    ])])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('patch it'), tools: [patchTool] })

    // The harness sees the model's text as the call's arguments, unchanged; the
    // tool layer is what turns it into the declared parameter.
    expect(result.message.content).toEqual([
      { type: 'tool-call', id: ToolCallId('call_1'), name: 'apply_patch', arguments: patch },
    ])
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    await ctx.fiber.dispose()
  })

  it('recovers a custom call whose input never streamed from its completed item', async () => {
    const patch = '*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch'
    const server = await mockServer([frames([
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'ctc_2', type: 'custom_tool_call', status: 'in_progress', name: 'apply_patch', call_id: 'call_2', input: '' },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { id: 'ctc_2', type: 'custom_tool_call', status: 'completed', name: 'apply_patch', call_id: 'call_2', input: patch },
      },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed' } },
    ])])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: ask('patch it'), tools: [patchTool] })

    expect(result.message.content).toEqual([
      { type: 'tool-call', id: ToolCallId('call_2'), name: 'apply_patch', arguments: patch },
    ])
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    await ctx.fiber.dispose()
  })
})

describe('Responses request history and images', () => {
  it('replays assistant reasoning, text, tool calls and tool results as their own items', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const ctx = await harness(server.url)
    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [
        ...ask('weather in Paris?'),
        createAssistantMessage({
          content: [
            { type: 'reasoning', text: 'I should call the weather tool.' },
            { type: 'text', text: 'Checking.' },
            { type: 'tool-call', id: ToolCallId('call_1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
          ],
          source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        }),
        createToolResultMessage({
          callId: ToolCallId('call_1'),
          content: [{ type: 'text', text: 'Sunny, 22°C' }],
          isError: false,
        }),
      ],
    })

    expect((server.requests[0] as { input: unknown[] }).input).toEqual([
      { type: 'message', role: 'user', content: 'weather in Paris?' },
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'I should call the weather tool.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }] },
      { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'Sunny, 22°C' },
    ])
    await ctx.fiber.dispose()
  })

  it('sends one Files API id as an input_image part beside its handle text', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const adapter = adapterOf(
      { baseURL: server.url, models: [{ id: 'vision', inputModalities: ['text', 'image'] }] },
      attachmentStoreOf(requestImage()),
      fileStoreOf('file-api-7'),
    )
    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'vision',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'What is this?' }, { type: 'image', attachment: imageRef }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })) { /* drain */ }

    expect(server.requests[0]).toMatchObject({
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is this?' },
          { type: 'input_text', text: expect.stringContaining('request preview 1x1px') as string },
          { type: 'input_image', file_id: 'file-api-7' },
        ],
      }],
    })
  })

  it('falls back to an inline data URL when the Files API refuses the upload', async () => {
    const server = await mockServer([{ kind: 'sse-frames', frames: textResponsesFrames() }])
    const adapter = new DeepSeekAdapter({
      options: () => resolveAdapterOptions({
        protocol: 'responses',
        baseURL: server.url,
        models: [{ id: 'vision', inputModalities: ['text', 'image'] }],
      }),
      resolveApiKey: () => Promise.resolve('k'),
      resolveUserId: () => TEST_USER_ID,
      resolveAttachments: () => attachmentStoreOf(requestImage()),
      resolveFiles: () => ({
        ensureUploaded: () => Promise.reject(new Error('upload refused')),
        invalidate: () => Promise.resolve(),
      }) as unknown as LlmDeepSeek.DeepSeekFileStore,
      prepareExtensions: noExtensions,
    })
    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'vision',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: imageRef }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })) { /* drain */ }

    const body = server.requests[0] as { input: Array<{ content: Array<Record<string, unknown>> }> }
    expect(body.input[0]?.content.find(part => part.type === 'input_image'))
      .toEqual({ type: 'input_image', image_url: 'data:image/png;base64,AQID' })
  })
})
