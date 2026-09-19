# Agent Note: The interface-skin layer

Status: implemented

English | [中文](2026-09-19-interface-skin-layer.zh.md)

## Problem

The product wanted the chat study's material chrome available to users without giving up the shipped one. The two differ in more than palette: the study insets the conversation pane into a rounded glass card, floats the sidebar on a gradient field, and restyles the composer, transcript bubbles, and tab strip. The existing chrome still had to render unchanged for every user who did not opt in, and the choice had to be a per-user setting rather than a deployment profile.

A second shell was the obvious candidate and the wrong one. The chrome is not one component: `ui-sidebar`, `ui-conversation`, `ui-chat`, and the settings plugins each own a piece, and each holds business state (workspace trees, the composer input machine, session projections). A parallel shell would have to reproduce all of it or shadow every slot occupant at a lower priority.

## Decision

One client package, `@deepseek-ai/dsh-client-ui-skin`, owns the choice and projects it onto the document.

The durable value is the `ui-skin` section (`material` by default), registered by the Host half and written by the General section's Interface row. `SkinRuntime` holds the selected variant, publishes an immutable snapshot to the row's store, and owns every document-level write for it: the `data-dsh-skin` attribute on `document.documentElement`, one alias-token layer through `ctx.theme.overrideTokens`, and the field backdrop element. The Host half publishes the durable value on the root element before the shell mounts, and the runtime adopts that published value as its starting point, so the chrome the page painted and the chrome the runtime projects agree. Selecting `classic` retracts the token layer and the backdrop and leaves the attribute naming the classic chrome, so an uninstall or a classic selection renders the shipped chrome byte-identically.

Every rule in the material stylesheet requires the root attribute, so the sheet is global but its scope is the selected chrome. Rules reach the shipped components through the slot seats those components render into plus their stable class-name suffixes; palette axes ride the alias-token layer instead, so menus, popovers, and cards follow the material palette without a second copy of their styles. The field is plain DOM — one fixed element whose wash, grid, and pointer glow are CSS and whose pointer position coalesces into one animation frame — because it carries no product state and no React tree should remount it.

## Alternatives considered

**A second shell package shadowing slot occupants by priority.** The slot registry supports shadowing at distinct priorities, and it stays the mechanism for a piece worth re-implementing. It was rejected here because the chrome spans four feature packages whose components own their business state.

**Extending the theme registry with a chrome axis.** A registered theme writes alias tokens, and the material chrome needs structure the token layer does not carry: pane insets and radius, backdrop blur, the field, and the tab indicator. The skin therefore uses the token layer for the palette and a scoped sheet for structure.

**Restyling the shipped components in place.** Branching inside `ui-sidebar`, `ui-conversation`, and `ui-chat` would put a second visual contract in each of them and make every future change to either chrome a change to both.

## Consequences

The sheet's selectors are a maintained coupling: renaming a slot or a component class suffix needs a matching sheet update, and the browser e2e scenario fails when one stops matching. A registered theme and this skin can both write the same alias token and the later layer wins per token, so a deployment that registers a theme should expect the material palette to sit above or below it depending on registration order. The field reproduces the study's wash, grid, and pointer glow in CSS; the study's WebGL flow-pattern and lattice canvases are not ported, and a cold load stays on the classic chrome until the plugin bundle that carries the sheet arrives.
