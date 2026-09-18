# AGENTS.md

## Scope

- This directory owns agent-specific reference material, workflows, and durable notes.
- Keep repository-wide rules in the root agent instructions and detailed behavior in docs.

## Structure

- `notes/` contains active, implemented, and archived decision notes.
- `skills/` contains reusable agent procedures and their validation instructions.

## Workflow

- Read the source reference that owns the task before changing it.
- Keep each rule at one level: root for standing orders, subtree files for local orders, and docs for detailed contracts.
- Record non-trivial decisions in `notes/` in the same change.

## Validation

- Verify referenced paths before relying on them.
- Check that notes match shipped behavior and that skills have explicit success criteria.

## References

- `../docs/AGENTS.md`
- `../docs/development.md`
- `../docs/testing.md`
