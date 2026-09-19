/**
 * Material-strength row registered into the General section item slot: title +
 * description + stepper pill (centered percent value; hover reveals the
 * up/down arrow column anchored to the pill's right edge). Registered by this
 * package — the skin feature owns its own settings surface. The displayed
 * value follows the persisted setting, never the click echo.
 */
import {
  IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { STRENGTH_MAX, STRENGTH_MIN, STRENGTH_STEP } from '../skin-settings.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createStrengthRowStore } from './settings-store.ts'
import css from './StrengthRow.module.css'

/** Injected business face: the strength write (t rides the standard locale seat). */
export interface StrengthRowInjected {
  /** Change the material strength (integer percent within STRENGTH_MIN..STRENGTH_MAX). */
  setStrength: (percent: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type StrengthRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createStrengthRowStore>>
  & PropsLocale<'settings.skin'> & StrengthRowInjected

/**
 * Render the material-strength row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function StrengthRow({ t, setStrength, useStore }: StrengthRowComponentProps) {
  const strength = useStore(s => s.strength)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('strength.title')}</div>
        <div className={css.desc}>{t('strength.description')}</div>
      </div>
      <div className={css.control}>
        <div className={css.stepper}>
          <span className={css.value}>{strength}</span>
          <span className={css.arrows}>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('strength.increase')}
              disabled={strength >= STRENGTH_MAX}
              onClick={() => { setStrength(strength + STRENGTH_STEP) }}
            >
              <IconChevronUpOutline14 size={9} />
            </button>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('strength.decrease')}
              disabled={strength <= STRENGTH_MIN}
              onClick={() => { setStrength(strength - STRENGTH_STEP) }}
            >
              <IconChevronDownOutline14 size={9} />
            </button>
          </span>
        </div>
        <span className={css.unit}>{t('strength.unit')}</span>
      </div>
    </div>
  )
}
