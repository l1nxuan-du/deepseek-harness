# Configuration Reference

- Deployment-varying values must be explicit, validated configuration. Keep protocol constants and security invariants fixed; do not hide defaults inside execution paths.
- Invalid configuration and missing dependencies must fail at the earliest detectable point with a clear error. Never silently skip unresolved references.

## Configurable components

### `<component>`

- List each configurable field, its type, default, validation rule, and runtime effect.
- Link to the source declaration rather than copying a divergent type.

## Components without configuration

- List components that intentionally expose no deployment configuration and state why.

## Extension packages

- List packages that extend another capability but are not directly loadable.
- Name the owning extension point for each package.

## Library packages

- List reusable libraries with no executable entry point.
- State whether the package is public, internal, or vendored.
