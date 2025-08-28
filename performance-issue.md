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

#### What changed between branches (diff highlights)

- Program creation and caching
  - fix/#80: Reused `context.programs` when possible; created Program on-demand and cached it.
  - fix/watch-tsc-dts: Always creates a new Program for every emit and replaces cache (`context.programs = [program]`). Additionally, `tscEmit` clears cached programs before emit.
- Solution builder behavior
  - fix/#80: `force: !incremental` (respects incremental builds; avoids rebuilds when not needed).
  - fix/watch-tsc-dts: `force: true` (always rebuilds the entire solution in watch).
- Invalidation strategy
  - fix/#80: Targeted invalidation via `invalidateContextFile(file)`.
  - fix/watch-tsc-dts: Global resets on `watchChange()` (clears `files` and `programs`, or `rpc.reset()`), plus `this.addWatchFile(id)` to ensure virtual module invalidation.
- Aggregation approach (from fix/#80 and retained in fix/watch-tsc-dts)
  - Build a single comprehensive Program by aggregating all `.ts` sources from all referenced projects; remove `rootDir`, `outDir`, `declarationDir` to fix sourcemap paths.

Net effect: In watch mode, every change triggers a solution rebuild and a fresh, large Program recreation, then repeats per entry during emits.

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

#### Why it happens (root cause)

- The aggregated Program contains sources from all referenced projects, inflating graph size.
- Watch invalidation now clears caches and forces full solution rebuilds on every change.
- Program is recreated before emits and not reused across entries; with many entries, the cost multiplies.

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

#### Proposed clean architecture (preserve sourcemaps + watch correctness)

1. Long-lived aggregated Program per tsconfig root (preferred immediate fix)

- Keep the aggregated Program approach from fix/#80 to guarantee sourcemaps to `.ts`.
- Reuse a single Program across all entries and emits. Pass `oldProgram` into `ts.createProgram` to enable incremental updates.
- Revert aggressive resets: on `watchChange(file)`, call targeted `invalidateContextFile(file)` and mark context dirty without clearing everything.
- Solution builder: restore `force: !incremental`. Only rerun when referenced outputs actually change. Coalesce concurrent builds.

2. Reduce scope of aggregated sources (medium-term)

- Instead of union of all referenced projects' `fileNames`, compute the transitive closure of files reachable from the active entry set using TS module resolution, and include only those in the aggregated Program.
- Keep removal of `rootDir`/`outDir`/`declarationDir`. Verify sourcemaps remain identical to fix/#80.

3. Output/change skipping (low-risk optimization)

- Cache last-emitted `.d.ts` and `.map` content hashes per entry; skip writing and avoid downstream IO churn when unchanged. Avoid repeated emits when inputs did not change.

4. Smarter solution rebuild trigger

- Track `.tsbuildinfo`/`.d.ts` versions in memory; rerun solution build only if referenced outputs changed. Avoid rebuilding solution for leaf-only edits.

Acceptance remains:

- Sourcemaps identical to fix/#80; watch correctness maintained; rebuilds in seconds on single-file changes even with many entries.

#### Branch pointers

- Fast + correct sourcemaps: `fix/#80`.
- Correct watch updates (current): `fix/watch-tsc-dts`.

#### Acceptance criteria

- Watch correctness: type changes in referenced projects reflect in emitted `.d.ts` without restart.
- Sourcemaps: identical to `fix/#80`.
- Performance: large package with 30+ entries rebuilds in seconds (not minutes) for a single-file change.
