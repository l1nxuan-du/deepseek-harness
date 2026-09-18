# Package scope migration

## Name mapping

- Map old package names, import paths, and configuration keys to their new values.
- Identify every generated or published artifact affected by the migration.

## Unchanged behavior

- State what remains stable during the migration.
- Call out compatibility guarantees and planned removal points.

## Required code changes

- List consumer updates, dependency changes, and verification commands.
- Never rewrite committed data or published packages in place.

## Apply, verify, and rollback

- Describe the migration procedure, validation steps, and rollback path.
- Record any manual action that cannot be automated.

## Vendoring policy

- Vendored packages are pinned source copies. Update them through the documented sync procedure, record local modifications, and rerun the affected tests and build.
