# Agent Note: 默认将 Web 绑定到所有 IPv4 接口

Status: implemented

[English](2026-09-18-default-web-bind-all-interfaces.md) | 中文

## 问题

`dsh web` 此前默认只绑定 loopback，并拒绝 `--host 0.0.0.0`。操作者若要从另一台主机访问 GUI，只能依赖反向代理或本地转发；但 `dsh-host-webserver` 已支持 `0.0.0.0`，`resolveLanTrust` 已会推导 LAN authority，Connection 层也早已要求进程令牌浏览器认证。该拒绝还使随附命令无法显式选择 webserver 已支持的绑定。

## 决定

`dsh-web-app` 将组合后的 `webserver.host` 默认值改为 `0.0.0.0`；端口仍为 `3080`。CLI 接受 `--host 0.0.0.0`，也接受 `--host 127.0.0.1` 以恢复仅本机监听。规范 URL 和自动浏览器交接仍使用 `http://127.0.0.1:<port>`；绑定所有接口时，URL 行仍会公告启动时采样到的 LAN 地址。`--trusted-host` 仍是允许额外主机名的方式。

Electron Desktop 宿主组合同一个 Web bundle，但传入 `--host 127.0.0.1`，因此其 `19387` 监听器仍仅限 loopback。浏览器信任保持不变：绑定所有接口时，Connection 插件会推导非 internal IPv4 authority，执行 Host/Origin 校验，并要求每个 API route 与 stream 都持有进程令牌交换后的浏览器会话。载体仍不提供 TLS 或自身认证，因此默认网络暴露使用明文 HTTP。

## 考虑过的替代方案

**保留 loopback，并要求用 `--host 0.0.0.0` 开放网络访问。** 否决：随附默认值必须无需 overlay 就能让 Web 运行时在宿主机的 IPv4 接口上可达。

**默认绑定所有接口，但继续拒绝显式传入 `0.0.0.0`。** 否决：默认值与显式请求指向同一绑定，却会得到不同结果。

**使用 LAN 地址作为规范 URL 和浏览器目标。** 否决：地址会随 DHCP 或网卡变化，而宿主机上的浏览器使用 loopback 更稳定；URL 行已单独公告 LAN 访问地址。

**绑定 IPv6 通配地址 `::`。** 否决：`dsh-host-webserver` 只接受 `127.0.0.1` 和 `0.0.0.0`，当前随附消费者也不要求 IPv6 通配绑定。

## 后果

除非主机防火墙或其他绑定阻止，`3080` 端口会在每个非 internal IPv4 接口上可达。打印的 LAN URL 与启动时采样的 authority 一致，因此启动后新增的主机名或地址需要显式 `--trusted-host` 并重启。

默认传输是明文 HTTP。静态资源与根路径令牌交换可从网络访问；API 仍有 Host/Origin 校验和浏览器认证，但 bearer cookie 未标记 `Secure`。操作者必须使用可信网络、以 `--host 127.0.0.1` 仅限本机访问，或为网络可访问的部署加一层 TLS 反向代理。

本决定部分取代[载体级浏览器信任决策](2026-07-28-api-browser-trust-boundary.zh.md)和[浏览器启动令牌认证](2026-08-24-browser-token-authentication.zh.md)中关于默认 loopback 和 CLI 拒绝的条款；它们的信任与认证机制仍是有效权威。

## 验证

`packages/bundle/web-app/tests/startup.spec.ts` 钉住 `0.0.0.0` 后备值与显式 host flag 的接受行为。随附 profile 配置转储测试钉住默认表达式。启动真实 Web 服务器的集成测试都传入 `--host 127.0.0.1`，使监听器保持为 loopback，同时继续验证浏览器交接、信任检查与浏览器会话。Desktop 宿主在组合时也传入相同的显式 loopback host。
