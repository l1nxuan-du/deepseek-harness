---
description: "Provider-owned Playwright Chromium Browser Use tools with cross-platform launch and CDP control."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-playwright-native

English | [中文](README.zh.md)

## Summary

This published experimental package activates only when explicitly mounted. Run Browser Use tools against a Chromium browser owned by each live Session. Playwright provides cross-platform browser discovery, CDP control, screenshots, and cleanup on Windows, Linux, and macOS. This package does not connect to the right-Sidebar Browser iframe.

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

Mount the provider beside the Browser Use service and the normal Agent tool services.

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-playwright-native'
  config:
    headless: true
```

| Field | Default | Meaning |
|---|---|---|
| `headless` | `true` | Hide the owned browser window |
| `channel` | auto | `chrome`, `msedge`, or `chromium`; omitted probes Chrome, Edge, then bundled Chromium |
| `executablePath` | Playwright discovery | Explicit Chromium executable path |
| `timeoutMs` | `30000` | Navigation and action timeout |
| `viewportWidth` | `1280` | Initial viewport width |
| `viewportHeight` | `720` | Initial viewport height |
| `userAgent` | page default | Optional product user agent |

Each live Session owns one isolated browser context. The first browser tool call launches it; Session disposal closes the browser and removes its profile. No sidebar association is required or created.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider registers one exclusive `browserUse` provider and a fixed action set: navigation, snapshots, indexed click/type/select, key press, scrolling, screenshots, and tab management. Snapshots assign short tokens to visible interactive elements; navigation and later snapshots invalidate those tokens. The model never supplies selectors, JavaScript, or coordinates.

Playwright owns Chromium launch and cleanup. An explicit executable path wins; otherwise the provider tries the configured channel or probes Chrome, Edge, and bundled Chromium. The provider uses one browser context per live Agent and serializes operations through the shared browser-use resource runtime.

No runtime invariant companion is published: the browser object is the sole authority, and tests cover its lifecycle and action boundaries.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser use subsystem](../../../docs/subsystems/browser-use.md) — provider selection and Session ownership.
- [Playwright](https://playwright.dev/) — browser launch and CDP implementation.
- [Browser Use service](../../browser-use/browser-use/README.md) — exclusive provider registration.

-----

<a id="model-experience"></a>
## Model Experience

### Provider-owned browser tools

#### What the model sees

The model sees the fixed `browser_*` tools described above. `browser_snapshot` returns the current URL, title, bounded page text, and indexed interactive elements. Tool results remain ordinary Session events; screenshots use the normal image-attachment pipeline.

#### Token effect

The browser guidance section and tool schemas add prompt tokens. Snapshot text is bounded; screenshots add image references without placing raw bytes in model history.

#### KV Cache effect

The unchanged guidance and tool catalog preserve the reusable prefix. Tool results append to Session history.

## Known Limitations and Deferred Work

- **Chromium only** — the provider uses Playwright's Chromium engine; Firefox and WebKit are out of scope.
- **Browser installation** — an explicit `executablePath`, configured channel, or discoverable Chrome/Edge installation is required when bundled Chromium is unavailable.
- **No sidebar mirror** — this provider does not display or control the right-Sidebar Browser iframe. A future viewer can subscribe to the provider's browser through an authenticated Host bridge.
- **Live browser state** — reopening or forking a Session starts a fresh browser context; cookies and pages are not restored from Session history.
- **Cancellation** — input already delivered to a page cannot be rolled back; inspect fresh state before retrying.

<a id="dev-note"></a>
### Dev Note

None.

**Runtime invariant:** No companion is published; the browser object is the sole authority for its context and pages.
