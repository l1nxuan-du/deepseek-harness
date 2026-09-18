# Styling Reference

## Ownership

- Name the package or directory that owns global tokens, themes, and shared primitives.
- Component packages consume shared styles rather than defining another global system.

## Component rules

- Separate presentation from domain logic. Host or backend presenters remain pure; UI components derive their state from typed data and persisted results.
- Reuse a shared primitive before creating a local variant.
- Keep component styles local unless the value is part of a shared design contract.
- Preserve keyboard focus, reduced motion, and accessible contrast.

## Changing the system

- Change a shared token in its owning source, then consume it through the public alias.
- Update the owning reference and visual tests when a public styling contract changes.
