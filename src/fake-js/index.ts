import { b, is, walk } from 'yuku-ast'
import { generate } from 'yuku-codegen'
import { parse, type ParseResult } from 'yuku-parser'
import {
  filename_js_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_NODE_MODULES,
  replaceTemplateName,
  resolveTemplateFn,
} from '../filename.ts'
import { EMPTY_STUB } from '../generate.ts'
import { collectDependencies, collectParams } from './dependency.ts'
import {
  collectModuleExports,
  inlineExportDeclaration,
  planChunkExports,
} from './exports.ts'
import {
  patchImportExport,
  patchReExport,
  patchTsNamespace,
  rewriteImportExport,
} from './patch.ts'
import {
  isRuntimeBindingVariableDeclaration,
  runtimeBindingArrayExpression,
} from './runtime-binding.ts'
import {
  collectReferenceDirectives,
  getIdentifierIndex,
  getIdFromTSEntityName,
  inheritNodeComments,
  isCjsDtsInputSyntax,
  isHelperImport,
  isInfer,
  overwriteNode,
  pragmaComments,
} from './utils.ts'
import type { OptionsResolved } from '../options.ts'
import type {
  DeclarationInfo,
  ModuleExports,
  NamespaceMap,
  TypeParams,
} from './types.ts'
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

    const exportPlan = planChunkExports(
      chunk,
      moduleExportsMap,
      program.body,
      getDeclaration,
      cjsDefault,
    )

    function renderStatement(
      node: t.ProgramStatement,
    ): t.ProgramStatement | null | false {
      if (isHelperImport(node)) return null
      if (node.type === 'ExpressionStatement') return null

      const newNode = patchImportExport(node, exportPlan, cjsDefault)
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

      const kind = exportPlan.inlineKinds.get(declarationId!)
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

    if (!program.body.some(isModuleStatement)) {
      program.body.push(
        b.ExportNamedDeclaration({
          declaration: null,
          specifiers: [],
          source: null,
          attributes: [],
        }),
      )
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

function isModuleStatement(node: t.ProgramStatement): boolean {
  return (
    is.oneOf(node, [
      'ImportDeclaration',
      'ExportAllDeclaration',
      'ExportDefaultDeclaration',
      'ExportNamedDeclaration',
      'TSExportAssignment',
    ]) ||
    (node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference.type === 'TSExternalModuleReference')
  )
}
