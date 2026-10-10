# Web UI style reference

English | [中文](web-styling.zh.md)

This reference defines styling ownership and component rules for browser client packages. The current token values live in [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/); this document does not duplicate that generated-by-source inventory.

## Ownership

[`ui-theme`](../packages/client/ui-theme/README.md) owns the `--dsw-*` static scale, semantic aliases, typography, motion, gradients, shadows, scrollbar styles, and light/dark preference. [`ui-layout`](../packages/client/ui-layout/README.md) applies the resolved theme snapshot to the document. Feature packages consume semantic aliases and do not define another global theme.

Global style sheets belong in `ui-theme/src/styles/`. Component styles live beside their component as CSS Modules. A component may define a local custom property when its value is part of that component's layout or presentation contract; shared colors, typography, elevation, and motion belong to the theme package.

## Interface skins

[`ui-skin`](../packages/client/ui-skin/README.md) owns a second chrome: the `ui-skin` configuration entry selects `material` (the default) or `classic`, and `SkinRuntime` projects the selection onto the document — the `data-dsh-skin` attribute on `document.documentElement`, one alias-token layer through `ctx.theme.overrideTokens`, and the field backdrop. Selecting `classic` retracts the token layer and the backdrop, so the shipped chrome renders exactly as it does without this plugin.

Every rule in the material sheet requires the root attribute, so the sheet is global while its scope is the selected chrome. Rules reach the shipped components through the slot seats those components render into plus their stable class-name suffixes, which makes the sheet a maintained coupling: renaming a slot or a component class suffix needs a matching sheet update, and `apps/web/tests/ui-skin.e2e.ts` fails when one stops matching. Palette axes ride the alias-token layer instead of a second copy of each component's styles.

A theme and this skin can both write the same alias token, and the later layer wins per token, so a deployment that registers a theme decides by registration order which palette the material chrome sits above or below. The field ports the study's flow-pattern shader onto a WebGL2 canvas over a CSS wash; the study's 90px lattice and its cursor-following glow are deliberately absent, a browser without WebGL2 falls back to the wash alone, and a cold load stays on the classic chrome until the plugin bundle carrying the sheet arrives.

<a id="component-rules"></a>
## Component rules

- Reuse the control before restyling one: the [ui-primitives component catalog](../packages/client/ui-primitives/README.md#component-catalog) is the only channel that crosses feature packages, and a deliberate visual difference belongs in a prop there rather than in a second copy ([reference](../packages/client/ui-primitives/README.md)).
- Use CSS Modules and `clsx`; do not add a component library or Tailwind.
- Use `--dsw-alias-*` semantic tokens in feature components. Do not copy static palette values or write literal colors there.
- Keep theme selectors out of feature component CSS. Light/dark overrides belong to the theme owner.
- Pair font sizes with line heights and use the theme typography variables when an existing role matches.
- Keep source text, terminal output, and diff lines unwrapped when their component contract requires column preservation; use the shared scrollbar styles rather than component-specific scrollbar selectors.
- Put presentation in CSS. Inline React styles may pass component-local custom-property values but must not encode theme branches.
- Preserve keyboard focus visibility and reduced-motion behavior when adding transitions or hover-only controls.
- Rounded corners inherit the global superellipse smoothing from ui-theme's `corner-shape.css` on supporting engines. Pair `corner-shape: round` with every full-round `border-radius` (`50%`, `100%`, or a pill radius) so circles and capsules keep circular arcs; the ui-theme corner-shape spec enforces the pairing.
- Elevated surfaces (menus, popovers, modals, panels, floating buttons, the composer) set `border: 0` and take `box-shadow: var(--dsw-elevation-panel)`, `var(--dsw-elevation-prominent)`, or the composer's `var(--dsw-elevation-soft)` (larger blur at lower alpha): the 0.5px hairline stroke is the first shadow layer, and `--dsw-elevation-stroke-color` rebinds or suppresses it per surface or state. Never pair a `--dsw-alias-border-*` border with an lv/elevation shadow — the ui-theme elevation spec rejects the pairing; state-colored borders (warn panels) stay real borders.
- Existing and new dropdown, context, submenu, and selection menus use `Menu` or wrap custom content in `MenuSurface`. The material is the theme-owned `--dsw-menu-surface-fill` plus `--dsw-menu-backdrop-filter`; feature and platform CSS must not override either. The ui-theme menu spec rejects unwrapped menu/listbox renderers, material overrides, and token redefinitions. The schedule-owned `TaskMenu` and `ClockPicker` retain their existing containers and material as explicit exceptions ([owner](../packages/client/ui-schedule/README.md)).
- Modal backdrops, including settings and confirmation dialogs, retain their translucent dark mask without blur. The theme sets `--dsw-mask-blur` to `none`; Desktop-owned modal overlays also leave the parent page unfiltered.
- Menu background filtering stays on an isolated layer so nested menus and fixed overlays retain their positioning and backdrop. On macOS, `MenuSurface` adds an opaque backing behind page content only within each menu’s bounds, allowing Chromium to blur content over native vibrancy; CSS anchors follow placement and size, and unmounting removes the backing. Overlays without this backing use `--dsw-specific-menu`, whose theme-owned macOS fill is 94% opaque to keep underlying text from bleeding through. Other elevated surfaces using that fill pair it with the same filter on their own isolated background when they contain fixed overlays.
- Flat borders and separators that use a neutral `--dsw-alias-border-*` token draw at `0.5px` — buttons, inputs, cards, row dividers, and separators drawn as filled boxes (menu separators, the conversation header seam, markdown `hr`, vertical rails) share the hairline weight, which Chromium paints as one device pixel. Dashed affordances and state-colored borders keep 1px; spinner ring tracks keep their width through the spec's explicit allowlist. The ui-theme elevation spec rejects wider neutral solid borders.
- Clickable artifact links (markdown anchors, prose file mentions, web source and fetch links, produced-file chips, workflow member links) color through `--dsw-alias-link` at `font-weight: 500`, with no underline at rest and a dotted 3px-offset underline on hover/focus. Compact Thinking Markdown keeps tertiary text color and a resting dotted underline ([compact presentation](../packages/client/ui-primitives/README.md#rendering-agent-output)). Text-leading anchors also lead with the ui-primitives `LinkIconMedium` category glyph riding `currentColor`, which for a well-known external host is that site's own mark instead of the globe; workflow member links and image-only anchors carry no glyph, and tool-row file links keep their grey dotted affordance.

<a id="corner-radii-and-settings-cards"></a>
## Corner radii and settings cards

The [DSH unified corner-radius standard](ui-radius.md) defines the radius scale, component size mapping, circle and capsule exceptions, nested hover geometry, and settings-card fills and strokes.

## Changing the system

Add or change a shared token in the owning `ui-theme` sheet, then consume its semantic alias from feature packages. Update the owning package reference when a public styling contract changes. Visual behavior follows the [testing policy](testing.md); the [archived styling-system Agent Note](../.agents/notes/archived/process/2026-07-19-web-styling-system.md) records framework rationale.
