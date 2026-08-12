import { b, is, isIdentifierName, nameOf, walk, walkAsync } from 'yuku-ast'
import { generate } from 'yuku-codegen'
import { parse, type ParseResult } from 'yuku-parser'
import {
  filename_dts_to,
  filename_js_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_NODE_MODULES,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import { EMPTY_STUB } from './generate.ts'
import type { OptionsResolved } from './options.ts'
import type {
  Plugin,
  RenderedChunk,
  SourceMapInput,
  TransformPluginContext,
  TransformResult,
} from 'rolldown'
import type * as t from 'yuku-parser'

// input:
// export declare function x(xx: X): void

// to:            const x   = [1, () => X  ]
// after compile: const x$1 = [1, () => X$1]

// replace X with X$1
// output:
// export declare function x$1(xx: X$1): void

type Dep = t.Expression & { replace?: (newNode: t.Node) => void }

/**
 * A collection of type parameters grouped by parameter name
 */
type TypeParams = Array<{
  name: string
  typeParams: t.Identifier[]
}>

interface DeclarationInfo {
  decl: t.Declaration
  bindings: t.Identifier[]
  params: TypeParams
  deps: Dep[]
  children: t.Node[]
  /** How the declaration was exported in the source file, if it was */
  exportType?: InlineExportKind
  /** The comments attached to the declaration, as parsed */
  comments?: t.AttachedComment[]
}

interface ModuleExports {
  typeOnlyLocals: Set<string>
  exports: Map<string, boolean>
  reExports: ReExportInfo[]
  exportAlls: ExportAllInfo[]
}

interface ReExportInfo {
  source?: string
  local: string
  exported: string
  typeOnly: boolean
}

interface ExportAllInfo {
  source?: string
  rawSource: string
  typeOnly: boolean
}

interface ChunkExportInfo {
  /** Names the chunk exports as types only, `export type { x }` */
  typeOnlyNames: Set<string>
  typeOnlyExportAllSources: Set<string>
  /**
   * Names the chunk exports as values. Only those may be attached back to
   * their declaration as an inline `export`, a type only export has to stay a
   * specifier to keep the `type` modifier.
   */
  inlineNames: Set<string>
}

type NamespaceMap = Map<
  string,
  {
    stmt: t.ProgramStatement
    local: t.Identifier | t.TSQualifiedName
  }
>

export function createFakeJsPlugin({
  sourcemap,
  cjsDefault,
  sideEffects,
}: Pick<OptionsResolved, 'sourcemap' | 'cjsDefault' | 'sideEffects'>): Plugin {
  let declarationIdx = 0
  const declarationMap = new Map<number /* declaration id */, DeclarationInfo>()
  const commentsMap = new Map<string /* filename */, t.Comment[]>()
  const moduleExportsMap = new Map<string /* filename */, ModuleExports>()
  const warnedCjsDtsInputs = new Set<string>()

  return {
    name: 'rolldown-plugin-dts:fake-js',

    outputOptions(options) {
      if (options.format === 'cjs' || options.format === 'commonjs') {
        throw new Error(
          '[rolldown-plugin-dts] Cannot bundle dts files with `cjs` format.',
        )
      }

      const { chunkFileNames, entryFileNames } = options
      return {
        ...options,
        sourcemap: options.sourcemap || sourcemap,
        chunkFileNames(chunk) {
          const nameTemplate = resolveTemplateFn(
            chunk.isEntry
              ? entryFileNames || '[name].js'
              : chunkFileNames || '[name]-[hash].js',
            chunk,
          )

          if (chunk.name.endsWith('.d')) {
            const renderedNameWithoutD = filename_js_to_dts(
              replaceTemplateName(nameTemplate, chunk.name.slice(0, -2)),
            )
            if (RE_DTS.test(renderedNameWithoutD)) {
              return renderedNameWithoutD
            }

            const renderedName = filename_js_to_dts(
              replaceTemplateName(nameTemplate, chunk.name),
            )
            if (RE_DTS.test(renderedName)) {
              return renderedName
            }
          }

          return nameTemplate
        },
      }
    },

    transform: {
      filter: { id: RE_DTS },
      handler: transform,
    },
    renderChunk,

    generateBundle(options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (!RE_DTS_MAP.test(chunk.fileName)) continue

        if (sourcemap) {
          if (chunk.type === 'chunk' || typeof chunk.source !== 'string')
            continue
          const map = JSON.parse(chunk.source)
          map.sourcesContent = undefined
          chunk.source = JSON.stringify(map)
        } else {
          delete bundle[chunk.fileName]
        }
      }
    },
  }

  async function transform(
    this: TransformPluginContext,
    code: string,
    id: string,
  ): Promise<TransformResult> {
    let file: ParseResult
    try {
      file = parse(code, {
        lang: 'dts',
        sourceType: 'module',
        attachComments: true,
      })
    } catch (error) {
      throw new Error(
        `Failed to parse ${id}. This may be caused by a syntax error in the declaration file or a bug in the plugin. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts\n${error}`,
        { cause: error },
      )
    }

    const { program } = file
    moduleExportsMap.set(id, await collectModuleExports(this, program.body, id))
    const identifierMap: Record<string, number> = Object.create(null)

    if (!warnedCjsDtsInputs.has(id) && program.body.some(isCjsDtsInputSyntax)) {
      warnedCjsDtsInputs.add(id)
      this.warn(
        `${id} uses CommonJS dts syntax. ${
          RE_NODE_MODULES.test(id)
            ? `CommonJS dts modules cannot be bundled by rolldown-plugin-dts. Please mark this module as external in your Rolldown config.`
            : `rolldown-plugin-dts does not support bundling CommonJS dts input.`
        }`,
      )
    }

    const directives = collectReferenceDirectives(file.comments)
    if (directives.length) {
      commentsMap.set(id, directives)
    }

    const appendStmts: t.ProgramStatement[] = []
    const namespaceStmts: NamespaceMap = new Map()

    for (const [i, stmt] of program.body.entries()) {
      const setStmt = (stmt: t.ProgramStatement) => (program.body[i] = stmt)
      if (rewriteImportExport(stmt, setStmt, appendStmts)) continue

      const sideEffect =
        stmt.type === 'TSModuleDeclaration' && stmt.kind !== 'namespace'

      if (
        sideEffect &&
        stmt.type === 'TSModuleDeclaration' &&
        is.StringLiteral(stmt.id) &&
        stmt.id.value[0] === '.'
      ) {
        this.warn(
          `\`declare module ${JSON.stringify(stmt.id.value)}\` will be kept as-is in the output. Relative module declaration may cause unexpected issues. Found in ${id}.`,
        )
      }

      const isDefaultExport = stmt.type === 'ExportDefaultDeclaration'
      const isExportDecl =
        is.oneOf(stmt, [
          'ExportNamedDeclaration', // export let x
          'ExportDefaultDeclaration', // export default function x() {}
        ]) && !!stmt.declaration

      const decl: t.Node = isExportDecl ? stmt.declaration! : stmt
      const setDecl = isExportDecl
        ? (decl: t.VariableDeclaration) => (stmt.declaration = decl)
        : setStmt

      if (decl.type !== 'TSDeclareFunction' && !is.Declaration(decl)) {
        continue
      }

      if (
        is.oneOf(decl, [
          'TSEnumDeclaration',
          'ClassDeclaration',
          'FunctionDeclaration',
          'TSDeclareFunction',
          'TSModuleDeclaration',
          'VariableDeclaration',
        ])
      ) {
        decl.declare = true
      }

      const bindings: t.Identifier[] = []
      if (decl.type === 'VariableDeclaration') {
        bindings.push(
          ...decl.declarations.map((decl) => decl.id as t.Identifier),
        )
      } else if ('id' in decl && decl.id) {
        let binding: t.Node = decl.id
        if (binding.type === 'TSQualifiedName') {
          binding = getIdFromTSEntityName(binding)
        }

        if (sideEffect) {
          binding = b.Identifier({
            name: `_${getIdentifierIndex(identifierMap, '')}`,
          })
        }

        if (binding.type !== 'Identifier') {
          throw new Error(`Unexpected ${binding.type} declaration id`)
        }

        bindings.push(binding)
      } else {
        const binding = b.Identifier({ name: 'export_default' })
        bindings.push(binding)
        ;(decl as { id?: t.Identifier }).id = binding
      }

      const params: TypeParams = collectParams(decl)
      const childrenSet = new Set<t.Node>()
      const deps = await collectDependencies(
        this,
        decl,
        id,
        namespaceStmts,
        childrenSet,
        identifierMap,
      )
      const children = Array.from(childrenSet).filter((child) =>
        bindings.every((b) => child !== b),
      )

      if (decl !== stmt) {
        decl.comments = stmt.comments
      }

      const declarationId = registerDeclaration({
        decl,
        deps,
        bindings,
        params,
        children,
        exportType: isDefaultExport
          ? 'default'
          : isExportDecl
            ? 'named'
            : undefined,
        comments: decl.comments && [...decl.comments],
      })

      const declarationIdNode = b.Literal({
        value: declarationId,
        raw: String(declarationId),
      }) as t.NumericLiteral
      const depsBody: t.ArrayExpression = b.ArrayExpression({ elements: deps })
      const depsNode: t.ArrowFunctionExpression = b.ArrowFunctionExpression({
        id: null,
        generator: false,
        async: false,
        params: params.map(({ name }) => b.Identifier({ name })),
        body: depsBody,
        expression: true,
      })
      const childrenNode: t.ArrayExpression = b.ArrayExpression({
        elements: children.map((node) =>
          b.Literal({
            value: '',
            raw: '""',
            start: node.start,
            end: node.end,
          }),
        ),
      })
      const sideEffectNode: t.CallExpression | false =
        sideEffect &&
        b.CallExpression({
          callee: b.Identifier({ name: 'sideEffect' }),
          arguments: [bindings[0]],
          optional: false,
        })
      const runtimeArrayNode = runtimeBindingArrayExpression([
        declarationIdNode,
        depsNode,
        childrenNode,
        ...(sideEffectNode ? ([sideEffectNode] as const) : ([] as const)),
      ])

      /*
      var ${binding} = [
        ${declarationId},
        (param, ...) => [dep, ...],
        ["children symbol name"],
        sideEffect()
      ]
      */
      const runtimeAssignment = b.VariableDeclaration({
        kind: 'var',
        declarations: [
          b.VariableDeclarator({
            id: b.ArrayPattern({
              elements: bindings.map((binding) => ({
                ...binding,
                typeAnnotation: null,
              })),
            }),
            init: runtimeArrayNode,
          }),
        ],
      })

      if (isDefaultExport) {
        // export { ${binding} as default }
        appendStmts.push(
          b.ExportNamedDeclaration({
            declaration: null,
            specifiers: [
              b.ExportSpecifier({
                local: bindings[0],
                exported: b.Identifier({ name: 'default' }),
              }),
            ],
            source: null,
            attributes: [],
          }),
        )
        // replace the whole statement
        setStmt(runtimeAssignment)
      } else {
        // replace declaration, keep `export`
        setDecl(runtimeAssignment)
      }
    }

    if (sideEffects) {
      // module side effect marker
      appendStmts.push(
        b.ExpressionStatement({
          expression: b.CallExpression({
            callee: b.Identifier({ name: 'sideEffect' }),
            arguments: [],
            optional: false,
          }),
        }),
      )
    }

    program.body = [
      ...Array.from(namespaceStmts.values(), ({ stmt }) => stmt),
      ...program.body,
      ...appendStmts,
    ]

    const result = generate(program, {
      comments: false,
      ...(sourcemap && {
        sourceMaps: { source: code, sourceFileName: id },
      }),
    })

    return {
      code: result.code,
      map: (result.map ?? null) as SourceMapInput | null,
    }
  }

  function renderChunk(code: string, chunk: RenderedChunk) {
    if (!RE_DTS.test(chunk.fileName)) {
      return
    }

    const exportInfo = collectChunkExportInfo(chunk, moduleExportsMap)

    let file: ParseResult
    try {
      file = parse(code, {
        lang: 'ts',
        sourceType: 'module',
        attachComments: true,
      })
    } catch (error) {
      throw new Error(
        `Failed to parse generated code for chunk ${chunk.fileName}. This may be caused by a bug in the plugin. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts\n${error}`,
        { cause: error },
      )
    }

    const { program } = file
    program.body = patchTsNamespace(program.body)
    program.body = patchReExport(program.body)

    const inlineExports = planInlineExports(
      program.body,
      exportInfo,
      getDeclaration,
      cjsDefault,
    )

    function renderStatement(
      node: t.ProgramStatement,
    ): t.ProgramStatement | null | false {
      if (isHelperImport(node)) return null
      if (node.type === 'ExpressionStatement') return null

      const newNode = patchImportExport(
        node,
        exportInfo,
        cjsDefault && inlineExports.allowExportAssignment,
      )
      if (newNode || newNode === false) {
        return newNode
      }

      if (node.type !== 'VariableDeclaration') return node

      if (!isRuntimeBindingVariableDeclaration(node)) {
        return null
      }

      const decl = node.declarations[0]
      const [declarationIdNode, depsFn, children /*, ignore sideEffect */] =
        decl.init.elements

      const declarationId = declarationIdNode.value
      const declaration = getDeclaration(declarationId!)

      // `renderChunk` may run again for the same declaration, e.g. in watch
      // mode, so always start from the comments the declaration was parsed with
      declaration.decl.comments = declaration.comments && [
        ...declaration.comments,
      ]

      if (sourcemap) {
        walk(declaration.decl, {
          enter(node) {
            node.start = undefined as never
            node.end = undefined as never
          },
        })
      }

      for (const [i, id] of decl.id.elements.entries()) {
        const transformedBinding = {
          ...id,
          typeAnnotation: declaration.bindings[i].typeAnnotation,
        }
        overwriteNode(declaration.bindings[i], transformedBinding)
      }

      if (sourcemap) {
        for (const [i, child] of (
          children.elements as t.StringLiteral[]
        ).entries()) {
          Object.assign(declaration.children[i], {
            start: child.start,
            end: child.end,
          })
        }
      }

      const transformedParams = depsFn.params as t.Identifier[]
      for (const [i, transformedParam] of transformedParams.entries()) {
        const transformedName = transformedParam.name
        for (const originalTypeParam of declaration.params[i].typeParams) {
          originalTypeParam.name = transformedName
        }
      }

      const transformedDeps = (depsFn.body as t.ArrayExpression)
        .elements as t.Expression[]
      for (const [i, originalDep] of declaration.deps.entries()) {
        let transformedDep = transformedDeps[i]
        if (
          transformedDep.type === 'UnaryExpression' &&
          transformedDep.operator === 'void'
        ) {
          const undefinedDep = b.Identifier({ name: 'undefined' })
          undefinedDep.start = transformedDep.start
          undefinedDep.end = transformedDep.end
          transformedDep = undefinedDep
        } else if (isInfer(transformedDep)) {
          transformedDep.name = '__Infer'
        }

        if (originalDep.replace) {
          originalDep.replace(transformedDep)
        } else {
          Object.assign(originalDep, transformedDep)
        }
      }

      const kind = inlineExports.kinds.get(declarationId!)
      const rendered = kind
        ? inlineExportDeclaration(declaration.decl, kind)
        : declaration.decl

      return inheritNodeComments(node, rendered)
    }

    const body: t.ProgramStatement[] = []
    // comments of dropped statements, e.g. the `//#endregion` in front of an
    // `export { ... }` that became empty because it was inlined
    let danglingComments: t.AttachedComment[] = []

    for (const node of program.body) {
      const rendered = renderStatement(node)

      if (rendered === false) {
        danglingComments.push(...pragmaComments(node))
        continue
      }
      if (!rendered) continue

      if (danglingComments.length) {
        rendered.comments = [...danglingComments, ...(rendered.comments || [])]
        danglingComments = []
      }
      body.push(rendered)
    }

    const lastNode = body.at(-1)
    if (danglingComments.length && lastNode) {
      lastNode.comments = [
        ...(lastNode.comments || []),
        ...danglingComments.map((comment) => ({
          ...comment,
          position: 'after' as const,
          sameLine: false,
        })),
      ]
    }

    program.body = body

    if (program.body.length === 0) {
      return { code: EMPTY_STUB, map: null }
    }

    // recover comments
    const comments = new Set<t.Comment>()
    const commentsValue = new Set<string>() // deduplicate

    for (const id of chunk.moduleIds) {
      const preserveComments = commentsMap.get(id)
      if (preserveComments) {
        preserveComments.forEach((c) => {
          const id = c.type + c.value
          if (commentsValue.has(id)) return

          commentsValue.add(id)
          comments.add(c)
        })
        commentsMap.delete(id)
      }
    }
    if (comments.size) {
      program.body[0].comments ||= []
      program.body[0].comments.unshift(
        ...Array.from(comments, (c): t.AttachedComment => ({
          type: c.type,
          value: c.value,
          position: 'before',
          sameLine: false,
        })),
      )
    }

    const result = generate(program, {
      comments: true,
      ...(sourcemap && {
        sourceMaps: {
          source: code,
          sourceFileName: chunk.fileName,
        },
      }),
    })

    return {
      // a chunk ending with a comment, e.g. `//#endregion`, is generated with a
      // trailing newline, which rolldown would separate from the sourcemap
      // pragma it appends by a blank line
      code: result.code.trimEnd(),
      map: (result.map ?? null) as SourceMapInput | null,
    }
  }

  function registerDeclaration(info: DeclarationInfo) {
    const declarationId = declarationIdx++
    declarationMap.set(declarationId, info)
    return declarationId
  }

  function getDeclaration(declarationId: number) {
    return declarationMap.get(declarationId)!
  }
}

//#region Inline export

type InlineExportKind = 'named' | 'default'

interface InlineExportPlan {
  /** Declaration id to the `export` form the declaration gets back */
  kinds: Map<number, InlineExportKind>
  /** Whether `export = x` may still be emitted for the `cjsDefault` option */
  allowExportAssignment: boolean
}

interface LocalExport {
  local: string
  typeOnly: boolean
  specifier: t.ExportSpecifier
}

/**
 * Collects the `export { local as exported }` statements of a chunk, i.e. the
 * exports that could be attached back to their declaration. Re-exports
 * (`export { x } from '...'`) are not local and therefore skipped.
 */
function getLocalExportsMap(
  nodes: t.ProgramStatement[],
): Map<string /* exported */, LocalExport> {
  const exportsMap = new Map<string, LocalExport>()

  for (const node of nodes) {
    if (
      node.type !== 'ExportNamedDeclaration' ||
      node.declaration ||
      node.source
    ) {
      continue
    }

    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ExportSpecifier') continue

      exportsMap.set(nameOf(specifier.exported), {
        local: nameOf(specifier.local),
        typeOnly: node.exportKind === 'type' || specifier.exportKind === 'type',
        specifier,
      })
    }
  }

  return exportsMap
}

/**
 * Decides which declarations get their `export` keyword back, so that a
 * declaration written as `export declare const x` is emitted as
 * `export declare const x` instead of `declare const x` + `export { x }`.
 *
 * A declaration qualifies only if it was exported inline in its own source
 * file, the chunk exports it as a value under its own name, and every
 * declaration it merges with qualifies as well. The specifiers of the
 * re-attached exports are removed here, before `patchImportExport` runs, so
 * that both stay in sync.
 */
function planInlineExports(
  nodes: t.ProgramStatement[],
  exportInfo: ChunkExportInfo,
  getDeclaration: (declarationId: number) => DeclarationInfo,
  cjsDefault: boolean,
): InlineExportPlan {
  const exportsMap = getLocalExportsMap(nodes)
  const allowExportAssignment = hasOnlyDefaultExport(nodes)
  const kinds = new Map<number, InlineExportKind>()
  const removed = new Set<t.ExportSpecifier>()

  // declarations of the chunk, and the names they bind after bundling
  const declNames = new Map<number /* declaration id */, string[]>()
  const nameDecls = new Map<string, number[] /* declaration ids */>()
  for (const node of nodes) {
    if (!isRuntimeBindingVariableDeclaration(node)) continue

    const { id, init } = node.declarations[0]
    const declarationId = init.elements[0].value as number
    const names = (id.elements as t.Identifier[]).map(({ name }) => name)

    declNames.set(declarationId, names)
    for (const name of names) {
      const decls = nameDecls.get(name)
      if (decls) decls.push(declarationId)
      else nameDecls.set(name, [declarationId])
    }
  }

  const named = new Set<number>()
  for (const [declarationId, names] of declNames) {
    if (getDeclaration(declarationId).exportType !== 'named') continue
    if (names.every(isInlinableName)) named.add(declarationId)
  }

  // Merged declarations — overloads, `function` + `namespace`, ... — share a
  // name and a single export specifier. TypeScript requires all of them to be
  // exported or all of them to be local, so keep a group only if every
  // declaration of it qualifies.
  let changed = true
  while (changed) {
    changed = false

    for (const declarationId of named) {
      const complete = declNames
        .get(declarationId)!
        .every((name) => nameDecls.get(name)!.every((id) => named.has(id)))
      if (!complete) {
        named.delete(declarationId)
        changed = true
      }
    }
  }

  for (const declarationId of named) {
    kinds.set(declarationId, 'named')
    for (const name of declNames.get(declarationId)!) {
      removed.add(exportsMap.get(name)!.specifier)
    }
  }

  const defaultExport = exportsMap.get('default')
  if (
    defaultExport &&
    !defaultExport.typeOnly &&
    exportInfo.inlineNames.has('default') &&
    // `export = x` wins over `export default x`
    (!cjsDefault || !allowExportAssignment)
  ) {
    for (const [declarationId, names] of declNames) {
      const declaration = getDeclaration(declarationId)
      if (
        declaration.exportType !== 'default' ||
        names.length !== 1 ||
        names[0] !== defaultExport.local ||
        // a merged declaration cannot be exported as `export default`
        nameDecls.get(names[0])!.length !== 1 ||
        !isInlinableDefaultDeclaration(declaration.decl)
      ) {
        continue
      }

      kinds.set(declarationId, 'default')
      removed.add(defaultExport.specifier)
      break
    }
  }

  if (removed.size) {
    for (const node of nodes) {
      if (node.type !== 'ExportNamedDeclaration') continue

      node.specifiers = node.specifiers.filter(
        (specifier) => !removed.has(specifier),
      )
    }
  }

  return { kinds, allowExportAssignment }

  function isInlinableName(name: string): boolean {
    if (!exportInfo.inlineNames.has(name)) return false

    // the declaration has to be exported under its own name, an alias such as
    // `export { x as y }` has to stay a specifier
    const exported = exportsMap.get(name)
    return !!exported && exported.local === name && !exported.typeOnly
  }
}

/** Whether `default` is the only name the chunk exports */
function hasOnlyDefaultExport(nodes: t.ProgramStatement[]): boolean {
  let hasDefault = false

  for (const node of nodes) {
    if (node.type === 'ExportAllDeclaration') return false
    if (node.type === 'ExportDefaultDeclaration') {
      hasDefault = true
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration) return false

    for (const specifier of node.specifiers) {
      if (nameOf(specifier.exported) !== 'default') return false
      hasDefault = true
    }
  }

  return hasDefault
}

/** `export default` only accepts a class, function or interface declaration */
function isInlinableDefaultDeclaration(node: t.Node): boolean {
  return is.oneOf(node, [
    'ClassDeclaration',
    'FunctionDeclaration',
    'TSDeclareFunction',
    'TSInterfaceDeclaration',
  ])
}

function inlineExportDeclaration(
  decl: t.Declaration,
  kind: InlineExportKind,
): t.ProgramStatement {
  if (kind === 'default' && 'declare' in decl) {
    // `export default declare class X {}` is invalid
    decl.declare = false
  }

  const exported: t.ProgramStatement =
    kind === 'default'
      ? b.ExportDefaultDeclaration({
          declaration: decl as t.ExportDefaultDeclarationKind,
        })
      : b.ExportNamedDeclaration({
          declaration: decl,
          specifiers: [],
          source: null,
          attributes: [],
        })

  // the comments have to lead the `export` keyword, TypeScript ignores a doc
  // comment sitting between `export` and the declaration
  exported.comments = decl.comments
  decl.comments = undefined

  return exported
}

// #endregion

//#region Export metadata

async function collectModuleExports(
  context: TransformPluginContext,
  nodes: t.ProgramStatement[],
  id: string,
): Promise<ModuleExports> {
  const info: ModuleExports = {
    typeOnlyLocals: new Set(),
    exports: new Map(),
    reExports: [],
    exportAlls: [],
  }

  for (const node of nodes) {
    collectTypeOnlyLocals(node, info.typeOnlyLocals)
  }

  for (const node of nodes) {
    await collectExportInfo(context, node, id, info)
  }

  return info
}

function collectTypeOnlyLocals(
  node: t.ProgramStatement,
  typeOnlyLocals: Set<string>,
): void {
  if (node.type !== 'ImportDeclaration') return

  for (const specifier of node.specifiers) {
    if (
      node.importKind === 'type' ||
      ('importKind' in specifier && specifier.importKind === 'type')
    ) {
      typeOnlyLocals.add(specifier.local.name)
    }
  }
}

function collectDeclarationNames(node: t.Node): string[] {
  if (node.type === 'VariableDeclaration') {
    return node.declarations.flatMap((decl) => collectPatternNames(decl.id))
  }

  if ('id' in node && node.id) {
    if (node.id.type !== 'Identifier' && node.id.type !== 'TSQualifiedName') {
      return []
    }

    const id = getIdFromTSEntityName(node.id)
    return id.type === 'Identifier' ? [id.name] : []
  }

  return []
}

function collectPatternNames(node: t.Node | null | undefined): string[] {
  if (!node) return []

  if (node.type === 'Identifier') {
    return [node.name]
  }

  if (node.type === 'RestElement') {
    return collectPatternNames(node.argument)
  }

  if (node.type === 'AssignmentPattern') {
    return collectPatternNames(node.left)
  }

  if (node.type === 'ArrayPattern') {
    return node.elements.flatMap((element) => collectPatternNames(element))
  }

  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap((property) => {
      if (property.type === 'RestElement') {
        return collectPatternNames(property.argument)
      }
      return collectPatternNames(property.value)
    })
  }

  return []
}

function isTypeOnlyExport(
  node: t.ExportNamedDeclaration,
  specifier: t.ExportSpecifier,
): boolean {
  return node.exportKind === 'type' || specifier.exportKind === 'type'
}

async function collectExportInfo(
  context: TransformPluginContext,
  node: t.ProgramStatement,
  id: string,
  info: ModuleExports,
): Promise<void> {
  if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration) {
      for (const name of collectDeclarationNames(node.declaration)) {
        info.exports.set(name, false)
      }
      return
    }

    const source = await resolveExportSource(context, node.source, id)
    for (const specifier of node.specifiers) {
      const typeOnly = isTypeOnlyExport(node, specifier)

      const exported = nameOf(specifier.exported)!
      const local = nameOf(specifier.local)!
      if (source) {
        info.reExports.push({ source, local, exported, typeOnly })
      } else {
        info.exports.set(exported, typeOnly || info.typeOnlyLocals.has(local))
      }
    }
    return
  }

  if (node.type === 'ExportDefaultDeclaration') {
    info.exports.set('default', false)
    return
  }

  if (node.type === 'ExportAllDeclaration') {
    if (node.exported) {
      info.exports.set(nameOf(node.exported)!, node.exportKind === 'type')
      return
    }

    info.exportAlls.push({
      source: await resolveExportSource(context, node.source, id),
      rawSource: node.source.value,
      typeOnly: node.exportKind === 'type',
    })
  }
}

async function resolveExportSource(
  context: TransformPluginContext,
  source: t.StringLiteral | null | undefined,
  importer: string,
): Promise<string | undefined> {
  if (!source) return

  const resolved = await context.resolve(source.value, importer)
  if (!resolved || resolved.external) return

  return resolved.id
}

function collectChunkExportInfo(
  chunk: RenderedChunk,
  moduleExportsMap: Map<string, ModuleExports>,
): ChunkExportInfo {
  const exportsByModule = resolveAllModuleExports(moduleExportsMap)
  const roots =
    chunk.facadeModuleId && moduleExportsMap.has(chunk.facadeModuleId)
      ? [chunk.facadeModuleId]
      : chunk.moduleIds
  const mergedExports = new Map<string, boolean>()
  const typeOnlyExportAllSources = new Set<string>()

  for (const root of roots) {
    const exports = exportsByModule.get(root)
    if (exports) {
      for (const [name, typeOnly] of exports) {
        setExportTypeOnly(mergedExports, name, typeOnly)
      }
    }

    const moduleExports = moduleExportsMap.get(root)
    if (!moduleExports) continue

    for (const exportAll of moduleExports.exportAlls) {
      if (!exportAll.typeOnly || exportAll.source) continue
      typeOnlyExportAllSources.add(exportAll.rawSource)
    }
  }

  const typeOnlyNames = new Set<string>()
  const inlineNames = new Set<string>()
  for (const [name, typeOnly] of mergedExports) {
    if (typeOnly) typeOnlyNames.add(name)
    else inlineNames.add(name)
  }

  return { typeOnlyNames, typeOnlyExportAllSources, inlineNames }
}

function resolveAllModuleExports(
  moduleExportsMap: Map<string, ModuleExports>,
): Map<string, Map<string, boolean>> {
  const exportsByModule = new Map<string, Map<string, boolean>>()

  for (const [id, info] of moduleExportsMap) {
    exportsByModule.set(id, new Map(info.exports))
  }

  let changed = true
  while (changed) {
    changed = false

    for (const [id, info] of moduleExportsMap) {
      const exports = exportsByModule.get(id)!

      for (const reExport of info.reExports) {
        const sourceExports = reExport.source
          ? exportsByModule.get(reExport.source)
          : undefined
        const sourceTypeOnly = sourceExports?.get(reExport.local) ?? false
        if (
          setExportTypeOnly(
            exports,
            reExport.exported,
            reExport.typeOnly || sourceTypeOnly,
          )
        ) {
          changed = true
        }
      }

      for (const exportAll of info.exportAlls) {
        if (!exportAll.source) continue

        const sourceExports = exportsByModule.get(exportAll.source)
        if (!sourceExports) continue

        for (const [name, typeOnly] of sourceExports) {
          if (name === 'default') continue
          if (
            setExportTypeOnly(exports, name, exportAll.typeOnly || typeOnly)
          ) {
            changed = true
          }
        }
      }
    }
  }

  return exportsByModule
}

function setExportTypeOnly(
  exports: Map<string, boolean>,
  name: string,
  typeOnly: boolean,
): boolean {
  const current = exports.get(name)
  if (current === false || current === typeOnly) return false

  if (current === undefined || !typeOnly) {
    exports.set(name, typeOnly)
    return true
  }

  return false
}

// #endregion

//#region Declaration dependency collection

/**
 * Collects all TSTypeParameter nodes from the given node and groups them by
 * their name. One name can associate with one or more type parameters. These
 * names will be used as the parameter name in the generated JavaScript
 * dependency function.
 */
function collectParams(node: t.Node): TypeParams {
  const typeParams: t.Identifier[] = []
  walk(node, {
    leave(node) {
      if (
        'typeParameters' in node &&
        node.typeParameters?.type === 'TSTypeParameterDeclaration'
      ) {
        typeParams.push(...node.typeParameters.params.map(({ name }) => name))
      }
    },
  })

  const paramMap = new Map<string, t.Identifier[]>()
  for (const typeParam of typeParams) {
    const name = typeParam.name
    const group = paramMap.get(name)
    if (group) {
      group.push(typeParam)
    } else {
      paramMap.set(name, [typeParam])
    }
  }

  return Array.from(paramMap, ([name, typeParams]) => ({
    name,
    typeParams,
  }))
}

async function collectDependencies(
  context: TransformPluginContext,
  node: t.Node,
  importer: string,
  namespaceStmts: NamespaceMap,
  children: Set<t.Node>,
  identifierMap: Record<string, number>,
): Promise<Dep[]> {
  const deps = new Set<Dep>()
  const seen = new Set<t.Node>()
  const preserveImportTypeCache = new Map<string, boolean>()

  const inferredStack: string[][] = []
  let currentInferred = new Set<string>()
  function isInferred(node: t.Node): boolean {
    return node.type === 'Identifier' && currentInferred.has(node.name)
  }

  await walkAsync(node, {
    enter(node) {
      if (node.type !== 'TSConditionalType') return

      const inferred = collectInferredNames(node.extendsType)
      inferredStack.push(inferred)
    },
    async leave(node, path) {
      const { parent } = path

      // handle infer scope
      if (node.type === 'TSConditionalType') {
        inferredStack.pop()
      } else if (parent?.type === 'TSConditionalType') {
        const trueBranch = parent.trueType === node
        currentInferred = new Set<string>(
          (trueBranch ? inferredStack : inferredStack.slice(0, -1)).flat(),
        )
      } else {
        currentInferred = new Set<string>()
      }

      if (node.type === 'ExportNamedDeclaration') {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportSpecifier') {
            addDependency(specifier.local)
          }
        }
      } else if (node.type === 'TSInterfaceDeclaration' && node.extends) {
        for (const heritage of node.extends || []) {
          addDependency(heritage.expression)
        }
      } else if (node.type === 'ClassDeclaration') {
        if (node.superClass) addDependency(node.superClass)
        if (node.implements) {
          for (const implement of node.implements) {
            addDependency(implement.expression)
          }
        }
      } else if (
        is.oneOf(node, [
          'Property',
          'PropertyDefinition',
          'TSAbstractPropertyDefinition',
          'MethodDefinition',
          'TSAbstractMethodDefinition',
          'TSPropertySignature',
          'TSMethodSignature',
        ])
      ) {
        if (node.computed && isReferenceId(node.key)) {
          addDependency(node.key)
        }
        if ('value' in node && isReferenceId(node.value)) {
          addDependency(node.value)
        }
      } else {
        switch (node.type) {
          case 'TSTypeReference': {
            addDependency(TSEntityNameToRuntime(node.typeName))
            break
          }
          case 'TSQualifiedName': {
            addDependency(getIdFromTSEntityName(node.left))
            break
          }
          case 'TSTypeQuery': {
            if (seen.has(node.exprName)) return
            if (node.exprName.type === 'TSImportType') break

            addDependency(TSEntityNameToRuntime(node.exprName))

            break
          }
          case 'TSImportType': {
            seen.add(node)
            const { source, qualifier } = node

            const resolved = await context.resolve(source.value, importer)
            if (!resolved || !!resolved.external) {
              preserveImportTypeCache.set(source.value, true)
              break
            }

            const dep = importNamespace(
              node,
              qualifier,
              source,
              namespaceStmts,
              identifierMap,
            )
            if (dep) addDependency(dep)
            break
          }
        }
      }

      if (parent && !deps.has(node as Dep) && isChildSymbol(node, parent)) {
        children.add(node)
      }
    },
  })

  return Array.from(deps)

  function addDependency(node: Dep) {
    if (isThisExpression(node) || isInferred(node)) return
    deps.add(node)
  }
}

function importNamespace(
  node: t.TSImportType,
  imported: t.TSTypeName | null | undefined,
  source: t.StringLiteral,
  namespaceStmts: NamespaceMap,
  identifierMap: Record<string, number>,
): Dep | undefined {
  const sourceText = source.value.replaceAll(/\W/g, '_')
  // Use original source if it's already a valid identifier,
  // otherwise use formatted text with index.
  const localName = `_$${
    isIdentifierName(source.value)
      ? source.value
      : `${sourceText}${getIdentifierIndex(identifierMap, sourceText)}`
  }`
  let local: t.Identifier | t.TSQualifiedName = b.Identifier({
    name: localName,
  })

  if (namespaceStmts.has(source.value)) {
    local = namespaceStmts.get(source.value)!.local
  } else {
    // prepend: import * as ${local} from ${source}
    namespaceStmts.set(source.value, {
      stmt: b.ImportDeclaration({
        specifiers: [b.ImportNamespaceSpecifier({ local })],
        source,
        phase: null,
        attributes: [],
      }),
      local,
    })
  }

  if (imported) {
    const importedLeft = getIdFromTSEntityName(imported)
    if (
      imported.type === 'ThisExpression' ||
      importedLeft.type === 'ThisExpression'
    ) {
      throw new Error('Cannot import `this` from module.')
    }
    overwriteNode(
      importedLeft,
      b.TSQualifiedName({ left: local, right: { ...importedLeft } }),
    )
    local = imported
  }

  let replacement: t.Node = node
  if (node.typeArguments) {
    overwriteNode(
      node,
      b.TSTypeReference({ typeName: local, typeArguments: node.typeArguments }),
    )
    replacement = local
  } else {
    overwriteNode(node, local)
  }

  const dep: Dep = {
    ...TSEntityNameToRuntime(local),
    replace(newNode) {
      overwriteNode(replacement, newNode)
    },
  }
  return dep
}

// #endregion

function isChildSymbol(node: t.Node, parent: t.Node) {
  if (node.type === 'Identifier') return true
  if (
    is.oneOf(parent, ['TSPropertySignature', 'TSMethodSignature']) &&
    parent.key === node
  )
    return true

  return false
}

function collectInferredNames(node: t.Node) {
  const inferred: string[] = []
  walk(node, {
    enter(node) {
      if (node.type === 'TSInferType' && node.typeParameter) {
        inferred.push(node.typeParameter.name.name)
      }
    },
  })
  return inferred
}

const REFERENCE_RE = /\/\s*<reference\s+(?:path|types)=/
function collectReferenceDirectives(comment: t.Comment[], negative = false) {
  return comment.filter((c) => REFERENCE_RE.test(c.value) !== negative)
}

const SOURCE_MAP_PRAGMA_RE = /^#\s*source(?:Mapping)?URL=/
function isSourceMapPragma(comment: { value: string }): boolean {
  return SOURCE_MAP_PRAGMA_RE.test(comment.value)
}

function isCjsDtsInputSyntax(node: t.ProgramStatement): boolean {
  return (
    node.type === 'TSExportAssignment' ||
    (node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference.type === 'TSExternalModuleReference')
  )
}

//#region Runtime binding variable

/**
 * A variable declaration that declares a runtime binding variable. It represents a declaration like:
 *
 * ```js
 * var binding = [declarationId, (param, ...) => [dep, ...], sideEffect()]
 * ```
 *
 * For an more concrete example, the following TypeScript declaration:
 *
 * ```ts
 * interface Bar extends Foo { bar: number }
 * ```
 *
 * Will be transformed to the following JavaScript code:
 *
 * ```js
 * const Bar = [123, () => [Foo]]
 * ```
 *
 * Which will be represented by this type.
 */
type RuntimeBindingVariableDeclration = t.VariableDeclaration & {
  declarations: [
    t.VariableDeclarator & {
      id: t.ArrayPattern
      init: RuntimeBindingArrayExpression
    },
    ...t.VariableDeclarator[],
  ]
}

/**
 * Check if the given node is a {@link RuntimeBindingVariableDeclration}
 */
function isRuntimeBindingVariableDeclaration(
  node: t.Node | null | undefined,
): node is RuntimeBindingVariableDeclration {
  return (
    node?.type === 'VariableDeclaration' &&
    node.declarations.length === 1 &&
    node.declarations[0].type === 'VariableDeclarator' &&
    node.declarations[0].id.type === 'ArrayPattern' &&
    isRuntimeBindingArrayExpression(node.declarations[0].init)
  )
}

/**
 * A array expression that contains {@link RuntimeBindingArrayElements}
 *
 * It can be used to represent the following JavaScript code:
 *
 * ```js
 * [declarationId, (param, ...) => [dep, ...], sideEffect()]
 * ```
 */
type RuntimeBindingArrayExpression = t.ArrayExpression & {
  elements: RuntimeBindingArrayElements
}

/**
 * Check if the given node is a {@link RuntimeBindingArrayExpression}
 */
function isRuntimeBindingArrayExpression(
  node: t.Node | null | undefined,
): node is RuntimeBindingArrayExpression {
  return (
    node?.type === 'ArrayExpression' &&
    isRuntimeBindingArrayElements(node.elements)
  )
}

/**
 * Check if the given array is a {@link RuntimeBindingArrayElements}
 */
function isRuntimeBindingArrayElements(
  elements: Array<t.Node | null | undefined>,
): elements is RuntimeBindingArrayElements {
  const [declarationId, deps, children, effect] = elements
  return (
    is.NumericLiteral(declarationId) &&
    deps?.type === 'ArrowFunctionExpression' &&
    children?.type === 'ArrayExpression' &&
    (!effect || effect.type === 'CallExpression')
  )
}

function runtimeBindingArrayExpression(
  elements: RuntimeBindingArrayElements,
): RuntimeBindingArrayExpression {
  return b.ArrayExpression({
    elements: [...elements],
  }) as RuntimeBindingArrayExpression
}

type RuntimeBindingArrayElementsBase = [
  declarationId: t.NumericLiteral,
  deps: t.ArrowFunctionExpression,
  children: t.ArrayExpression,
]

/**
 * An array that represents the elements in {@link RuntimeBindingArrayExpression}
 */
type RuntimeBindingArrayElements =
  | RuntimeBindingArrayElementsBase
  | [...RuntimeBindingArrayElementsBase, effect: t.CallExpression]

// #endregion

function isThisExpression(node: t.Node): boolean {
  return (
    is.Identifier(node, 'this') ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && isThisExpression(node.object))
  )
}

function isInfer(node: t.Node): node is t.Identifier {
  return is.Identifier(node, 'infer')
}

function TSEntityNameToRuntime(
  node: t.TSTypeName,
): t.MemberExpression | t.Identifier | t.ThisExpression {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }

  const left = TSEntityNameToRuntime(node.left)
  return Object.assign(node, {
    type: 'MemberExpression' as const,
    object: left,
    property: node.right,
    computed: false,
  })
}

function getIdFromTSEntityName(
  node: t.TSTypeName,
): t.Identifier | t.ThisExpression {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }
  return getIdFromTSEntityName(node.left)
}

function isReferenceId(
  node?: t.Node | null,
): node is t.Identifier | t.MemberExpression {
  return is.oneOf(node, ['Identifier', 'MemberExpression'])
}

function isHelperImport(node: t.Node) {
  return (
    node.type === 'ImportDeclaration' &&
    node.specifiers.length &&
    node.specifiers.every(
      (spec) =>
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier' &&
        ['__exportAll', '__reExport'].includes(spec.local.name),
    )
  )
}

/**
 * patch `.d.ts` suffix in import source to `.js`
 */
function patchImportExport(
  node: t.ProgramStatement,
  exportInfo: ChunkExportInfo,
  cjsDefault: boolean,
): t.ProgramStatement | false | undefined {
  if (
    node.type === 'ExportNamedDeclaration' &&
    !node.declaration &&
    !node.source &&
    !node.specifiers.length &&
    !node.attributes?.length
  ) {
    return false
  }

  if (node.type === 'ImportDeclaration' && node.specifiers.length) {
    for (const specifier of node.specifiers) {
      if (isInfer(specifier.local)) {
        specifier.local.name = '__Infer'
      }
    }
  }

  if (
    is.oneOf(node, [
      'ImportDeclaration',
      'ExportAllDeclaration',
      'ExportNamedDeclaration',
    ])
  ) {
    if (
      node.type === 'ExportAllDeclaration' &&
      node.source &&
      exportInfo.typeOnlyExportAllSources.has(node.source.value)
    ) {
      node.exportKind = 'type'
    }

    if (
      node.type === 'ExportNamedDeclaration' &&
      exportInfo.typeOnlyNames.size
    ) {
      for (const spec of node.specifiers) {
        const name = nameOf(spec.exported)!
        if (exportInfo.typeOnlyNames.has(name)) {
          if (spec.type === 'ExportSpecifier') {
            spec.exportKind = 'type'
          } else {
            node.exportKind = 'type'
          }
        }
      }
      normalizeTypeOnlyExport(node)
    }

    if (node.source?.value && RE_DTS.test(node.source.value)) {
      node.source.value = filename_dts_to(node.source.value, 'js')
      return node
    }

    if (
      cjsDefault &&
      node.type === 'ExportNamedDeclaration' &&
      !node.source &&
      node.specifiers.length === 1 &&
      node.specifiers[0].type === 'ExportSpecifier' &&
      nameOf(node.specifiers[0].exported) === 'default'
    ) {
      const defaultExport = node.specifiers[0]
      return b.TSExportAssignment({
        expression: defaultExport.local,
      })
    }
  }
}

function normalizeTypeOnlyExport(node: t.ExportNamedDeclaration): void {
  if (node.declaration || !node.specifiers.length) return

  for (const specifier of node.specifiers) {
    if (
      specifier.type !== 'ExportSpecifier' ||
      specifier.exportKind !== 'type'
    ) {
      return
    }
  }

  node.exportKind = 'type'
  for (const specifier of node.specifiers) {
    if (specifier.type === 'ExportSpecifier') {
      specifier.exportKind = 'value'
    }
  }
}

/**
 * Handle `__exportAll` call
 */
function patchTsNamespace(nodes: t.ProgramStatement[]) {
  const removed = new Set<t.Node>()

  for (const [i, node] of nodes.entries()) {
    const result = getExportAllNamespace(node)
    if (!result) continue

    const [binding, exports] = result
    if (!exports.properties.length) continue

    const namespaceExport = b.ExportNamedDeclaration({
      declaration: null,
      specifiers: exports.properties
        .filter((property) => property.type === 'Property')
        .map((property) => {
          const local = (property.value as t.ArrowFunctionExpression)
            .body as t.Identifier
          const exported = property.key as t.Identifier
          return b.ExportSpecifier({ local, exported })
        }),
      source: null,
      attributes: [],
    })
    nodes[i] = b.TSModuleDeclaration({
      id: binding,
      body: b.TSModuleBlock({ body: [namespaceExport] }),
      kind: 'namespace',
      declare: true,
      global: false,
    })
  }

  return nodes.filter((node) => !removed.has(node))
}

function getExportAllNamespace(
  node: t.ProgramStatement,
): false | [t.Identifier, t.ObjectExpression] {
  if (
    node.type !== 'VariableDeclaration' ||
    node.declarations.length !== 1 ||
    node.declarations[0].id.type !== 'Identifier' ||
    node.declarations[0].init?.type !== 'CallExpression' ||
    node.declarations[0].init.callee.type !== 'Identifier' ||
    node.declarations[0].init.callee.name !== '__exportAll' ||
    node.declarations[0].init.arguments.length !== 1 ||
    node.declarations[0].init.arguments[0].type !== 'ObjectExpression'
  ) {
    return false
  }

  const source = node.declarations[0].id

  const exports = node.declarations[0].init.arguments[0]
  return [source, exports] as const
}

/**
 * Handle `__reExport` call
 */
function patchReExport(nodes: t.ProgramStatement[]) {
  const exportsNames = new Map<string, string>()

  for (const [i, node] of nodes.entries()) {
    if (
      node.type === 'ImportDeclaration' &&
      node.specifiers.length === 1 &&
      node.specifiers[0].type === 'ImportSpecifier' &&
      node.specifiers[0].local.type === 'Identifier' &&
      node.specifiers[0].local.name.endsWith('_exports')
    ) {
      // record: import { t as a_exports } from "..."
      exportsNames.set(
        node.specifiers[0].local.name,
        node.specifiers[0].local.name,
      )
    } else if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      is.Identifier(node.expression.callee, '__reExport')
    ) {
      // record: __reExport(a_exports, import_lib)

      const args = node.expression.arguments
      exportsNames.set(
        (args[0] as t.Identifier).name,
        (args[1] as t.Identifier).name,
      )
    } else if (
      node.type === 'VariableDeclaration' &&
      node.declarations.length === 1 &&
      node.declarations[0].init?.type === 'MemberExpression' &&
      node.declarations[0].init.object.type === 'Identifier' &&
      exportsNames.has(node.declarations[0].init.object.name)
    ) {
      // var B = a_exports.A
      // to
      // type B = [mapping].A
      // TODO how to support value import? currently only type import is supported

      nodes[i] = b.TSTypeAliasDeclaration({
        id: b.Identifier({
          name: (node.declarations[0].id as t.Identifier).name,
        }),
        typeParameters: null,
        typeAnnotation: b.TSTypeReference({
          typeName: b.TSQualifiedName({
            left: b.Identifier({
              name: exportsNames.get(node.declarations[0].init.object.name)!,
            }),
            right: b.Identifier({
              name: (node.declarations[0].init.property as t.Identifier).name,
            }),
          }),
          typeArguments: null,
        }),
        declare: false,
      })
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      node.specifiers.length === 1 &&
      node.specifiers[0].type === 'ExportSpecifier' &&
      node.specifiers[0].local.type === 'Identifier' &&
      exportsNames.has(node.specifiers[0].local.name)
    ) {
      // export { a_exports as t }
      // to
      // export { [mapping] as t }
      node.specifiers[0].local.name = exportsNames.get(
        node.specifiers[0].local.name,
      )!
    }
  }

  return nodes
}

// fix:
// - import type { ... } from '...'
// - import { type ... } from '...'
// - export type { ... }
// - export { type ... }
// - export type * as x '...'
// - import Foo = require("./bar")
// - export = Foo
// - export default x
function rewriteImportExport(
  node: t.Node,
  set: (node: t.ProgramStatement) => void,
  appendStmts: t.ProgramStatement[],
): node is
  t.ImportDeclaration | t.ExportAllDeclaration | t.TSImportEqualsDeclaration {
  if (
    node.type === 'ImportDeclaration' ||
    (node.type === 'ExportNamedDeclaration' && !node.declaration)
  ) {
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier') {
        specifier.importKind = 'value'
      } else if (specifier.type === 'ExportSpecifier') {
        specifier.exportKind = 'value'
      }
    }

    if (node.type === 'ImportDeclaration') {
      node.importKind = 'value'
    } else if (node.type === 'ExportNamedDeclaration') {
      node.exportKind = 'value'
    }

    return true
  } else if (node.type === 'ExportAllDeclaration') {
    node.exportKind = 'value'
    return true
  } else if (
    node.type === 'TSImportEqualsDeclaration' ||
    (node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'TSImportEqualsDeclaration')
  ) {
    const decl =
      node.type === 'ExportNamedDeclaration'
        ? (node.declaration as t.TSImportEqualsDeclaration)
        : node

    if (decl.moduleReference.type === 'TSExternalModuleReference') {
      set(
        b.ImportDeclaration({
          specifiers: [b.ImportNamespaceSpecifier({ local: decl.id })],
          source: decl.moduleReference.expression,
          phase: null,
          attributes: [],
        }),
      )
      if (node.type === 'ExportNamedDeclaration') {
        appendStmts.push(
          b.ExportNamedDeclaration({
            declaration: null,
            specifiers: [
              b.ExportSpecifier({ local: decl.id, exported: decl.id }),
            ],
            source: null,
            attributes: [],
          }),
        )
      }
      return true
    }
  } else if (
    node.type === 'TSExportAssignment' &&
    node.expression.type === 'Identifier'
  ) {
    set(
      b.ExportNamedDeclaration({
        declaration: null,
        specifiers: [
          b.ExportSpecifier({
            local: node.expression,
            exported: b.Identifier({ name: 'default' }),
          }),
        ],
        source: null,
        attributes: [],
      }),
    )
    return true
  } else if (
    node.type === 'ExportDefaultDeclaration' &&
    node.declaration.type === 'Identifier'
  ) {
    set(
      b.ExportNamedDeclaration({
        declaration: null,
        specifiers: [
          b.ExportSpecifier({
            local: node.declaration,
            exported: b.Identifier({ name: 'default' }),
          }),
        ],
        source: null,
        attributes: [],
      }),
    )
    return true
  }

  return false
}

function overwriteNode<T>(node: t.Node, newNode: T): T {
  // clear object keys
  for (const key of Object.keys(node)) {
    Reflect.deleteProperty(node, key)
  }
  Object.assign(node, newNode)
  return node as T
}

/**
 * Region markers and alike, the comments worth keeping when their node is
 * replaced or dropped
 */
function pragmaComments(node: t.Node): t.AttachedComment[] {
  return (
    node.comments?.filter(
      (comment) =>
        comment.position === 'before' &&
        comment.value.startsWith('#') &&
        !isSourceMapPragma(comment),
    ) || []
  )
}

function inheritNodeComments<T extends t.Node>(oldNode: t.Node, newNode: T): T {
  newNode.comments ||= []
  newNode.comments.unshift(...pragmaComments(oldNode))

  newNode.comments = newNode.comments.filter(
    (comment) =>
      !REFERENCE_RE.test(comment.value) && !isSourceMapPragma(comment),
  )

  return newNode
}

function getIdentifierIndex(
  identifierMap: Record<string, number>,
  name: string,
): number {
  if (name in identifierMap) {
    return ++identifierMap[name]
  }
  return (identifierMap[name] = 0)
}

export function typeAssert<T>(
  // eslint-disable-next-line unused-imports/no-unused-vars
  value: T,
): asserts value is Exclude<T, false | null | undefined> {}
