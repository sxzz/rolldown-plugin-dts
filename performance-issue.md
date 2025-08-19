### Performance regression in watch/build after fixing stale .d.ts

#### Summary

- After fixing watch-mode stale `.d.ts` updates, large packages with many entries build significantly slower (and previously could appear to hang at “Build start”).
- Branch `fix/#80` produces correct sourcemaps and is fast for large projects.
- Branch `fix/watch-tsc-dts` fixes watch-mode correctness (types propagate) but regresses performance on large programs/many entries.

#### Environment

- Monorepo, TS project references (composite projects).
- tsdown + rolldown-plugin-dts, watch mode.
- Plugin: `build: true`, `sourcemap: true`.
- Many entry points (30+), example tsdown config with numerous `entry` keys.

#### Symptoms

- Changing a single entry (e.g. `src/react/index.ts`) triggers rebuilds across all targets. JS re-bundles quickly, but `.d.ts` generation takes very long.
- Example: 133 `.d.ts` files, total ~666kB, build completes in ~150s+ on a large package.

#### Known good baseline (fast + correct sourcemaps)

- Branch: `fix/#80`.
- Approach: build a single comprehensive Program (flattened sources) while normalizing compiler options for correct sourcemaps (remove `rootDir`, `outDir`, `declarationDir`).
- Watch-mode correctness for `.d.ts` was not guaranteed then; that is what we later fixed.

#### Changes that introduced correctness (but slowed builds)

- Branch: `fix/watch-tsc-dts`.
  - Added watch invalidation so `.d.ts` updates propagate on any type changes (including referenced/composite projects).
  - Used TS SolutionBuilder to populate in-memory `.d.ts` for references; then created a (flattened) combined Program for emitting declarations.
  - Initially aggressively recreated Programs; later evolved to reuse via `oldProgram` and selective invalidation.

#### What we tried (in order)

- Aggressive invalidation path
  - `resetContext()` clears cached Programs and virtual FS; worker RPC exposes `reset()`.
  - Watch invalidation forwarded to worker: `invalidate(file)`.
- Always recreate Program before emit
  - Ensured no stale Program reuse; correct but slow.
- Incremental reuse
  - Reuse previous Program via `oldProgram` to limit re-check to affected files.
  - Selective invalidation on `watchChange(id)` instead of full reset.
- Solution build improvements
  - Run TS SolutionBuilder with `force: !incremental` to avoid redundant rebuilds when incremental is enabled.
  - Coalesce concurrent solution builds and cache results in context; mark context `dirty` on invalidation.
- Sourcemap correctness preserved
  - Keep deletion of `rootDir`, `outDir`, `declarationDir` when creating the Program (as in `fix/#80`).
  - Keep `this.addWatchFile(id)` for virtual modules to ensure rebuilds.

#### Current state

- Watch correctness: fixed (type changes in referenced projects update emitted `.d.ts`).
- Sourcemaps: correct (per `fix/#80`).
- Performance: large packages with 30+ entries are still slow; a single change can lead to large `.d.ts` work even with incremental reuse.

#### Likely cause of slowness

- Flattening referenced projects into a single aggregated Program increases root set and type graph size for each emit.
- Many entries share the same Program, but entry-by-entry emits still traverse large declaration graphs.
- Multi-config bundler watch also triggers unrelated targets (separate from TS cost), causing additional work and IO (cleaning dist, re-writing maps).

#### Concrete next steps for investigation

1. Limit flattened sources to reachable files only
   - Instead of including all `fileNames` from every referenced tsconfig, build the transitive closure from entry roots via module resolution (using TS module graph) and use only those files in the aggregated Program. This should retain `fix/#80` sourcemap behavior with far fewer files.

2. Prefer projectReferences (no flatten) and still keep sourcemaps correct
   - Preserve `projectReferences` and rely on declaration redirects; continue removing `rootDir`/`outDir` options to keep maps correct. Verify against `fix/#80` sourcemap expectations.

3. Single long-lived Program for all entries
   - With `eager: true`, construct one Program for the full entry set once, and reuse it for emits; ensure watch invalidation updates the single Program incrementally.

4. Emit skip when unchanged
   - Cache last-emitted `.d.ts`/`.map` content hashes and skip writing identical outputs. Reduces IO and avoids "Cleaning N files" churn.

5. Smarter solution build invalidation
   - Only rerun SolutionBuilder when referenced project outputs changed (watch `.tsbuildinfo` or `.d.ts` mtimes in memory). Avoid solution rebuilds when a change is isolated to non-referenced local code.

6. Split builds or limit watch globs (bundler-level)
   - For multi-target repos, run separate watch processes per target (e.g., server vs react) or narrow watch include patterns, so unrelated targets do not trigger full rebuilds.

7. Add profiling hooks
   - Enable TS perf logging and measure time distribution (solution build vs createProgram vs emit). Add a benchmark script for reproducible measurements across branches.

#### Branch pointers

- Fast + correct sourcemaps: `fix/#80`.
- Correct watch updates (current): `fix/watch-tsc-dts`.

#### Acceptance criteria

- Watch correctness: type changes in referenced projects reflect in emitted `.d.ts` without restart.
- Sourcemaps: identical to `fix/#80`.
- Performance: large package with 30+ entries rebuilds in seconds (not minutes) for a single-file change.
