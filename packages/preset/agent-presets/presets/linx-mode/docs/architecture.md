# Architecture

## Overview

- Describe the project's composition, main responsibilities, and the documents that own lower-level detail.
- Keep this file an ordered map rather than an exhaustive reference.

## Runtime composition

- Describe how the application is assembled and which components are replaceable.
- Name the extension points, lifecycle, and configuration boundaries involved in startup.

## Application entry points

- List supported entry points and the code path each one takes.
- Separate library APIs from executable or service entry points.

## Application shell

- Describe the host or user-facing shell and its relationship to domain modules.
- Link platform-specific behavior to its owning reference.

## Core modules

- Give each module one primary responsibility and a documented interface.
- Prefer symmetry for parallel values; unexplained asymmetry usually signals a missed extraction or inconsistent contract.

## Event flow

- Describe event ownership, ordering, delivery guarantees, and failure behavior.
- Distinguish events that are part of the public contract from internal notifications.

## Execution flow

- Describe the normal request, task, or command path and its cancellation and timeout behavior.
- Resources registered by a component must be disposable. Teardown must restore prior state and release timers, listeners, processes, and handles.

## State and persistence

- Persisted formats are versioned contracts. Add a new versioned successor for structural changes; never rename, overwrite, or delete committed data.
- Document compatibility and migration behavior.
- Any input that can change externally visible output must be reconstructable from logs or persisted metadata.

## Trust boundaries

- Trust static types within the same process.
- Validate at parser, configuration, network, file, process, queue, and other trust boundaries where data can be malformed or hostile.

## Error handling

- Invalid configuration and missing dependencies must fail at the earliest detectable point with a clear error. Never silently skip unresolved references.
- An empty catch block must name the error and explain why it can be ignored. Keep its try block scoped to one operation.

## Type and state invariants

- Switch exhaustively on discriminant values. Closed unions end in an unreachable branch; extensible unions use a documented default.
- Opaque identifiers crossing module, process, storage, or wire boundaries must use dedicated wrapper types, never bare strings.
