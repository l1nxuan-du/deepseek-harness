/**
 * Image request representation and the route-budget precondition every
 * protocol serializer applies before it renders image parts: the retained
 * occurrences, at their exact request-version byte lengths under the selected
 * representation, must fit the route budget.
 * @module dsh-llm-deepseek/common/image-offload
 */

import { IMAGE_OFFLOAD_REQUIRED_CODE, LlmError, requiredImageOffload } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageAttachmentAccessResolver, Message } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ImageWireLocation } from './request-files.ts'

/** Provider representation for every retained image in one request. */
export type ImageRequestRepresentation =
  | {
    kind: 'file'
    /** Resolve a retained request version to a reusable DeepSeek file id. */
    resolveFileId: (
      version: RequestImageAttachment,
      block: Extract<ContentBlock, { type: 'image' }>,
      location: ImageWireLocation,
    ) => Promise<string>
  }
  | { kind: 'base64' }

/** Dependencies required only when the request contains image input. */
export interface ImageSerializationOptions {
  /** One representation used for every retained image in this request. */
  representation: ImageRequestRepresentation
  /** Request versions prepared for the conservatively retained normalized attachments, keyed by attachment id. */
  requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>
  /** Resolve current tool access independently from deterministic request-image versions. */
  resolveImageAccess?: ImageAttachmentAccessResolver
  /** Positive bound on accumulated represented image bytes. */
  maxRequestImageBytes: number
  /** Maximum represented images in one request. */
  maxImagesPerRequest?: number
  /** Represented-byte removal step applied after the request exceeds its byte bound. */
  byteQuantum?: number
  /** Image-count removal step applied after the request exceeds its count bound. */
  countQuantum?: number
}

/**
 * Reject a request whose retained occurrences, at their exact request-version
 * byte lengths under this representation, still exceed the route budget. The
 * failure names how many more oldest retained occurrences need durable
 * omission before the request can be retried.
 * @param messages - the harness messages about to be serialized.
 * @param images - request versions, bounds, and the selected representation.
 */
export function assertRetainedImagesFit(messages: readonly Message[], images: ImageSerializationOptions): void {
  const representation = images.representation.kind === 'file' ? 'raw' : 'base64'
  const offloadImages = requiredImageOffload(messages, {
    representation,
    maxBytes: images.maxRequestImageBytes,
    ...images.maxImagesPerRequest === undefined ? {} : { maxImages: images.maxImagesPerRequest },
    ...images.byteQuantum === undefined ? {} : { byteQuantum: images.byteQuantum },
    ...images.countQuantum === undefined ? {} : { countQuantum: images.countQuantum },
  }, (block) => {
    const version = images.requestImages.get(block.attachment.attachmentId)
    if (version === undefined) {
      throw new LlmError(`DeepSeek request image ${block.attachment.attachmentId} was not prepared.`, 'INVALID_REQUEST')
    }
    return version.bytes
  })
  if (offloadImages > 0) {
    throw new LlmError(
      `DeepSeek ${representation} request images exceed the route budget; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
      IMAGE_OFFLOAD_REQUIRED_CODE,
      { offloadImages },
    )
  }
}

/** Re-export for protocol serializers that name the preconditions they apply. */
export type { GenerateOptions }
