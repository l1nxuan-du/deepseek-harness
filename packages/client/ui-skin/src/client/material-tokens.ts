/**
 * Alias-layer overrides for the material chrome. The values restate the
 * prototype's palette (page wash, acrylic surfaces, accent) on the tokens the
 * shipped components already consume, so menus, popovers, and cards follow the
 * skin without a second copy of their styles.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Page wash behind the field. */
const PAGE_LIGHT = '#f9f8f8'
const PAGE_DARK = '#151517'

/** Acrylic surface over the field: translucent white in both palettes. */
const SURFACE_LIGHT = 'rgba(255, 255, 255, 0.5)'
const SURFACE_DARK = 'rgba(255, 255, 255, 0.08)'

/** Raised acrylic for menus and popovers, one step brighter than a panel. */
const RAISED_LIGHT = 'rgba(255, 255, 255, 0.72)'
const RAISED_DARK = 'rgba(32, 33, 36, 0.86)'

/**
 * Fill for the input card: acrylic at half strength — half-white in light, the
 * reference skin's raised grey at half alpha in dark, so the field's tone
 * reaches the card while its text stays legible.
 */
const INPUT_LIGHT = 'rgba(255, 255, 255, 0.5)'
const INPUT_DARK = 'rgba(58, 60, 64, 0.5)'

/** The prototype's single interactive accent. */
const ACCENT = '#4176e6'

/** Material alias overrides, keyed by the token the chrome consumes. */
export const MATERIAL_TOKEN_OVERRIDES: ThemeTokenOverrides = {
  '--dsw-alias-bg-base': { light: PAGE_LIGHT, dark: PAGE_DARK },
  '--dsw-alias-bg-layer-1': { light: SURFACE_LIGHT, dark: SURFACE_DARK },
  '--dsw-alias-bg-layer-2': { light: SURFACE_LIGHT, dark: SURFACE_DARK },
  '--dsw-alias-bg-layer-3': { light: RAISED_LIGHT, dark: RAISED_DARK },
  '--dsw-alias-label-primary': { light: '#0f1115', dark: '#f7f8f8' },
  '--dsw-alias-label-secondary': { light: '#43454a', dark: '#c9ccd1' },
  '--dsw-alias-label-tertiary': { light: '#5b5f66', dark: '#9ba0a8' },
  '--dsw-alias-label-caption': { light: '#6b6f76', dark: '#8d939c' },
  '--dsw-alias-border-l1': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.06)' },
  '--dsw-alias-border-l2': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.10)' },
  '--dsw-alias-border-l3': { light: 'rgba(0, 0, 0, 0.10)', dark: 'rgba(255, 255, 255, 0.14)' },
  '--dsw-alias-border-l4': { light: 'rgba(0, 0, 0, 0.14)', dark: 'rgba(255, 255, 255, 0.20)' },
  '--dsw-alias-link': { light: ACCENT, dark: '#7ea6ff' },
  '--dsw-alias-interactive-bg-hover': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.08)' },
  '--dsw-alias-interactive-bg-active': { light: 'rgba(0, 0, 0, 0.07)', dark: 'rgba(255, 255, 255, 0.12)' },
  '--dsw-alias-button-primary-fill': { light: ACCENT, dark: ACCENT },
  '--dsw-alias-button-primary-hover': { light: '#3568d4', dark: '#5a8bf0' },
  '--dsw-specific-sidebar-fill': { light: 'transparent', dark: 'transparent' },
  // Tag fills and the docking tab capsule are the same chip; both take the
  // material surface instead of the opaque shipped tag fill.
  '--dsw-alias-markdown-tag': { light: 'rgba(0, 0, 0, 0.05)', dark: 'rgba(255, 255, 255, 0.10)' },
  '--dsw-specific-sidebar-nav-item-active': { light: 'rgba(0, 0, 0, 0.06)', dark: 'rgba(255, 255, 255, 0.10)' },
  '--dsw-specific-sidebar-nav-item-hover': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.07)' },
  // The composer card's own fill token: the shipped card rule consumes it, so
  // the input and the other card surfaces (attachment rail, approval and
  // question panels) move together instead of drifting apart.
  '--dsw-specific-input-major': { light: INPUT_LIGHT, dark: INPUT_DARK },
  '--dsw-specific-bubble': { light: SURFACE_LIGHT, dark: SURFACE_DARK },
  '--dsw-specific-bubble-highlight': { light: RAISED_LIGHT, dark: RAISED_DARK },
  '--dsw-specific-menu': { light: RAISED_LIGHT, dark: RAISED_DARK },
}
