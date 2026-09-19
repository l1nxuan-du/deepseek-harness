/** Legacy Chat settings retained so existing user-settings documents continue to load. */

import z from '@deepseek-ai/schemastery'

/** Legacy Chat settings namespace. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Legacy field retained for settings-document compatibility; runtime uses Normal. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Legacy values accepted at the settings boundary; neither changes the fixed Normal UI. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Legacy completed-Turn presentation value. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Legacy default; Chat always presents collapsed process summaries with inline expansion. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'normal'

/** Legacy durable Chat section accepted by the Host schema. */
export interface ChatSettings {
  /** Legacy presentation value ignored by the fixed Normal UI. */
  transcriptView: TranscriptViewMode
}

/** Legacy durable Chat schema kept for settings-document compatibility. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
})
