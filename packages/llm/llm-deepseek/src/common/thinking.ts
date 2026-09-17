/**
 * Thinking policy and text flattening shared by the protocol serializers: the
 * legal thinking/effort pair every wire resolves before it writes its own
 * fields, and the text join used wherever a wire carries text without ordered
 * parts.
 * @module dsh-llm-deepseek/common/thinking
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { RequestDefaults } from './types.ts'

/** One request's thinking policy, resolved from the harness request and the adapter defaults. */
export interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'low' | 'high' | 'max' {
  if (effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'low' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Resolve one legal thinking/effort pair without exposing `off` as a wire evidence
 * level.
 * @param options - the harness request naming an optional effort and purpose.
 * @param defaults - adapter-level thinking policy for requests that name no effort.
 * @returns the policy the wire serializers translate into their own fields.
 */
export function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'low' || effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/**
 * Join the text blocks of one message, used wherever a wire carries text
 * without ordered parts.
 * @param blocks - content blocks of one harness message or tool result.
 * @returns every text block's text, concatenated in block order.
 */
export function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}
