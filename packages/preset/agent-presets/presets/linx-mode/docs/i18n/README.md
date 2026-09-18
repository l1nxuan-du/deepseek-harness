# i18n

English | [中文](README.zh.md)

## Contract

- User-facing UI text is locale-owned. Route strings through typed localization dictionaries; do not hardcode display text.
- Keep locale keys stable and link each key to its owning surface.

## Terminology

- Define terms once and use the same term across source, docs, and UI.
- Record intentional differences between locales.

## Translation workflow

- Describe how strings are extracted, reviewed, translated, and released.
- Keep machine translation separate from human review state.

## Validation

- Check missing keys, unused keys, placeholder parity, and fallback behavior.
- Include locale-specific formatting tests where the platform requires them.
