---
description: "由提供方持有 Playwright Chromium，并通过 CDP 提供跨平台 Browser Use 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-playwright-native

[English](README.md) | 中文

## 概述

这个公开实验包仅在显式挂载时激活。为每个活动 Session 提供一个由提供方持有的 Chromium Browser Use 工具集。Playwright 在 Windows、Linux、macOS 上负责浏览器发现、CDP 控制、截图和清理。本包不连接右侧栏 Browser iframe。

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

将提供方与 Browser Use 服务以及常规 Agent 工具服务一起挂载。

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-playwright-native'
  config:
    headless: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `headless` | `true` | 隐藏自有浏览器窗口 |
| `channel` | 自动 | `chrome`、`msedge` 或 `chromium`；省略时依次探测 Chrome、Edge 和捆绑 Chromium |
| `executablePath` | Playwright 发现 | 显式 Chromium 可执行文件路径 |
| `timeoutMs` | `30000` | 导航与操作超时 |
| `viewportWidth` | `1280` | 初始视口宽度 |
| `viewportHeight` | `720` | 初始视口高度 |
| `userAgent` | 页面默认 | 可选产品 User-Agent |

每个活动 Session 拥有一个隔离浏览器上下文。首次浏览器工具调用时启动；Session 释放时关闭浏览器并清理配置。无需也不会创建侧栏关联。

-----

<a id="understand-the-implementation"></a>
## 理解实现

提供方注册一个独占的 `browserUse` 提供方和固定动作集：导航、快照、按 token 点击/输入/选择、按键、滚动、截图和标签页管理。快照为可见交互元素分配短 token；导航和后续快照会使 token 失效。模型不能提供 selector、JavaScript 或坐标。

Playwright 负责 Chromium 启动和清理。显式 executable path 优先；否则使用配置的 channel，或依次探测 Chrome、Edge 和捆绑 Chromium。每个活动 Agent 使用一个浏览器上下文，并通过共享 browser-use 资源运行时串行化操作。

不发布运行时不变量伴随入口：浏览器对象是唯一权威，测试覆盖生命周期和动作边界。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Browser use 子系统](../../../docs/subsystems/browser-use.zh.md) — 提供方选择与 Session 所有权。
- [Playwright](https://playwright.dev/) — 浏览器启动与 CDP 实现。
- [Browser Use 服务](../../browser-use/browser-use/README.zh.md) — 独占提供方注册。

-----

<a id="model-experience"></a>
## 模型体验

### 提供方持有的浏览器工具

#### 模型看到的内容

模型看到上文固定的 `browser_*` 工具。`browser_snapshot` 返回当前 URL、标题、有界页面文本和带索引的交互元素。工具结果仍写入普通 Session 事件；截图使用常规图片附件流水线。

#### Token 影响

浏览器指导文本和工具 schema 增加提示词 token。快照文本有界；截图增加图片引用，原始字节不进入模型历史。

#### KV Cache 影响

未变化的指导文本和工具目录保持可复用前缀。工具结果追加到 Session 历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅 Chromium** — 提供方使用 Playwright 的 Chromium 引擎；Firefox 与 WebKit 不在范围内。
- **浏览器安装** — 无法发现捆绑 Chromium 时，需要显式 `executablePath`、配置 channel，或已安装 Chrome/Edge。
- **暂无侧栏镜像** — 本提供方不显示或控制右侧栏 Browser iframe。未来可通过受认证的 Host bridge 增加查看器。
- **实时浏览器状态** — 重开或 fork Session 会创建新的浏览器上下文；Cookie 与页面不随 Session 历史恢复。
- **取消** — 已送达页面的输入无法回滚；重试前应检查最新状态。

<a id="dev-note"></a>
### 开发备注

无。

**运行时不变式：** 不发布 companion；浏览器对象是其上下文与页面的唯一权威。
