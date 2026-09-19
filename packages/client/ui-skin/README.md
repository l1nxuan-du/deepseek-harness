---
description: "Interface-skin settings for the dsh web client: the classic/material chrome choice, its General settings row, the scoped material stylesheet, and the field backdrop."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skin

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-skin` lets Web GUI users choose the interface chrome in Settings: `material`, the new interface built from the study's glass surfaces and gradient field, or `classic`, the shipped chrome. Material is the default. A loopback client stores the choice in the `ui-skin` settings namespace, which the local provider persists in `$DSH_HOME/settings.yaml` by default. The plugin projects the choice onto the document — a root attribute, an alias-token layer, and a backdrop element — and ships the material stylesheet, whose every rule selects on that attribute.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users switch the interface from the Interface row in Settings (General section); the choice persists across restarts on a loopback browser. Deployments mount the plugin like any other client package: the Host half registers the `ui-skin` settings section and answers each index render with the bootstrap row, and the browser half registers the row and applies the chrome.

### The Interface row

The row offers two cubes. `material` is the default and adds the glass surfaces, the inset conversation pane, and the field the chrome floats on; `classic` renders the shipped chrome with the frame's own geometry. Each accepted change writes through the Host settings API, so a rejected write reloads the durable value.

### Selecting the chrome before the shell mounts

The Host half embeds the durable variant in each index response. A body script publishes it as `html[data-dsh-skin]` before the application module runs, a head style paints the material canvas, and the browser runtime adopts the published value as its starting point — so the chrome the page painted and the chrome the runtime projects agree.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### What the runtime projects

`SkinRuntime` holds the selected variant and publishes an immutable snapshot for the settings row. One projection step owns every document-level write for the variant:

- the `data-dsh-skin` attribute on `document.documentElement`, which states the selection and gates every rule in the material stylesheet;
- one alias-token layer through `ctx.theme.overrideTokens`, covering the palette axes the shipped components already consume (page, layered surfaces, labels, borders, link, interactive fills, the sidebar fill, bubbles, menus);
- the field backdrop, a fixed element prepended to the body: a wash under the WebGL2 flow pattern.

Selecting `classic` retracts the token layer and the backdrop and leaves the attribute naming the classic chrome, so the shipped chrome renders exactly as it does without this plugin. The plugin provides no service; the row reaches the variant through its registration's inject face, and reads changes through a store the runtime writes.

### Styling scope

The material sheet is global, and every selector requires the root attribute; an install therefore cannot restyle the classic chrome. Rules reach the shipped chrome through the slot seats it renders into (`[data-slot='sidebar']`, `[data-slot='conversation.composer.bar']`, …) plus the stable class-name suffixes of the components it restyles. Palette axes ride the alias-token layer instead of the sheet, so menus, popovers, and cards follow the material palette without a second copy of their styles. The input card is the one surface the study's acrylic recipe does not carry over: transcript rows scroll behind it, so it takes a mostly opaque mica fill (78% light, 82% dark) under a 12px blur instead.

### The field

The backdrop is plain DOM, not React: one fixed element with a wash layer under a WebGL2 canvas running the flow pattern. The field carries no product state; the pattern owns its own animation loop.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Web styling](../../../docs/web-styling.md) — the authoritative styling rules for web client components.
- [ui-theme](../ui-theme/README.md) — the token stylesheets and the alias-token layer this package overrides.
- [ui-layout](../ui-layout/README.md) — the frame, its columns, and the theme presenter.
- [Interface-skin Agent Note](../../../.agents/notes/implemented/architecture/2026-09-19-interface-skin-layer.md) — why the chrome choice is an attribute-scoped layer rather than a second shell.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side chrome layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The sheet couples to the shipped chrome's DOM** — it selects slot seats and stable class-name suffixes, so renaming one of those components needs a matching sheet update; the browser e2e scenario fails when a selector stops matching.
- **The lattice and the pointer glow are deliberately absent** — the study's 90px grid and its cursor-following glow are dropped; the field is the wash and the flow pattern.
- **The flow pattern needs WebGL2** — a browser without it (or a driver that rejects the program) keeps the wash and draws no pattern, and the frame cap means the pattern runs at the capped device pixel ratio rather than the display's own.
- **Two layers can set the same alias token** — a registered theme and this skin both write alias tokens, and the later layer wins per token; the material palette is not a theme registration.
- **The material sheet arrives with the plugin bundle** — a cold load publishes the selection and paints the canvas color before the shell mounts, but the chrome stays classic until that bundle lands.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The material values come from the two `harness-chat` study pages (`index.html`, `new-chat.html`): the token contract, the material recipes, and the field. The flow-pattern shader, its two colour presets, and the uniform set are the study's own port of the DeepSeek landing-page bundle.

</details>

**Runtime invariant:** No companion is published. One runtime holds the variant and one settings scope persists it, while the document projection is a pure function of the runtime's snapshot; the runtime, store, and apply specs pin that agreement directly.
