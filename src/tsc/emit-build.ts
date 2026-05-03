import { createDebug } from 'obug'
import ts from 'typescript'
import { RE_DTS, RE_DTS_MAP } from '../filename.ts'
import {
  globalContext,
  type ParsedProject,
  type SourceFileToProjectMap,
  type TscContext,
} from './context.ts'
import { createFsSystem, createMemorySystem } from './system.ts'
import { customTransformers, formatHost, setSourceMapRoot } from './utils.ts'
import type { TscOptions, TscResult } from './types.ts'
import type { ExistingRawSourceMap } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:tsc-build')

/**
 * Emit file using
 * {@linkcode https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript | tsc --build}
 * mode. This mode is used when the {@linkcode TscOptions.build | build} option
 * is set to `true`. It uses the
 * {@linkcode ts.createSolutionBuilder | TypeScript solution builder} API to
 * build the project and its references, and then reads the emitted declaration
 * file and source map from the file system. This mode is faster than the
 * `tsc` mode when there are multiple projects or references, but it requires a
 * {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json}
 * file with the correct configuration.
 *
 * @param tscOptions - The options for emitting the declaration file.
 * @returns The result of the emit operation, including the emitted code, source map, and any errors that occurred.
 */
export function tscEmitBuild(tscOptions: TscOptions): TscResult {
  const {
    id,
    tsconfig,
    incremental,
    context = globalContext,
    sourcemap,
  } = tscOptions
  debug(
    `running tscEmitBuild id: ${id}, tsconfig: ${tsconfig}, incremental: ${incremental}`,
  )

  if (!tsconfig) {
    return {
      error: '[rolldown-plugin-dts] build mode requires a tsconfig path',
    }
  }

  const fsSystem = (incremental ? createFsSystem : createMemorySystem)(
    context.files,
  )

  const resolvedId = fsSystem.resolvePath(id)

  if (resolvedId !== id) {
    debug(`resolved id from ${id} to ${resolvedId}`)
  }

  // Build projects (if necessary) and collect all projects.
  const sourceFileToProjectMap = getOrBuildProjects(
    context,
    fsSystem,
    tsconfig,
    !incremental,
    sourcemap,
  )

  const project = sourceFileToProjectMap.get(resolvedId)
  if (!project) {
    debug(`unable to locate a project containing ${resolvedId}`)
    return {
      error: `Unable to locate ${id} from the given tsconfig file ${tsconfig}`,
    }
  }
  debug(`loaded project ${project.tsconfigPath} for ${id}`)

  const ignoreCase = !fsSystem.useCaseSensitiveFileNames
  const outputFiles = ts.getOutputFileNames(
    project.parsedConfig,
    resolvedId,
    ignoreCase,
  )

  let code: string | undefined
  let map: ExistingRawSourceMap | undefined

  for (const outputFile of outputFiles) {
    if (RE_DTS.test(outputFile)) {
      if (!fsSystem.fileExists(outputFile)) {
        console.warn(`[rolldown-plugin-dts] Unable to read file ${outputFile}`)
        continue
      }
      code = fsSystem.readFile(outputFile)
      continue
    }

    if (RE_DTS_MAP.test(outputFile)) {
      if (!fsSystem.fileExists(outputFile)) {
        continue
      }

      const text = fsSystem.readFile(outputFile)
      if (!text) {
        console.warn(`[rolldown-plugin-dts] Unexpected sourcemap ${outputFile}`)
        continue
      }

      map = JSON.parse(text)
      setSourceMapRoot(map, outputFile, resolvedId)
    }
  }

  if (code) {
    return { code, map }
  }

  if (incremental) {
    debug(`incremental build failed`)
    // Fallback to non-incremental (force) build.
    //
    // This can happen if users delete the emitted files from `tsc --build`, but
    // still keep the `.tsbuildinfo` file exist. In this case, `tsc --build`
    // will skip the build, but the `.d.ts` file we need doesn't actually exist.
    return tscEmitBuild({ ...tscOptions, incremental: false })
  }

  debug(`unable to build .d.ts file for ${id}`)

  // Try to locate the cause of the failure and provide a helpful error message
  if (project.parsedConfig.options.declaration !== true) {
    return {
      error: `Unable to build .d.ts file for ${id}; Make sure the "declaration" option is set to true in ${project.tsconfigPath}`,
    }
  }

  return {
    error: `Unable to build .d.ts file for ${id}; This seems like a bug of rolldown-plugin-dts. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts/issues`,
  }
}

/**
 * Returns the cached {@linkcode SourceFileToProjectMap} for the given
 * `tsconfig`, building it first via
 * {@linkcode buildProjects | buildProjects()} if it has not been built yet in
 * this {@linkcode context}.
 *
 * @param context - The shared compiler context that holds the project cache.
 * @param fsSystem - The TypeScript file-system abstraction to pass through to the builder.
 * @param tsconfig - Absolute path to the root {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} file.
 * @param force - If `true`, forces a full rebuild, bypassing any existing `.tsbuildinfo` cache.
 * @param sourcemap - Whether declaration maps should be emitted.
 * @returns A map from resolved source-file path to the {@linkcode ParsedProject | project} that owns it.
 */
function getOrBuildProjects(
  context: TscContext,
  fsSystem: ts.System,
  tsconfig: string,
  force: boolean,
  sourcemap: boolean,
): SourceFileToProjectMap {
  let projectMap = context.projects.get(tsconfig)
  if (projectMap) {
    debug(`skip building projects for ${tsconfig}`)
    return projectMap
  }

  projectMap = buildProjects(fsSystem, tsconfig, force, sourcemap)
  context.projects.set(tsconfig, projectMap)
  return projectMap
}

/**
 * Uses the TypeScript solution builder API to build all projects referenced
 * from the root `tsconfig` file and returns a map from each source file to the
 * {@linkcode ParsedProject | project} that owns it.
 *
 * @param fsSystem - The TypeScript file-system abstraction used by the builder.
 * @param tsconfig - Absolute path to the root {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} file.
 * @param force - If `true`, forces a full rebuild instead of using cached `.tsbuildinfo` artifacts.
 * @param sourcemap - Whether declaration maps (`.d.ts.map`) should be emitted.
 * @returns A map from resolved source-file path to the {@linkcode ParsedProject | project} that owns it.
 */
function buildProjects(
  fsSystem: ts.System,
  tsconfig: string,
  force: boolean,
  sourcemap: boolean,
): SourceFileToProjectMap {
  debug(`start building projects for ${tsconfig}`)

  // Collect all projects from the tsconfig file and its references. A project
  // is a string that represents the path to the project's `tsconfig` file.
  const projects = collectProjectGraph(tsconfig, fsSystem, force, sourcemap)
  debug(
    'collected %d projects: %j',
    projects.length,
    projects.map((project) => project.tsconfigPath),
  )

  const host = ts.createSolutionBuilderHost(
    fsSystem,
    createProgramWithPatchedCompilerOptions,
  )
  const builder = ts.createSolutionBuilder(host, [tsconfig], {
    force,
    verbose: true,
  })

  const exitStatus = builder.build(
    undefined,
    undefined,
    undefined,
    (project) => {
      debug(`transforming project ${project}`)
      return customTransformers
    },
  )

  debug(`built solution for ${tsconfig} with exit status ${exitStatus}`)

  const sourceFileToProjectMap: SourceFileToProjectMap = new Map()

  for (const project of projects) {
    for (const fileName of project.parsedConfig.fileNames) {
      sourceFileToProjectMap.set(fsSystem.resolvePath(fileName), project)
    }
  }

  return sourceFileToProjectMap
}

/**
 * Collects all referenced projects from the given entry `tsconfig` file by
 * traversing the project-reference graph in depth-first order.
 *
 * @param rootTsconfigPath - Absolute path to the root {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} to start from.
 * @param fsSystem - The TypeScript file-system abstraction used for reading config files.
 * @param force - Passed through to {@linkcode patchCompilerOptions | patchCompilerOptions()} to suppress redundant warnings during forced rebuilds.
 * @param sourcemap - Whether declaration maps should be requested for each project.
 * @returns An ordered array of every {@linkcode ParsedProject | project} reachable from the root config (including the root itself), with compiler options already patched for declaration emit.
 */
function collectProjectGraph(
  rootTsconfigPath: string,
  fsSystem: ts.System,
  force: boolean,
  sourcemap: boolean,
): ParsedProject[] {
  const seen = new Set<string>()
  const projects: ParsedProject[] = []
  const stack = [fsSystem.resolvePath(rootTsconfigPath)]
  while (true) {
    const tsconfigPath = stack.pop()
    if (!tsconfigPath) break

    if (seen.has(tsconfigPath)) continue
    seen.add(tsconfigPath)

    const parsedConfig = parseTsconfig(tsconfigPath, fsSystem)
    if (!parsedConfig) continue

    parsedConfig.options = patchCompilerOptions(parsedConfig.options, {
      tsconfigPath,
      force,
      sourcemap,
    })

    projects.push({ tsconfigPath, parsedConfig })

    for (const ref of parsedConfig.projectReferences ?? []) {
      stack.push(ts.resolveProjectReferencePath(ref))
    }
  }
  return projects
}

/**
 * Reads and parses the TypeScript configuration at {@linkcode tsconfigPath}
 * using
 * {@linkcode ts.getParsedCommandLineOfConfigFile | getParsedCommandLineOfConfigFile()}.
 *
 * @param tsconfigPath - Absolute path to the {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} file to parse.
 * @param fsSystem - The TypeScript file-system abstraction used to read the config file.
 * @returns The parsed command-line object if successful, or `undefined` if the file could not be read.
 * @throws An {@linkcode Error} if any unrecoverable diagnostic is emitted while parsing the config.
 */
function parseTsconfig(
  tsconfigPath: string,
  fsSystem: ts.System,
): ts.ParsedCommandLine | undefined {
  const diagnostics: ts.Diagnostic[] = []

  const parsedConfig = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    undefined,
    {
      ...fsSystem,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    },
  )

  if (diagnostics.length) {
    throw new Error(
      `[rolldown-plugin-dts] Unable to read ${tsconfigPath}: ${ts.formatDiagnostics(diagnostics, formatHost)}`,
    )
  }

  return parsedConfig
}

/**
 * To ensure we can get `.d.ts` and `.d.ts.map` files from
 * {@linkcode https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript | tsc --build}
 * mode, we need to enforce certain compiler options. Notice that changing
 * compiler options will invalidate the cache, so it's better to set the
 * correct value in `tsconfig` files in the first place. Therefore, we print
 * some warnings if the values are not set correctly.
 *
 * @param options - The original {@linkcode ts.CompilerOptions | compilerOptions} from `tsconfig`.
 * @param extraOptions - The extra options for patching the {@linkcode ts.CompilerOptions | compilerOptions}, including the `tsconfigPath` for better warning message, and a `force` flag to skip warnings.
 * @returns The patched {@linkcode ts.CompilerOptions | compilerOptions} with the necessary options for emitting declaration files.
 */
function patchCompilerOptions(
  options: ts.CompilerOptions,
  extraOptions: {
    tsconfigPath: string
    force: boolean
    sourcemap: boolean
  } | null,
): ts.CompilerOptions {
  const noEmit: boolean = options.noEmit ?? false
  const declaration: boolean =
    options.declaration ?? (options.composite ? true : false)
  const declarationMap: boolean = options.declarationMap ?? false

  const shouldPrintWarning = extraOptions?.tsconfigPath && !extraOptions.force

  if (noEmit === true) {
    options = { ...options, noEmit: false }
    if (shouldPrintWarning) {
      console.warn(
        `[rolldown-plugin-dts] ${extraOptions.tsconfigPath} has "noEmit" set to true. Please set it to false to generate declaration files.`,
      )
    }
  }
  if (declaration === false) {
    options = { ...options, declaration: true }
    if (shouldPrintWarning) {
      console.warn(
        `[rolldown-plugin-dts] ${extraOptions.tsconfigPath} has "declaration" set to false. Please set it to true to generate declaration files.`,
      )
    }
  }
  if (declarationMap === false && extraOptions?.sourcemap) {
    options = { ...options, declarationMap: true }
    if (shouldPrintWarning) {
      console.warn(
        `[rolldown-plugin-dts] ${extraOptions.tsconfigPath} has "declarationMap" set to false. Please set it to true if you want to generate source maps for declaration files.`,
      )
    }
  }

  return options
}

/**
 * A {@linkcode ts.CreateProgram | CreateProgram} factory used by the
 * TypeScript solution builder that wraps
 * {@linkcode ts.createEmitAndSemanticDiagnosticsBuilderProgram | createEmitAndSemanticDiagnosticsBuilderProgram()}
 * with {@linkcode patchCompilerOptions | patchCompilerOptions()} applied to
 * the resolved compiler options, ensuring `declaration` is always enabled
 * during solution builds.
 */
const createProgramWithPatchedCompilerOptions: ts.CreateProgram<
  ts.EmitAndSemanticDiagnosticsBuilderProgram
> = (rootNames, options, ...args) => {
  return ts.createEmitAndSemanticDiagnosticsBuilderProgram(
    rootNames,
    patchCompilerOptions(options ?? {}, null),
    ...args,
  )
}
