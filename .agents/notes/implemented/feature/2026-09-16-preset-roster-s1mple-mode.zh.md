# Agent Note: The shipped preset roster: 飞猪模式, anchored standard, the Codex pair, and 林克斯模式

Status: implemented

[English](2026-09-16-preset-roster-s1mple-mode.md) | 中文

## Problem

随包交付的预设原本是 `standard`、`ptc`、`minimal`、`cordis`。其中两个已不再符合该部署需要提供的东西：`minimal` 把工具集限制在单个持久 shell，而 `standard` 会在最前面放入一段 persona、harness 身份与工具指引，运维方希望去掉。运维方还在仓库之外维护两个 Codex 指令集预设及其提示词管线，并且希望把社区预设（`xiaobright/dsh-anchored-standard`，MIT）的首轮锚定机制，以及林克斯模式提示词及其精简的 `.agent/` 与 `docs/` 参考树也随包交付。

## Decision

随包交付的名单现在是 `s1mple-mode`（默认）、`anchored-standard`、`codex-v5`、`codex-v6`、`ptc`、`cordis` 与 `linx-mode`；`standard` 与 `minimal` 已删除。Web bundle 的 `agent-presets` 默认值改为 `s1mple-mode`。

`s1mple-mode`（飞猪模式）就是 `standard` 的组合换上空 persona：`prefix: ''` 搭配 `complete: true` 与 `includeRuntimeContext: false`，因此请求不带任何提示词文本、也不带运行时上下文快照，而工具行保持逐条不变。

`anchored-standard` 保留 Minimal 的首轮条件并按需解锁其余能力：从社区包移植的 6 个插件（MIT，署名记录在预设自身的注释里），加上以本仓库 `standard` 行组装的组合。它的 bootstrap 工具对是平台自带的持久 shell（`bash` 或 `pwsh`）加 `str_replace_editor`；首个持久 `tool/call` 或 `assistant/message` 让会话晋升为 bootstrap 工具对加 `dev_tool_search`、`skill_search`、`skill_load`；一次压缩会把它退回受控阶段。与上游包有两处刻意分歧：bootstrap shell 用本仓库自己的持久 shell（上游因为 PTY 后端只支持 POSIX，需要一个 Git Bash 的 `custom-bash`），以及 `str_replace_editor` 消费宿主的沙箱化 `fs`，而不是裸的 `fs-local` realm——后者会给一个模型可见工具一条不受限制的写入路径。

`codex-v5` 与 `codex-v6` 是 `standard` 的行加上作为 persona 的 Codex 指令集（GPT-5 与 GPT-6/Astra），直接签入；不携带该包的 `transform.mjs`/`build-preset.mjs`/`verify-preset.mjs` 管线，其 `dsh-codex-tools` 依赖换成 `standard` 本来就挂载的第一方 `@deepseek-ai/dsh-tool-apply-patch` 行，pi-ai 的 `codex-compat` 运行时补丁也被去掉，因为本仓库自己的适配器就会发出这些指令。两份提示词各改了一句话，使它不再在所有平台上都自称 PowerShell。

`linx-mode`（林克斯模式）是 `standard` 的组合，以预设目录内的 `linx.md` 作为 persona 前缀。挂载时的一个表达式会取得预设自身的 `baseUrl`、读取 `linx.md`，并把 `__DSH_LINX_ROOT__` 替换为该绝对目录（统一为斜杠），因此提示词中的 `.agent/` 与 `docs/` 引用在源码检出、linked profile 或安装包中都能解析。persona 不设置 `complete`，因此常规工具指引与运行时上下文仍会接在后面。随包参考文件留在磁盘上，由模型通过普通文件系统工具按需读取，而不会整批注入每个请求。

命名为 `standard` 的已录会话迁移到 `s1mple-mode`（两者工具目录相同），CLI 预设车道也随之一并迁移。

## Alternatives considered

- **保留 `standard`/`minimal`，只新增预设。** 否决：运维方要求替换，而名单会因此带着两个其行为已被新默认值覆盖的预设。
- **移植锚定包的 `custom-bash` 与 `fs-local` bootstrap。** 否决：本仓库的持久 `pwsh` 已经覆盖 Windows，而那个裸本地文件系统编辑器会让模型可见工具写出沙箱策略之外。
- **移植 Codex 提示词管线。** 否决：提示词属于预设自身，签入文本省掉了一个构建步骤、一个指纹文件和一个校验器——它们的存在都只是为了保护一个生成产物。
- **把林克斯模式的完整 `.agent/` 与 `docs/` 树注入系统提示词。** 否决：基础提示词只放 `linx.md`，参考树保留给按需读取，避免每个请求都支付全部文档的 token 成本。
- **硬编码源路径 `D:\Desktop\dsh-linx`。** 否决：安装包、linked profile 与源码检出的根目录不同；解析 `baseUrl` 才能让随包提示词保持自包含。
- **给已录会话保留一个兼容预设 id。** 否决：隐藏预设仍会继续交付运维方已删除的组合；把 fixture 迁移到 `s1mple-mode` 能保住它们录下的工具卡片，因为目录未变。

## Consequences

新增四个随包预设、删除两个，Web 默认值改为 `s1mple-mode`。移植来的锚定插件是预设目录内的 `.mjs` 文件：它们在仓库的 TypeScript 程序、覆盖率门禁与 lint 范围之外，上游的单测也没有一并移植，因此它们的行为由 `apps/cli/tests/web-agent-presets.e2e.ts` 的组合测试钉住（bootstrap 工具对、晋升、以及默认值的空提示词），而不是它们自己的测试。提到已删预设的测试期望已完成迁移，其中两条把 `bash` 写死、在 Windows 上永远不可能通过。七个随包预设的显示名与说明改为通过 locale 键解析，原来的 `minimal-preset` Web 快照改为钉住 `anchored-standard` 及其 bootstrap 工具对。Web 提示词覆盖按默认值拆分：conversation 与 Goal 车道断言 `s1mple-mode` 的空提示词，fresh round-trip 与 permission-policy 车道则显式选择 `cordis`，继续覆盖提示词与运行时上下文的渲染。WebWorker 预览跟随迁移后的会话头，其打包器在计算包闭包时忽略相对插件说明符，避免本地行被当成名为 `.` 的未解析包。锚定包是 MIT 许可，其版权声明随预置目录一起交付。`linx-mode` 在预设目录内交付 `linx.md`、`.agent/` 与 `docs/`；包的 `files` 配置已发布整个 `presets` 树，shipped-root 测试会执行提示词替换并检查每个被引用的文件。
