# AGENTS.md — The documentation standard

## Document structure

- Every document has one subject and stays within the detail level of its tree position.
- Link to the owning document instead of restating lower-level detail.
- Separate tutorial sequences from reference material.
- Tutorials introduce only what each step needs; references define lookup scope and current behavior.

## Ownership model: one home per fact

- Each fact has one authoritative home. Link to it elsewhere instead of duplicating it.
- Put rationale in decision records, procedures in how-to guides, and incidents in postmortems.
- When source or a generator owns a schema, catalog, type definition, or inventory, generate it or link to it. Never hand-maintain a divergent copy.

## Writing rules

- Document current behavior, not history.
- Documentation accompanies code changes. Update affected README, API reference, examples, and comments in the same change.
- Comments and API documentation state contracts and context, not reasoning transcripts. Preserve behavior, failure, timing, ownership, exceptions, and consequences.
- Remove code restatement, test narration, review history, and implementation-status notes.
- Use narrow, justified exceptions. Do not disable a rule globally when a local exception is sufficient.
- Files end with exactly one trailing newline.

## Wordcount Budgets

- Standing documents have explicit size budgets.
- Exceed a budget only when the content genuinely requires the space and the increase is justified.
- When over budget, relocate content to its owner, condense it, then raise the budget with justification.

## Quality checklist

- Remove duplicated rules, hand-maintained inventories, reasoning transcripts, paragraph walls, and emphasis inflation.
- Prefer concrete terms over metaphors.
- Keep current facts in maintained docs; link historical material to its owner.
- Validate local links and generated references.

## References

- Use relative Markdown links for current files.
- Use tags, commits, or change IDs for historical references when appropriate.
