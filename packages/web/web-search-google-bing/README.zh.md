---
description: "面向 DSH web 能力 seam 的无密钥 Google 搜索，并在失败时自动回退 Bing。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-google-bing

[English](README.md) | 中文

## 概述

注册一个无密钥的 `ctx.web` 搜索提供方：先查询 Google，当 Google 不可用或没有可解析结果时重试 Bing。提供方只读取公开结果页，不发送 Cookie，并向现有 `web_search` 工具返回归一化来源。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本包与 Web 服务一起挂载；当注册了多个搜索提供方时，将服务配置为 `google-bing`。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: google-bing
- name: '@deepseek-ai/dsh-web-search-google-bing'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `googleBaseURL` | `https://www.google.com/search` | Google 搜索端点 |
| `bingBaseURL` | `https://www.bing.com/search` | Bing 回退端点 |
| `language` | `en-US` | 发送给两个引擎的浏览器语言偏好 |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | 明确的产品身份 |
| `maxResponseBytes` | `2000000` | 单个引擎的响应字节上限 |

提供方不需要凭据。若组合中还挂载了其他搜索提供方，仍需按 Web 服务约定配置其 id。

-----

<a id="understand-the-implementation"></a>
## 理解实现

提供方把 Google 结果锚点和 Bing 结果块解析为 `WebSearchSource[]`。先尝试 Google；HTTP 失败、页面无法解析或结果为空时选择 Bing 回退。调用方取消是终止状态，不会再启动 Bing。两个引擎都失败时合并为一条 `WEB_PROVIDER_ERROR`，同时包含两边错误信息。

不发布运行时不变量伴随入口：解析与回退选择都是无状态的一次性操作，没有独立维护的可变状态。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Web 服务](../web/README.zh.md) — 提供方注册与选择。
- [Web 工具](../tool-web/README.zh.md) — 消费归一化来源的模型可见工具。

-----

<a id="model-experience"></a>
## 模型体验

### 间接影响对话工具结果

#### 模型看到的内容

通过 `dsh-tool-web`，对话模型会看到所选引擎去重后的结果 URL、标题和摘要。两个引擎都失败时，提供方的结构化错误会通过消费方的错误包装出现。

#### Token 影响

注册本身不增加对话 token。结果 token 随返回来源与摘要增长，服务随后按请求上限截断。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **公开页面解析** — Google 或 Bing 可能调整标记、显示同意页或挑战页、或限流当前主机。没有可解析来源时，Google 失败会触发 Bing，否则返回结构化提供方错误。
- **无个性化** — 请求不发送 Cookie、账户身份或浏览器配置，结果采用当前主机网络对应的公开页面版本。
- **搜索页面条款** — 部署方负责遵守搜索引擎的访问与自动化条款。

<a id="dev-note"></a>
### 开发备注

无。

**运行时不变式：** 不发布伴随入口；没有独立维护的状态可比较。
