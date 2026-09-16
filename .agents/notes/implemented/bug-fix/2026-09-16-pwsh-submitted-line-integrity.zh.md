# Agent Note: Persistent pwsh submitted-line integrity

Status: implemented

[English](2026-09-16-pwsh-submitted-line-integrity.md) | 中文

## Problem

`@deepseek-ai/dsh-tool-pwsh-persistent` 每条命令提交一行包装文本，并把提取区间锚定在 shell 打印出的 START 标记上。在 Windows、pwsh 7.6.6 与 PSReadLine 2.4.5 上，包装行到达 shell 时丢了首字符（`rite-Output ...`），于是首条语句抛出 `CommandNotFoundException`，START 标记从未被打印，提取退回到该行的回显副本，约 1.3 KB 的回显包装与错误文本一起进入模型上下文。命令执行、输出与退出码不受影响，且报告者观察到该丢失是间歇性的。

在报告所在栈上复现（node-pty 1.2.0-beta.15、pwsh 7.6.6、PSReadLine 2.4.5、Windows 11 26200）：同一会话中 40 次调用有 40 次丢失首字符，`$Error[0].Exception.CommandName` 报出 `rite-Output`，原始 ConPTY 流里带有 PSReadLine 在插入该字符时的自崩溃报告。

## Decision

两处缺陷对应两处改动。

`dsh-terminal-bash` 的 pwsh 引导在提示符函数之前，把 `Set-PSReadLineOption -PredictionSource None -HistorySaveStyle SaveNothing` 前置到它提交的那条设置行，因此 shell 永远不会渲染行内预测，也不会把提交行追加进控制台宿主的历史文件。

`dsh-tool-pwsh-persistent` 在 `outputStart` 中锚定输出起点：定位在 shell 打印出的 START 标记之后；若没有打印 START 标记，则定位在回显行的 END 标记之后。此前的 `replaceAll(wrapper, '')` 回退逻辑被删除。

### Why the first character vanished

当没有设置文件、也没有 profile 定义选项时，PSReadLine 2.4.5 默认使用 `PredictionSource=HistoryAndPlugin` 与 `PredictionViewStyle=InlineView`。它会在字符到达时把被预测的历史条目渲染进输入行。渲染一条很长的预测会让渲染器崩溃：`System.IndexOutOfRangeException` 由 `System.Text.StringBuilder.get_Chars(Int32)` 经 `Microsoft.PowerShell.PSConsoleReadLine.ConvertOffsetToPoint`、`ReallyRender`、`ForceRender`、`Render`、`Insert`、`SelfInsert` 抛出。崩溃的读取器丢弃了自己的缓冲区（包括当时正在插入的那个字符），队列中剩余的输入由新的读取器读取——于是 shell 执行的是提交行去掉首字符后的内容。

被预测的条目是本工具此前提交过的一条包装行。PSReadLine 的 `HistorySaveStyle` 会记录每一条提交行到控制台宿主共享的 `ConsoleHost_history.txt`；首次测量时该文件 4693 行中有 1475 行是工具包装行，其中包含数 KB 的粘贴命令对应的包装行。这解释了丢失为何看起来间歇：决定预测渲染内容的是最新的匹配条目。

### Why the echo reached the model

`commandOutput` 取 END 标记之前最后一次出现的 START 标记。首条语句失败时，唯一的一份出现在 PSReadLine 的回显里，而回显中该标记后面跟的是包装行的收尾引号；于是被截取的区间从回显中间的 `'` 开始，`replaceAll(wrapper, '')` 无法匹配一份不完整的副本。回显副本本身也不是一次忠实的渲染：PSReadLine 会在输入到达时重绘整行，因此保留文本是被 sanitizer 转成换行的回车符分隔的多段部分渲染的拼接。改为锚定打印出的 START 标记、或回显行 END 标记所在行的行尾，等于用构造方式而非字符串匹配来界定回显边界。

## Alternatives considered

- **让包装行以一个丢掉了也无害的字符开头。** 否决：PSReadLine 在每次插入字符时都会重新计算预测，因此发生在更靠后插入处的崩溃会丢掉中间字符并悄悄破坏命令。只有消除崩溃来源才能限定损害范围。
- **把回显的包装当作文本匹配并剥离。** 否决：回显是多段部分重绘的序列，包装行很少作为一整段连续字符串出现；已归档的 [持久 pwsh 笔记](../../archived/architecture/2026-08-11-pwsh-persistent-pty.md)选择了这一机制，并把它记录为残留泄漏。本笔记用由标记推出的边界替换该机制。
- **保留预测，改用 `-AddToHistory:$false`。** 否决，因为不可用：PSReadLine 2.4.5 没有该参数，前缀匹配会把它绑到 `-AddToHistoryHandler`，导致整次调用失败且 `PredictionSource` 保持不变。
- **让 pwsh 非交互运行，或替换行编辑器。** 否决：这个 shell 存在的意义就是承载交互式子 REPL，`-NonInteractive` 会改变宿主行为、就绪证据与渲染方式。在设置行上固定两个选项可以保留交互式宿主。
- **把截断当作 PSReadLine 的上游缺陷并只做记录。** 否决：被截断的提交执行的是与模型所要求不同的命令，而这一行由本工具提交。固定选项同时还让合成的包装行不再进入用户自己的 shell 历史。
- **对 `dsh-tool-bash-persistent` 施加同样的提取改动。** 否决：bash 的 readline 不渲染预测，观察到的机制不可能在那里发生，而 bash 工具也从未有过包装源码剥离。它的提取保持现状——本机没有 POSIX shell，无法验证。

## Consequences

**pwsh 方言不再渲染预测，也不再记录历史。** 引导行之后，提交行不再进入控制台宿主共享的历史文件（该选项在引导行执行时才生效，因此引导行本身仍会被记录），shell 也失去了行内预测与基于历史的建议。

**提取不再依赖包装行原样出现。** 在以往会退回到回显的路径上，回显的包装已不可能进入模型；只有当保留下来的 scrollback 窗口本身从回显内部开始时，才可能残留片段，并受 `maxOutputChars` 设界。

**验证。** 撤销固定选项后，同一套产品栈 harness 复现出 40 次调用全部截断，原始流复现出 12/12 崩溃与 12/12 丢字符；在同一状态下改用 `-PredictionSource None` 为 0/12，使用全新历史文件同样为 0/12。改动之后 40 次调用全部干净，工具所在 shell 报出 `PredictionSource=None` 与 `HistorySaveStyle=SaveNothing`，共享历史文件在 20 次调用中只增加一行，而不是每次调用一行。`tool-pwsh-persistent` 的桩模式覆盖了从未打印 START 标记的提交，包括一次完整回显渲染与 PSReadLine 的分段渲染两种形态；两者在此前的提取实现下都会失败。`terminal-bash` 的 pwsh 通道断言 shell 的行编辑器设置，去掉固定选项后它以 `HistoryAndPlugin/SaveIncrementally` 失败。

**覆盖缺口。** 没有任何自动化测试复现 PSReadLine 的崩溃本身：它需要 PSReadLine 2.4.x、真实的 ConPTY，以及一份最新匹配条目会渲染越界的宿主历史文件。`terminal-bash` pwsh 通道里的固定选项断言也只在随产品提供 pwsh、且未被仓库测试清单在 Windows 上排除的宿主上运行，因此本次改动在 Windows 原生的证据是上文记录的手工复现。
