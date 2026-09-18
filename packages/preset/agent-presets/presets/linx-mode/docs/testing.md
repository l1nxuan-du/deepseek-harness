# Testing Policy

Tests describe current behavior, not abstract correctness. When behavior changes intentionally, update its tests in the same change and explain the new contract.

## Test tiers

- Match evidence to the surface: focused behavior tests, integration tests for boundaries, build and type checks for public contracts, and documentation checks for docs.
- Add the smallest test tier that can detect the failure being prevented.

## Test execution

- Run the narrowest check that can falsify the change.
- Never default to the full suite. Run it only when explicitly requested, when diagnosing CI, or when the change is irreducibly repository-wide.
- CI owns exhaustive coverage and the platform matrix.
- Report only commands actually run and any checks not run.

## External-service policy

- Define whether tests requiring external credentials, network access, or paid services run, skip, or use a recorded fixture.
- Never make an external-service failure look like a passing test.

## Prefer real implementations over mocks

- Prefer the production implementation for behavior that the test must verify.
- Mock only external boundaries that cannot be exercised reliably, and document what the mock does not prove.

## Verify behavior, not self-reported status

- Verify observable behavior, side effects, and persisted results rather than status messages or self-reported success.
- Assert the failure mode as well as the happy path when the contract requires one.

## Test through real entry points

- Test through real entry points and public APIs.
- Avoid tests that construct an internal state no supported entry path can create.

## Source and build resolution

- State whether a test resolves source files or built artifacts.
- Build-consuming tests must declare the build as a dependency and fail clearly when it is stale or missing.

## Subprocess tests

- State which launcher, environment, working directory, and platform a subprocess test uses.
- Keep subprocess setup and cleanup owned by the test harness.

## Mechanical invariants

- Wire mechanically checkable invariants into an executed check.
- Add a failing case proving each changed acceptance path rejects invalid input.

## When snapshot tests are required

- Every non-trivial user-visible or externally observable behavior change updates its golden or snapshot test in the same change.
- Fix the fixture or expected output at its owner; do not hide a regression in a normalizer.
