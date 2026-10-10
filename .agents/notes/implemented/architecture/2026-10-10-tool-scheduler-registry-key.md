# Agent Note: A process-global registry key for the tool scheduler

Status: implemented

English | [中文](2026-10-10-tool-scheduler-registry-key.zh.md)

## Problem

`agent-loop` reaches the tool registry's internal scheduler through `ctx.tools[TOOL_RUNTIME_SCHEDULER]`, a symbol-keyed property deliberately omitted from the generated named service API. The key was minted with `Symbol(...)`, so it is unique per module evaluation: `agent-loop`'s copy of the key addresses the property only while both packages resolve to the same module instance.

The fork publishes one installable package that bundles the whole release family, and a consumer's tree can then hold more than one copy of `@deepseek-ai/dsh-tools` — the source launcher resolves the bare import to `packages/core/tools/src/index.ts` through tsx `paths` while a built plugin profile imports the same package from `lib/`. Two copies produce two symbols, `ctx.tools[symbol]` reads `undefined`, and the scheduler call throws `TypeError` on every tool call rather than intermittently.

## Decision

`TOOL_RUNTIME_SCHEDULER` is minted with `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`, so every copy of the package in one process resolves the same key from the global symbol registry. The declaration stays a `unique symbol`, the property remains absent from the generated service API, and nothing about a single-copy process changes.

`packages/core/tools/tests/tools.spec.ts` pins the registry identity, so a future sync that restores `Symbol(...)` fails a unit test instead of failing every tool call in a bundled consumer tree.

## Alternatives considered

**Keep `Symbol(...)` and prevent duplicate copies.** npm's install layout, not this repository, decides how many copies a consumer tree holds; the source-launcher/built-profile split inside one checkout already produces two without any consumer mistake.

**Route the scheduler through a named service method.** The scheduler is an internal entry point that the public service contract deliberately does not carry; publishing it to make the key redundant would widen the tool service's API for a packaging accident.

## Consequences

The key is no longer strictly private: code that knows the string can reach the scheduler without importing the constant. Nothing else changes — the symbol does not serialize, and same-copy behavior is identical. The comment beside the declaration states why the registry form is required, because the plain `Symbol(...)` form looks equivalent to a reader who has not seen a duplicated tree.
