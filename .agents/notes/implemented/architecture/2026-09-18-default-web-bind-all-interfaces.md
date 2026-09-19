# Agent Note: Default Web bind on all IPv4 interfaces

Status: implemented

English | [中文](2026-09-18-default-web-bind-all-interfaces.zh.md)

## Problem

`dsh web` shipped with a loopback-only default and refused `--host 0.0.0.0`. An operator could reach the GUI from another host only through a reverse proxy or a local forwarding setup, even though `dsh-host-webserver` already supported `0.0.0.0`, `resolveLanTrust` already derived LAN authorities, and the connection layer already required process-token browser authentication. The refusal also made the supported webserver bind impossible to select explicitly through the shipped command.

## Decision

`dsh-web-app` defaults the composed `webserver.host` to `0.0.0.0`; the port remains `3080`. The CLI accepts `--host 0.0.0.0` and accepts `--host 127.0.0.1` to restore a local-only listener. The canonical URL and automatic browser handoff remain `http://127.0.0.1:<port>`, while the URL line continues to advertise sampled LAN addresses for an all-interfaces bind. `--trusted-host` remains the way to admit additional names.

The Electron Desktop host composes the same Web bundle but passes `--host 127.0.0.1`, so its `19387` listener remains loopback-only. Browser trust is unchanged: the Connection plugin derives non-internal IPv4 authorities for an all-interfaces bind, applies the Host/Origin fence, and requires the process-token browser session on every API route and stream. The carrier still provides neither TLS nor its own authentication, so the network exposure is plain HTTP by default.

## Alternatives considered

**Keep loopback and require `--host 0.0.0.0` for network access.** Rejected because the shipped default must make the Web runtime reachable on the host's IPv4 interfaces without an overlay.

**Default to all interfaces but continue rejecting an explicit `0.0.0.0`.** Rejected because the default and the explicit request would name the same bind while producing different outcomes.

**Use a LAN address as the canonical URL and browser target.** Rejected because the address can change with DHCP or interface changes, while loopback remains stable for a browser on the host; the URL line already advertises LAN access separately.

**Bind the IPv6 wildcard `::`.** Rejected because `dsh-host-webserver` accepts only `127.0.0.1` and `0.0.0.0`, and no current shipped consumer requires IPv6 wildcard binding.

## Consequences

Port `3080` is reachable on every non-internal IPv4 interface unless a host firewall or a different bind blocks it. The printed LAN URL matches the authorities sampled at startup, so a hostname or an address added after startup requires an explicit `--trusted-host` and a restart.

The default transport is plain HTTP. Static assets and the root token exchange are reachable from the network; the API remains behind Host/Origin checks and browser authentication, but the bearer cookie is not marked `Secure`. Operators must use a trusted network, `--host 127.0.0.1` for local-only access, or a TLS reverse proxy for a network-accessible deployment.

This decision partially supersedes the loopback-default and CLI-rejection clauses in [the carrier-level browser-trust decision](2026-07-28-api-browser-trust-boundary.md) and [browser launch-token authentication](2026-08-24-browser-token-authentication.md). Their trust and authentication mechanisms remain active authority.

## Verification

`packages/bundle/web-app/tests/startup.spec.ts` pins the `0.0.0.0` fallback and the accepted explicit host flag. The shipped profile config dump test pins the default expression. Integration tests that start a real Web server pass `--host 127.0.0.1` to keep their listeners loopback while they verify browser handoff, trust checks, and the browser session. The Desktop host passes the same explicit loopback host at composition time.
