---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-18-tool-schema-format

[English](2026-09-18-tool-schema-format.md) | 中文

## 概述

为 `request/header` 中持久化的每个工具 schema 增加可选的 `format` 元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有请求 header 仍然有效，因为 `format` 是可选字段，可以省略且无需提升格式版本。旧读取方可以忽略新增属性。字段缺失时仍使用普通 JSON 函数呈现；携带 grammar 时，支持的 wire 可以把工具呈现为自定义自由文本。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/fs/tool-apply-patch/tests/tool.spec.ts packages/llm/llm-deepseek/tests/responses/wire.spec.ts`：50 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
