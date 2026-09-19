---
description: "Keyless Google web search with automatic Bing fallback for the DSH web capability seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-google-bing

English | [中文](README.zh.md)

## Summary

Register a keyless `ctx.web` search provider that queries Google first and retries Bing when Google is unavailable or returns no parseable results. The provider reads only public result pages, sends no cookies, and returns normalized sources for the existing `web_search` tool.

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

Mount the package beside the Web service and select `google-bing` when more than one search provider is registered.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: google-bing
- name: '@deepseek-ai/dsh-web-search-google-bing'
```

| Field | Default | Meaning |
|---|---|---|
| `googleBaseURL` | `https://www.google.com/search` | Google search endpoint |
| `bingBaseURL` | `https://www.bing.com/search` | Bing fallback endpoint |
| `language` | `en-US` | Browser-language preference sent to both engines |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | Explicit product identity |
| `maxResponseBytes` | `2000000` | Per-engine response byte limit |

The provider is available without credentials. Provider selection still follows the Web service contract: configure its id when another search provider is mounted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider parses Google result anchors and Bing result blocks into `WebSearchSource[]`. Google is attempted first; HTTP failures, unparseable pages, and empty result sets select the Bing fallback. Caller cancellation is terminal and never starts Bing. Both engine failures become one `WEB_PROVIDER_ERROR` with both messages.

No runtime invariant companion is published: parsing and fallback selection are pure per-request operations with no retained mutable state.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web service](../web/README.md) — provider registration and selection.
- [Web tools](../tool-web/README.md) — the model-facing tool that consumes normalized sources.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool result, indirectly

#### What the model sees

Through `dsh-tool-web`, the conversation model sees deduplicated result URLs, titles, and snippets from the selected engine. The provider's structured failure appears through the consumer's error wrapper when both engines fail.

#### Token effect

Zero direct conversation tokens from registration. Result tokens scale with returned sources and snippets, then the service enforces the requested source bound.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Public-page parsing** — Google or Bing can change markup, show a consent or challenge page, or rate-limit the host. A result page with no parseable sources triggers Bing when Google is the failing engine and otherwise returns a structured provider error.
- **No personalization** — requests send no cookies, account identity, or browser profile; results are the public page variant for the host network.
- **Search-page terms** — deployments are responsible for complying with the search engines' access and automation terms.

<a id="dev-note"></a>
### Dev Note

None.

**Runtime invariant:** No companion is published; there is no separately maintained state to compare.
