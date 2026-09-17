# Agent Note: apply_patch 工具进入默认 fs 工具集

Status: implemented

[English](2026-09-15-apply-patch-tool.md) | 中文

## 问题

harness 的编辑表面是 `read`/`write`/`edit`(外加需显式启用的 `str_replace_editor`)。按 Codex 训练出来的模型会伸手去拿 `apply_patch`:一个信封里完成新增、更新、移动与删除多个文件,并且任何路径与 hunk 都在写入前检查完毕。没有它,这些模型要么把一次多文件改动翻译成一串单文件编辑——丢掉它们依赖的「全有或全无」预检——要么退到 shell heredoc,从而完全绕过文件系统接缝的策略。

参考实现位于一个第三方插件包里,因此语法、整行匹配与诊断词汇都可以移植;本记录要留下的是移植过程中的决策。

## 决策

`packages/fs/tool-apply-patch`(`@deepseek-ai/dsh-tool-apply-patch`)注册面向模型的 `apply_patch` 工具,并由 `packages/bundle/base/cordis.patch.yml` 以及 `standard`、`ptc`、`cordis` 三个 preset 挂在 `tool-fs` 旁边,因此它属于默认工具清单,而不是一个需显式启用的组合包。

该工具接受一个字符串参数,即补丁信封,并基于 `ctx.fs` 应用:`*** Begin Patch` … `*** Add File:` / `*** Update File:`(首个 hunk 之前可有 `*** Move to:`,某个 hunk 之后可有 `*** End of File`) / `*** Delete File:` … `*** End Patch`。hunk 按参考工具自身的宽容度匹配整行——先精确,再忽略首尾空白,最后折叠常见排印标点——重复文本取前一个 hunk 之后的第一个匹配,`@@ <text>` 只移动搜索起点,仅由新增行组成的 hunk 插入到文件末尾,未触碰的行保留自身终止符而插入行沿用文件的第一个终止符。`*** Add File: ` 覆盖已存在的路径,`*** Move to: ` 覆盖已存在的目标,与参考实现完全一致;删除非常规文件会被拒绝。预检会在内存覆盖层上重放每一个操作,因此确定性失败(路径缺失、hunk 匹配不到、非常规文件)不会写入任何字节;提交阶段随后重新校验并打印参考实现的摘要——`Success. Updated the following files:` 以及每个路径一行 `A`、`M` 或 `D`。变更走与 fs 家族其余部分相同的 `fs/write-intent` / `fs/edit-intent` 瀑布与 `fs/observed` 记录,因此已挂载的策略与沙箱围栏依然生效。

与参考实现有两处刻意分歧。删除经由 `ctx.get('shell')` 执行,因为 `ctx.fs` 不暴露删除操作;同时请求携带**会话的**沙箱策略——参考实现没有传,那会让只读会话通过一个默认为部署模式的 shell 完成删除。另外,presenter 使用通用编辑卡片:调用期的 presenter 只能看到补丁文本,无法算出差异卡片所需的逐文件 diff,伪造 diff 等于错报改动。面向模型的描述也写明了真实的原子性边界——只有写入本身才能报告的失败(文件在读取后发生变化、沙箱拒绝)会保留此前的操作——而不是承诺一个提交阶段并未实现的回滚。

该工具对同一个输入声明两种呈现。支持语法约束自定义工具的线协议会把信封作为自由格式文本提供,并由参考实现自己的 Lark 语法约束([`src/grammar.ts`](../../../../packages/fs/tool-apply-patch/src/grammar.ts),逐字复制),因此模型书写补丁时无需 JSON 转义,工具层会把原始文本作为声明的 `patch` 参数送达;其余线协议仍保留 JSON 函数形态。声明语法是默认行为,若端点拒绝自定义工具,设置 `freeform: false` 即可去掉它。

## 曾考虑的替代方案

**像 `tool-str-replace-editor` 那样作为需显式启用的组合包交付。** 不予采纳:目标是开箱即用的 Codex 对等编辑,而每个挂载 fs 套件的表面本来就在同一层挂载 `tool-fs`。

**通过 `ctx.fs` 删除。** 不予采纳:该服务没有删除操作,为单个工具新增一个会扩大文件系统契约;而进程级删除本就归 shell 服务所有,并在沙箱之下执行。

**使用差异卡片 presenter。** 同上不予采纳:`DiffCallView` 需要 presenter 在执行前无法知道的 `diffs`。

**模糊(空白归一化)hunk 匹配。** 不予采纳:精确整行匹配正是「被应用的补丁可证明就是模型写的那份」的依据,而静默的近似应用正是补丁工具存在的意义所要防的失败模式。

## 后果

默认清单现在提供 Codex 风格的信封,并且确定性的补丁失败零成本:任何路径或 hunk 被拒绝时不写入任何内容。

代价是明确的。两种编辑表面并存(`read`/`write`/`edit` 套件与 `apply_patch`),由模型选择;交付的工具清单、生成的工具目录以及 CLI/Web 清单断言都随之移动。删除需要 shell 服务:挂载了 `tool-apply-patch` 却没有 `ctx.shell` 的组合会在第一次删除时大声失败,而不是静默降级。`= <path>` 仍会发出提交阶段自身的那次读取观测,因为已挂载的编辑前读取策略以行为者的观测状态为键,否则会拒绝补丁即将进行的写入。

覆盖:该包的聚焦 spec(57 个测试,`src/**` 逐文件 100% 覆盖)钉住语法、匹配与每一种拒绝、CRLF 保留、整包预检、删除/移动路径以及 presenter。
