/** `settings.skin` namespace dictionaries (the Interface row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'interface.title': '界面',
  'interface.description': '新版界面采用玻璃质感与渐变场，经典界面保持不变',
  'interface.classic': '经典',
  'interface.material': '新版',
} satisfies Record<string, string>

/** The settings.skin namespace key union. */
export type SkinKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'interface.title': 'Interface',
  'interface.description': 'The new interface adds the glass chrome and gradient field; classic stays unchanged',
  'interface.classic': 'Classic',
  'interface.material': 'New',
} satisfies Record<SkinKey, string>
