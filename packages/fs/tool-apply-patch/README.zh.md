---
description: "基于 `ctx.fs` 的独立 apply_patch 工具：供为 agent（智能体）组合 Codex 风格多文件补丁的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-apply-patch

[English](README.md) | 中文

## 概述

`dsh-tool-apply-patch` 提供基于 `ctx.fs` 的面向模型 `apply_patch` 工具：一个 Codex 风格信封在单次调用中新增、更新、移动与删除多个文件，结果为参考实现的 `Success. Updated the following files:` 摘要，每个路径一行 `A`、`M` 或 `D`。每个 hunk 都在写入任何内容之前对照其文件完成检查；匹配遵循参考工具的宽容度（先精确、再忽略首尾空白、最后忽略 ASCII 与排印标点的差异），未触碰行的行尾保持不变，插入行沿用文件自身的行尾，更新后的文件以换行结尾。当部署需要 Codex 风格的多文件补丁时选择它；`dsh-tool-fs` 包提供替代的 `read`/`write`/`edit` 套件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型应在一次调用中编辑多个文件时，把工具与 `ctx.fs` 后端、防护变更的策略插件以及 shell 服务一起挂载：删除路径是一条 shell 命令，因此 `*** Delete File: ` 与移动的源都需要 `ctx.shell`。

在支持语法约束自定义工具的线协议上，信封会以自由格式输入呈现，并由参考实现自己的 Lark 语法约束，因此模型书写补丁时无需做 JSON 转义；其余线协议仍使用 JSON 的 `patch` 参数。若部署的端点拒绝自定义工具，设置 `freeform: false` 即可在所有线协议上使用 JSON 形态。

### 最小组合

一个后端、策略插件、shell，然后是工具。

```yaml
- name: '@deepseek-ai/dsh-fs-local'
- name: '@deepseek-ai/dsh-fs-observation-policy'
- name: '@deepseek-ai/dsh-tool-bash'
- name: '@deepseek-ai/dsh-tool-apply-patch'
```

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `description` | `Apply a Codex-style multi-file patch to the workspace.`（多行） | 面向模型的工具描述 |
| `detailLimit` | `3` | 被拒绝的 hunk 下每个明细列表打印的条目数 |
| `freeform` | `true` | 在线协议支持自定义工具时，把信封作为受语法约束的自由格式输入提供 |

### 信封

首行与结尾行为 `*** Begin Patch` 与 `*** End Patch`，两者都比较去除首尾空白后的结果，且结尾行之后只允许空行。`*** Add File: `、`*** Update File: ` 与 `*** Delete File: ` 在任意状态都能开启一个块；`*** Move to: ` 在更新块内、首个 hunk 之前被读取；`*** End of File` 结束它前面的 hunk。新增块的内容行以 `+` 开头；更新块的内容行以空格（上下文）、`-`（删除）或 `+`（新增）开头；`@@` 开启一个 hunk，而 `@@ <text>` 会先把搜索位置移到该文本所在行的后面。更新块内的空行表示一行空上下文，其他不带前缀的行会被拒绝，并把该行以 JSON 字符串形式呈现。

### 文件操作

`*** Add File: ` 写入内容行加一个结尾换行；块内没有内容行时创建空文件；路径已存在时直接覆盖，这正是参考实现自身的新增语义。`*** Update File: ` 要求目标是常规文件，按顺序在补丁开始时读取到的文件内容上应用其 hunk 并写入结果；若块的 hunk 未产生变化，则报告 `M <path>` 且不写入。`*** Move to: ` 把更新后的内容写到目标（无论其是否存在），再删除源，并报告 `M <source>`。`*** Delete File: ` 不接受任何内容行，并拒绝非常规文件。

### 失败与恢复

所有确定性失败都发生在第一次写入之前：删除不存在的路径（`FS_NOT_FOUND`）、更新、新增或删除非常规文件（`FS_NOT_REGULAR_FILE`），以及锚点行不在文件中的 hunk（`FS_EDIT_NOT_FOUND`）。hunk 失败以 `Failed to find expected lines in <path>:` 与 hunk 自身的行开始，随后指明 hunk、带上 `(the patch was declined, nothing was written)`，并追加缩进的明细行：文件缺失的 hunk 行及其最近行、块最接近的位置，以及该 hunk 的输出已存在于文件中时的提示。提交过程边执行边重新校验，因此其他进程在补丁执行中途造成的变更会让调用在该操作处停止，而此前的操作已经生效。沙箱拒绝表现为共享的 `[sandbox: file access denied under <mode> mode]` 标记。未挂载 shell 服务的组合会明确拒绝删除，而不是报告文件已被删除。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

工具先把整个信封解析为操作列表，再对它们执行两趟处理。预检以内存叠加层重放每个操作，叠加层以后端的不透明目标键为索引——这正是同一路径被多次操作时表现得像它所描述的连续编辑的地方，也是所有确定性拒绝在写入任何字节之前被提出的地方。提交过程按相同顺序执行同样的操作，一次性解析会话沙箱策略，并边执行边重新校验。变更操作绝不自行假设：每个操作都从 `fs/write-intent` 或 `fs/edit-intent` waterfall（瀑布式事件）取得防护，通过 `fs/observed` 记录它观察到的版本，并把每次调用的沙箱策略交给提供方。hunk 通过参考实现的四趟比较来匹配整行文本，绝不比较文件的切片，这才保证匹配落在整行上、让 CRLF 文件接受以 LF 写成的补丁，并让插入行沿用文件自身的行尾。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：schema、配置、待执行调用的卡片 |
| [`src/patch.ts`](src/patch.ts) | 信封语法及它声明的操作 |
| [`src/hunks.ts`](src/hunks.ts) | 行模型、整行匹配、拼接与未命中诊断 |
| [`src/run.ts`](src/run.ts) | 预检叠加层与提交过程 |
| [`src/delete.ts`](src/delete.ts) | 删除路径的 shell 命令 |
| [`src/sandbox.ts`](src/sandbox.ts) | 每次调用的策略解析与拒绝标记 |
| [`src/session-cwd.ts`](src/session-cwd.ts) | 相对路径所基于的工作区目录 |

### 一次补丁如何运行

解析先归一化 CRLF 与单独的 CR 终止符，然后在不触碰文件系统的前提下读取块与 hunk。预检把每个头部路径解析到调用会话的工作区并重放这些操作：它通过 stat、读取与应用 hunk 来确定每个路径在操作后的内容，且这些读取不进入事件流。提交过程真正执行它们，而它的读取正是策略插件用来授权随后写入的观测。一切都不回滚。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从工具逐步进入它所组合的约定、策略与后端。

- [文件系统子系统](../../../docs/subsystems/filesystem.zh.md)——穷尽式提供方约定、策略事件与错误分类体系。
- [dsh-fs](../fs/README.zh.md)——本工具消费的 `ctx.fs` 约定。
- [tool-fs](../tool-fs/README.zh.md)——替代的 `read`/`write`/`edit` 工具套件。
- [fs-observation-policy](../fs-observation-policy/README.zh.md)——通过 `fs/*` 事件防护变更的策略插件。
- [fs-sandbox](../fs-sandbox/README.zh.md)——围栏变更的沙箱强制后端。
- [dsh-shell](../../shell/shell/README.zh.md)——删除路径的执行器 seam。
- [生成工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-apply-patch)——本包注册的穷尽式 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`apply_patch` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-apply-patch)及其唯一的 `patch` 参数，包含配置的 `description`。本插件不贡献独立系统提示词段。

#### Token 影响

`apply_patch` 可见时产生固定的 schema 成本。

#### KV Cache 影响

配置的描述与 schema 不变时前缀稳定。

### 工具结果

#### 模型看到的内容

每个操作一行——`A <path>`、`M <path>`、`R <源> -> <目标>`、`D <path>` 或 `= <path>`，以换行连接。路径级拒绝是一句指明该路径的话。被拒绝的 hunk 会指明 hunk 与所在文件，说明 `(the patch was declined, nothing was written)`，并打印数量有上限的缩进明细。

#### Token 影响

随数据变化，每个操作一行，且每个被拒绝 hunk 的明细列表受 `detailLimit` 约束。

#### KV Cache 影响

工具结果以追加方式位于可复用请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本工具何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是与其他编辑器的通用对比或任务积压。

- **补丁不是事务**——预检会在第一次写入之前解决所有确定性拒绝，但提交阶段的失败（版本已过期、沙箱拒绝、删除失败）会让调用停止，此前的操作已经生效。
- **更新会记录它自己读取所建立的在场状态**——它在请求 `fs/edit-intent` 之前发出的 `fs/observed` 事件正是授权写入的依据，因此编辑前读取策略由补丁自身满足，而不是由模型此前的读取满足；真正证明补丁是针对文件当前内容写成的是整行匹配。
- **删除与移动需要 shell 服务**——`ctx.fs` 不提供删除操作，因此工具运行平台 shell 自带的无条件删除，并报告命令的失败文本。
- **匹配遵循参考工具的宽容度**——四趟依次为精确、忽略首尾空白、忽略首尾空白并折叠常见排印标点；匹配多处时取游标之后的第一个匹配，而 `@@ <text>` 只移动搜索起点。
- **更新总会以终止符结束文件**——与参考实现一贯的行为一致；未触碰行的行尾保持不变，插入行沿用文件的第一个行尾。
- **面向模型的文本只有英文**——工具描述、拒绝信息与诊断均未本地化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。工具适配器不持有独立持久状态；文件系统修改关系属于提供方与策略插件。
