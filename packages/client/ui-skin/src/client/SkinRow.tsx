/**
 * Interface preference row registered into the General section item slot:
 * title, description, and two skin cubes. Registered by this package — the
 * skin feature owns its own settings surface. Selection follows the persisted
 * variant, never a resolved fallback.
 */
import clsx from 'clsx'
import { IconPanelLeftOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkinVariant } from '../skin-settings.ts'
import type { SkinKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createSkinRowStore } from './settings-store.ts'
import css from './SkinRow.module.css'

/** Injected business face: the variant write (t rides the standard locale seat). */
export interface SkinRowInjected {
  /** Switch the interface skin. */
  setSkin: (variant: SkinVariant) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SkinRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSkinRowStore>>
  & PropsLocale<'settings.skin'> & SkinRowInjected

/** Cube order and icons: classic first, the opt-in material skin second. */
const CUBES: readonly { id: SkinVariant; labelKey: SkinKey; Icon: typeof IconSparkle16 }[] = [
  { id: 'classic', labelKey: 'interface.classic', Icon: IconPanelLeftOutline16 },
  { id: 'material', labelKey: 'interface.material', Icon: IconSparkle16 },
]

/**
 * Render the Interface row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function SkinRow({ t, setSkin, useStore }: SkinRowComponentProps) {
  const variant = useStore(s => s.variant)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('interface.title')}</div>
      <div className={css.description}>{t('interface.description')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.skinCube, variant === id && css.selected)}
            aria-pressed={variant === id}
            onClick={() => { setSkin(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
