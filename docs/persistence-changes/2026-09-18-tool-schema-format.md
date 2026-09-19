---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-18-tool-schema-format

English | [中文](2026-09-18-tool-schema-format.zh.md)

## Summary

Adds optional `format` metadata to each tool schema persisted in `request/header`.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-18-tool-schema-format
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "abe25cc34a156ee155b3775d439ae0b15db275ac4c1e689d95839c3dc7117d89"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing request headers remain valid because `format` is optional, so they can omit it without a format-version bump. Older readers can ignore the additional property. Its absence keeps the ordinary JSON function presentation; a present grammar lets a supporting wire present the tool as custom freeform text.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/fs/tool-apply-patch/tests/tool.spec.ts packages/llm/llm-deepseek/tests/responses/wire.spec.ts`: 50 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
