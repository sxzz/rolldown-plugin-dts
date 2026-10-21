# tsrs custom generator

An experimental implementation of the existing `Generator` interface using
[tsrs's unstable Node API](https://github.com/oxc-project/tsrs/blob/main/docs/NODE_API.md).
Tested with `tsrs@0.18.0-ts7.1.0-dev.20260929`.

Copy `generator.ts` into your project, change its type import from
`../../src/index.ts` to `rolldown-plugin-dts`, and install the compiler:

```sh
pnpm add -D tsrs@0.18.0-ts7.1.0-dev.20260929
```

```ts
import { dts } from 'rolldown-plugin-dts'
import { createTsrsGenerator } from './generator.ts'

export default {
  input: './src/index.ts',
  plugins: [
    dts({
      tsconfig: './tsconfig.json',
      generator: createTsrsGenerator({ tsconfig: './tsconfig.json' }),
    }),
  ],
}
```

The generator reads compiler options from the specified on-disk tsconfig. All
entry points and their dependencies must belong to that project. Set
`compilerOptions.declarationMap: true` there to generate declaration maps.
Plugin-level `compilerOptions`, `tsconfigRaw`, and `sourcemap` overrides do not
change the tsrs program. This example does not build project references or
support Vue, custom languages, or content mappers.

By default, tsrs reads sources from disk and allows concurrent declaration
requests. With `vfs: true`, the generator overlays sources registered by Rolldown
and serializes snapshot updates and emits. Source transforms must run before the dts
transform hook. Dependencies not yet registered still come from disk, so this
example cannot guarantee transformed dependency inference when declarations are
requested before those dependencies are loaded. Each build starts a new tsrs
session, so watch rebuilds read fresh files.

To run the standalone checks in this repository, make the tested tsrs version
available in `node_modules`, then run:

```sh
node --test examples/tsrs/smoke.ts
```

The example is not exported by the package and does not add tsrs to the
repository's dependencies or automatic generator selection.

## Benchmark

On macOS, with the same tsrs installation available:

```sh
node examples/tsrs/benchmark.ts
```

This compares the custom tsrs generator with the built-in tsgo and tsc
generators on the repository's five entry points and synthetic projects with
100 and 1000 modules. It includes declaration bundling in Rolldown, uses disk
sources, and disables declaration maps and incremental builds. All compilers
read the same tsconfig per workload; tsc uses `eager: true` to load the complete
configured project, as the native APIs do.
Both native generators allow concurrent emit requests in this disk-based
benchmark; only VFS mode requires serialized snapshot updates.

The TypeScript runner starts `benchmark-worker.ts` in a fresh Node process for
each measurement. Use `--runs 1 --memory-runs 1` for a quick validation run.

Each compiler gets one discarded warmup, seven timing runs in fresh processes,
and three separate memory runs, with randomized order within each round. Wall
time includes Node startup, module loading, compiler startup, bundling, output
hashing, and shutdown. Memory is the sampled peak of summed RSS for the entire
process group, including the native compiler subprocess, with a 10 ms sleep
between `ps` calls. Sampling can miss short peaks and summed RSS can double-count
shared pages; it is not V8 heap size or unique physical memory. Memory sampling
does not run during timing measurements. File caches remain warm.

Inputs, emitted declarations, compiler versions, individual measurements, and
summary statistics are saved under `temp/tsrs-benchmark-*/`. The harness checks
stable output across runs and compares outputs across compilers, allowing only
quote-style differences for the synthetic fixtures' three string literals.
This measures these plugin implementations and workloads, not standalone CLI
type-checking speed or watch rebuild performance.
