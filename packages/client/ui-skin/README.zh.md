---
description: "dsh Web 客户端的界面皮肤设置：经典/新版界面切换、通用设置项、限定作用域的新版样式表，以及背景场。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skin

[English](README.md) | 中文

## 概述

`dsh-client-ui-skin` 让 Web GUI 用户在设置中选择界面：`material`（按设计稿实现的新版界面，玻璃材质加渐变背景场，也是默认值）与 `classic`（现有界面）。回环页面上的选择保存在 `ui-skin` 设置命名空间，本地 provider 默认持久化到 `$DSH_HOME/settings.yaml`。插件把选择投影到文档上——一个根属性、一层别名 token、一个背景元素——并内置新版样式表，其每条规则都以该根属性为选择条件。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用户在设置（通用分区）的“界面”一项中切换界面；在回环页面上该选择跨重启保留。部署方像挂载其它客户端包一样挂载本插件：宿主半注册 `ui-skin` 设置分区，并在每次返回首页时附带引导脚本；浏览器半注册该设置项并应用界面。

### 界面设置项

该项提供两个选项块。`material` 是默认值，增加玻璃材质、内嵌的对话面板，以及界面所浮于其上的背景场；`classic` 按框架自身几何渲染现有界面。每次接受的变更都通过宿主设置 API 写入，被拒绝的写入会回读持久值。

### 在应用挂载前选中界面

宿主半把持久化的界面取值写入每次首页响应。body 脚本在应用模块运行前把它发布为 `html[data-dsh-skin]`，head 样式先铺好新版画布底色，浏览器运行时则以该发布值作为起点——于是页面已画出的界面与运行时投影的界面保持一致。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

### 运行时投影的内容

`SkinRuntime` 持有当前界面取值，并为设置项发布不可变快照。一个投影步骤负责该取值在文档层面的全部写入：

- `document.documentElement` 上的 `data-dsh-skin` 属性，它标明当前选择，新版样式表的每条规则都以它为前提；
- 通过 `ctx.theme.overrideTokens` 写入的一层别名 token，覆盖现有组件已在使用的配色轴（页面、分层表面、文字、边框、链接、交互填充、侧栏填充、气泡、菜单）；
- 背景场：一个前置到 body 的固定定位元素。

选择 `classic` 会撤销 token 层与背景场，并让属性标明当前是经典界面，因此现有界面与未安装本插件时完全一致。本包不提供 service：设置项通过注册时的 inject 面写入取值，并通过运行时写入的 store 读取变更。

### 样式作用域

新版样式表是全局样式，但每条选择器都要求根属性，因此安装它不会改动经典界面。规则通过现有组件渲染所在的 slot 座位（`[data-slot='sidebar']`、`[data-slot='conversation.composer.bar']` 等）以及被改写组件的稳定类名后缀抵达它们。配色轴走别名 token 层而不是样式表，因此菜单、浮层与卡片无需复制样式即可跟随新版配色。

### 背景场

背景场是普通 DOM 而非 React：一个固定元素，包含渐变层、网格层，以及用 CSS 表达的指针光晕。指针位置合并到同一动画帧，落到两个自定义属性上；光晕是样式表按属性切换的径向渐变。背景场不承载任何产品状态。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Web 样式规范](../../../docs/web-styling.zh.md)——Web 客户端组件的样式规则。
- [ui-theme](../ui-theme/README.zh.md)——token 样式表，以及本包所覆盖的别名 token 层。
- [ui-layout](../ui-layout/README.zh.md)——框架、列，以及主题投影器。
- [界面皮肤 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-19-interface-skin-layer.zh.md)——为什么界面选择是一个按属性限定作用域的层，而不是第二套 shell。

-----

<a id="model-experience"></a>
## 模型体验

无：本包是浏览器侧界面层，不注册任何面向模型的内容。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **样式表与现有界面的 DOM 耦合**——它选择 slot 座位与稳定的类名后缀，因此重命名这些组件时必须同步更新样式表；浏览器 e2e 用例会在选择器失配时失败。
- **背景场是设计稿的 CSS 实现，而非其画布**——渐变、网格与指针光晕由 CSS 完成；设计稿中的 WebGL 流动图案与格网画布尚未移植。
- **两层可能写入同一别名 token**——注册的主题与本皮肤都会写别名 token，后写入的层按 token 生效；新版配色不是一次主题注册。
- **新版样式表随插件包抵达**——冷启动会在应用挂载前发布选择并铺好画布底色，但在该包抵达之前界面仍是经典的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

新版取值来自两份 `harness-chat` 设计稿页面（`index.html`、`new-chat.html`）：token 约定、材质配方与背景场渐变。设计稿中的落地页图形与着色器版权归 DeepSeek。

</details>
