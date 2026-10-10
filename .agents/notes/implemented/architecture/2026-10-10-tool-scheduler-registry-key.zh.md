# Agent Note: 工具调度器的进程级注册表键

Status: implemented

[English](2026-10-10-tool-scheduler-registry-key.md) | 中文

## Problem

`agent-loop` 通过 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 访问工具注册表的内部调度器，该属性以符号为键，并被刻意排除在生成的命名服务 API 之外。键由 `Symbol(...)` 生成，因此每次模块求值都会新建一个：只有当两个包解析到同一个模块实例时，`agent-loop` 持有的键才能取到该属性。

本 fork 发布的是一个自带整个发布族的可安装包，因此使用方的依赖树里可能出现不止一份 `@deepseek-ai/dsh-tools`：源码启动器通过 tsx 的 `paths` 把裸导入解析到 `packages/core/tools/src/index.ts`，而已构建的插件档案则从 `lib/` 导入同一个包。两份副本产生两个符号，`ctx.tools[symbol]` 读到 `undefined`，调度器调用对**每一次**工具调用都抛 `TypeError`，而不是偶发失败。

## Decision

`TOOL_RUNTIME_SCHEDULER` 改用 `Symbol.for('@deepseek-ai/dsh-tools.scheduler')` 生成，于是同一进程内该包的每一份副本都从全局符号注册表解析到同一个键。声明仍然是 `unique symbol`，该属性仍不出现在生成的服务 API 中，单副本进程的行为毫无变化。

`packages/core/tools/tests/tools.spec.ts` 固定了这个注册表身份，因此后续同步若恢复成 `Symbol(...)`，会先让单元测试失败，而不是让打包后的使用方树里每一次工具调用都失败。

## Alternatives considered

**保留 `Symbol(...)`，改为阻止副本重复。** 使用方依赖树里会有几份副本由 npm 的安装布局决定，不由本仓库决定；而单个检出内部，源码启动器与已构建档案的并存本身就已经产生两份，与使用方是否出错无关。

**把调度器改成具名服务方法。** 调度器是被公开服务契约刻意排除的内部入口；为了让这个键变得多余而公开它，等于为了一个打包事故扩大工具服务的 API。

## Consequences

该键不再是严格私有的：知道字符串的代码可以不导入常量就取到调度器。除此之外没有变化——符号不参与序列化，同副本行为完全一致。声明旁的注释写明了为何必须使用注册表形式，因为对没见过副本重复的读者来说，普通的 `Symbol(...)` 写法看起来完全等价。
