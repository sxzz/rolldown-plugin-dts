import { generate } from '@babel/generator'
import { isIdentifierName } from '@babel/helper-validator-identifier'
import { parse, type ParseResult } from '@babel/parser'
import {
  isDeclarationType,
  isIdentifierOf,
  isTypeOf,
  resolveString,
  walkAST,
  walkASTAsync,
} from 'ast-kit'
import {
  filename_dts_to,
  filename_js_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_NODE_MODULES,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type * as t from '@babel/types'
import type {
  Plugin,
  RenderedChunk,
  TransformPluginContext,
  TransformResult,
} from 'rolldown'

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
  typeOnlyNames: Set<string>
  typeOnlyExportAllSources: Set<string>
}

type NamespaceMap = Map<
  string,
  {
    stmt: t.Statement
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
        plugins: [['typescript', { dts: true }], 'decoratorAutoAccessors'],
        sourceType: 'module',
        errorRecovery: true,
        createParenthesizedExpressions: true,
      })
    } catch (error) {
      throw new Error(
        `Failed to parse ${id}. This may be caused by a syntax error in the declaration file or a bug in the plugin. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts\n${error}`,
        { cause: error },
      )
    }

    const { program, comments } = file
    moduleExportsMap.set(id, await collectModuleExports(this, program.body, id))
    const identifierMap: Record<string, number> = Object.create(null)

    if (!warnedCjsDtsInputs.has(id) && program.body.some(isCjsDtsInputSyntax)) {
      warnedCjsDtsInputs.add(id)
      this.warn(
        RE_NODE_MODULES.test(id)
          ? `${id} uses CommonJS dts syntax. CommonJS dts modules cannot be reliably bundled by rolldown-plugin-dts. Please mark this module as external in your Rolldown config.`
          : `${id} uses CommonJS dts syntax. rolldown-plugin-dts does not support reliably bundling CommonJS dts input.`,
      )
    }

    if (comments) {
      const directives = collectReferenceDirectives(comments)
      commentsMap.set(id, directives)
    }

    const appendStmts: t.Statement[] = []
    const namespaceStmts: NamespaceMap = new Map()

    for (const [i, stmt] of program.body.entries()) {
      const setStmt = (stmt: t.Statement) => (program.body[i] = stmt)
      if (rewriteImportExport(stmt, setStmt)) continue

      const sideEffect =
        stmt.type === 'TSModuleDeclaration' && stmt.kind !== 'namespace'

      if (
        sideEffect &&
        stmt.id.type === 'StringLiteral' &&
        stmt.id.value[0] === '.'
      ) {
        this.warn(
          `\`declare module ${JSON.stringify(stmt.id.value)}\` will be kept as-is in the output. Relative module declaration may cause unexpected issues. Found in ${id}.`,
        )
      }

      if (
        sideEffect &&
        id.endsWith('.vue.d.ts') &&
        code.slice(stmt.start!, stmt.end!).includes('__VLS_')
      ) {
        continue
      }

      const isDefaultExport = stmt.type === 'ExportDefaultDeclaration'
      const isExportDecl =
        isTypeOf(stmt, [
          'ExportNamedDeclaration', // export let x
          'ExportDefaultDeclaration', // export default function x() {}
        ]) && !!stmt.declaration

      const decl: t.Node = isExportDecl ? stmt.declaration! : stmt
      const setDecl = isExportDecl
        ? (decl: t.VariableDeclaration) => (stmt.declaration = decl)
        : setStmt

      if (decl.type !== 'TSDeclareFunction' && !isDeclarationType(decl)) {
        continue
      }

      if (
        isTypeOf(decl, [
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
        let binding = decl.id
        if (binding.type === 'TSQualifiedName') {
          binding = getIdFromTSEntityName(binding)
        }

        binding = sideEffect
          ? {
              type: 'Identifier',
              name: `_${getIdentifierIndex(identifierMap, '')}`,
            }
          : binding

        if (binding.type !== 'Identifier') {
          throw new Error(`Unexpected ${binding.type} declaration id`)
        }

        bindings.push(binding)
      } else {
        const binding: t.Identifier = {
          type: 'Identifier',
          name: 'export_default',
        }
        bindings.push(binding)
        // @ts-expect-error
        decl.id = binding
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
        decl.leadingComments = stmt.leadingComments
      }

      const declarationId = registerDeclaration({
        decl,
        deps,
        bindings,
        params,
        children,
      })

      const declarationIdNode: t.NumericLiteral = {
        type: 'NumericLiteral',
        value: declarationId,
      }
      const depsBody: t.ArrayExpression = {
        type: 'ArrayExpression',
        elements: deps,
      }
      const depsNode: t.ArrowFunctionExpression = {
        type: 'ArrowFunctionExpression',
        params: params.map(
          ({ name }): t.Identifier => ({ type: 'Identifier', name }),
        ),
        body: depsBody,
        async: false,
        expression: true,
      }
      const childrenNode: t.ArrayExpression = {
        type: 'ArrayExpression',
        elements: children.map((node) => ({
          type: 'StringLiteral',
          value: '',
          start: node.start,
          end: node.end,
          loc: node.loc,
        })),
      }
      const sideEffectNode: t.CallExpression | false = sideEffect && {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'sideEffect' },
        arguments: [bindings[0]],
      }
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
      const runtimeAssignment: RuntimeBindingVariableDeclration = {
        type: 'VariableDeclaration',
        kind: 'var',
        declarations: [
          {
            type: 'VariableDeclarator',
            id: { ...bindings[0], typeAnnotation: null },
            init: runtimeArrayNode,
          },
          ...bindings.slice(1).map(
            (binding): t.VariableDeclarator => ({
              type: 'VariableDeclarator',
              id: { ...binding, typeAnnotation: null },
            }),
          ),
        ],
      }

      if (isDefaultExport) {
        // export { ${binding} as default }
        appendStmts.push({
          type: 'ExportNamedDeclaration',
          declaration: null,
          specifiers: [
            {
              type: 'ExportSpecifier',
              local: bindings[0],
              exported: { type: 'Identifier', name: 'default' },
            },
          ],
          source: null,
          attributes: null,
        })
        // replace the whole statement
        setStmt(runtimeAssignment)
      } else {
        // replace declaration, keep `export`
        setDecl(runtimeAssignment)
      }
    }

    if (sideEffects) {
      // module side effect marker
      appendStmts.push({
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'sideEffect' },
          arguments: [],
        },
      })
    }

    program.body = [
      ...Array.from(namespaceStmts.values()).map(({ stmt }) => stmt),
      ...program.body,
      ...appendStmts,
    ]

    const result = generate(file, {
      comments: false,
      sourceMaps: sourcemap,
      sourceFileName: id,
    })

    return {
      code: result.code,
      map: result.map as any,
    }
  }

  function renderChunk(code: string, chunk: RenderedChunk) {
    if (!RE_DTS.test(chunk.fileName)) {
      return
    }

    const exportInfo = collectChunkExportInfo(chunk, moduleExportsMap)

    let file: ParseResult
    try {
      file = parse(code, { sourceType: 'module' })
    } catch (error) {
      throw new Error(
        `Failed to parse generated code for chunk ${chunk.fileName}. This may be caused by a bug in the plugin. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts\n${error}`,
        { cause: error },
      )
    }

    const { program } = file
    program.body = patchTsNamespace(program.body)
    program.body = patchReExport(program.body)

    program.body = program.body
      .map((node) => {
        if (isHelperImport(node)) return null
        if (node.type === 'ExpressionStatement') return null

        const newNode = patchImportExport(node, exportInfo, cjsDefault)
        if (newNode || newNode === false) {
          return newNode
        }

        if (node.type !== 'VariableDeclaration') return node

        if (!isRuntimeBindingVariableDeclaration(node)) {
          return null
        }

        const [declarationIdNode, depsFn, children /*, ignore sideEffect */] =
          node.declarations[0].init.elements

        const declarationId = declarationIdNode.value
        const declaration = getDeclaration(declarationId)

        walkAST<t.Node | t.Comment>(declaration.decl, {
          enter(node) {
            if (node.type === 'CommentBlock') {
              return
            }
            delete node.loc
          },
        })

        for (const [i, decl] of node.declarations.entries()) {
          const transformedBinding = {
            ...decl.id,
            typeAnnotation: declaration.bindings[i].typeAnnotation,
          }
          overwriteNode(declaration.bindings[i], transformedBinding)
        }

        for (const [i, child] of (
          children.elements as t.StringLiteral[]
        ).entries()) {
          Object.assign(declaration.children[i], {
            loc: child.loc,
          })
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
            transformedDep = {
              type: 'Identifier',
              name: 'undefined',
              loc: transformedDep.loc,
              start: transformedDep.start,
              end: transformedDep.end,
            }
          } else if (isInfer(transformedDep)) {
            transformedDep.name = '__Infer'
          }

          if (originalDep.replace) {
            originalDep.replace(transformedDep)
          } else {
            Object.assign(originalDep, transformedDep)
          }
        }

        return inheritNodeComments(node, declaration.decl)
      })
      .filter((node) => !!node)

    if (program.body.length === 0) {
      return 'export { };'
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
      program.body[0].leadingComments ||= []
      program.body[0].leadingComments.unshift(...comments)
    }

    const result = generate(file, {
      sourceMaps: sourcemap,
      sourceFileName: chunk.fileName,
    })

    return {
      code: result.code,
      map: result.map as any,
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

//#region Export metadata

async function collectModuleExports(
  context: TransformPluginContext,
  nodes: t.Statement[],
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
  node: t.Statement,
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
  specifier:
    | t.ExportSpecifier
    | t.ExportDefaultSpecifier
    | t.ExportNamespaceSpecifier,
): boolean {
  return (
    node.exportKind === 'type' ||
    ('exportKind' in specifier && specifier.exportKind === 'type')
  )
}

async function collectExportInfo(
  context: TransformPluginContext,
  node: t.Statement,
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

      if (specifier.type === 'ExportSpecifier') {
        const exported = resolveString(specifier.exported)
        const local = resolveString(specifier.local)
        if (source) {
          info.reExports.push({ source, local, exported, typeOnly })
        } else {
          info.exports.set(exported, typeOnly || info.typeOnlyLocals.has(local))
        }
      } else {
        const exported = resolveString(specifier.exported)
        info.exports.set(exported, typeOnly)
      }
    }
    return
  }

  if (node.type === 'ExportDefaultDeclaration') {
    info.exports.set('default', false)
    return
  }

  if (node.type === 'ExportAllDeclaration') {
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
  for (const [name, typeOnly] of mergedExports) {
    if (typeOnly) typeOnlyNames.add(name)
  }

  return { typeOnlyNames, typeOnlyExportAllSources }
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
  walkAST(node, {
    leave(node) {
      if (
        'typeParameters' in node &&
        node.typeParameters?.type === 'TSTypeParameterDeclaration'
      ) {
        typeParams.push(
          ...node.typeParameters.params.map(
            ({ name }): t.Identifier =>
              typeof name === 'string' ? { type: 'Identifier', name } : name,
          ),
        )
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

  return Array.from(paramMap.entries()).map(([name, typeParams]) => ({
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

  await walkASTAsync(node, {
    enter(node) {
      if (node.type === 'TSConditionalType') {
        const inferred = collectInferredNames(node.extendsType)
        inferredStack.push(inferred)
      }
      return Promise.resolve()
    },
    async leave(node, parent) {
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
            if (implement.type === 'ClassImplements') {
              throw new Error('Unexpected Flow syntax')
            }
            addDependency(implement.expression)
          }
        }
      } else if (
        isTypeOf(node, [
          'ObjectMethod',
          'ObjectProperty',
          'ClassProperty',
          'TSPropertySignature',
          'TSDeclareMethod',
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
          case 'TSTypeQuery': {
            if (seen.has(node.exprName)) return
            if (node.exprName.type === 'TSImportType') break

            addDependency(TSEntityNameToRuntime(node.exprName))

            break
          }
          case 'TSImportType': {
            seen.add(node)
            const { source, qualifier } = node

            const dep = await importNamespace(
              context,
              importer,
              node,
              qualifier,
              source,
              namespaceStmts,
              identifierMap,
              preserveImportTypeCache,
            )
            if (dep) addDependency(dep)
            break
          }
        }
      }

      if (parent && !deps.has(node as any) && isChildSymbol(node, parent)) {
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

async function importNamespace(
  context: TransformPluginContext,
  importer: string,
  node: t.TSImportType,
  imported: t.TSEntityName | null | undefined,
  source: t.StringLiteral,
  namespaceStmts: NamespaceMap,
  identifierMap: Record<string, number>,
  preserveCache: Map<string, boolean>,
): Promise<Dep | undefined> {
  let preserve = preserveCache.get(source.value)
  if (preserve === undefined) {
    const resolved = await context.resolve(source.value, importer)
    preserve = !resolved || !!resolved.external
    preserveCache.set(source.value, preserve)
  }

  if (preserve) return

  const sourceText = source.value.replaceAll(/\W/g, '_')
  // Use original source if it's already a valid identifier,
  // otherwise use formatted text with index.
  const localName = `_$${
    isIdentifierName(source.value)
      ? source.value
      : `${sourceText}${getIdentifierIndex(identifierMap, sourceText)}`
  }`
  let local: t.Identifier | t.TSQualifiedName = {
    type: 'Identifier',
    name: localName,
  }

  if (namespaceStmts.has(source.value)) {
    local = namespaceStmts.get(source.value)!.local
  } else {
    // prepend: import * as ${local} from ${source}
    namespaceStmts.set(source.value, {
      stmt: {
        type: 'ImportDeclaration',
        specifiers: [{ type: 'ImportNamespaceSpecifier', local }],
        source,
        attributes: null,
      },
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
    overwriteNode(importedLeft, {
      type: 'TSQualifiedName',
      left: local,
      right: { ...importedLeft },
    })
    local = imported
  }

  let replacement: t.Node = node
  if (node.typeArguments) {
    overwriteNode(node, {
      type: 'TSTypeReference',
      typeName: local,
      typeArguments: node.typeArguments,
    })
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
    isTypeOf(parent, ['TSPropertySignature', 'TSMethodSignature']) &&
    parent.key === node
  )
    return true

  return false
}

function collectInferredNames(node: t.Node) {
  const inferred: string[] = []
  walkAST(node, {
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

function isCjsDtsInputSyntax(node: t.Statement): boolean {
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
    t.VariableDeclarator & { init: RuntimeBindingArrayExpression },
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
    node.declarations.length > 0 &&
    node.declarations[0].type === 'VariableDeclarator' &&
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
    declarationId?.type === 'NumericLiteral' &&
    deps?.type === 'ArrowFunctionExpression' &&
    children?.type === 'ArrayExpression' &&
    (!effect || effect.type === 'CallExpression')
  )
}

function runtimeBindingArrayExpression(
  elements: RuntimeBindingArrayElements,
): RuntimeBindingArrayExpression {
  return {
    type: 'ArrayExpression',
    elements,
  }
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
    isIdentifierOf(node, 'this') ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && isThisExpression(node.object))
  )
}

function isInfer(node: t.Node): node is t.Identifier {
  return isIdentifierOf(node, 'infer')
}

function TSEntityNameToRuntime(
  node: t.TSEntityName,
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

function getIdFromTSEntityName(node: t.TSEntityName) {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }
  return getIdFromTSEntityName(node.left)
}

function isReferenceId(
  node?: t.Node | null,
): node is t.Identifier | t.MemberExpression {
  return isTypeOf(node, ['Identifier', 'MemberExpression'])
}

function isHelperImport(node: t.Node) {
  return (
    node.type === 'ImportDeclaration' &&
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
  node: t.Statement,
  exportInfo: ChunkExportInfo,
  cjsDefault: boolean,
): t.Statement | false | undefined {
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
    isTypeOf(node, [
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
        const name = resolveString(spec.exported)
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
      resolveString(node.specifiers[0].exported) === 'default'
    ) {
      const defaultExport = node.specifiers[0] as t.ExportSpecifier
      return {
        type: 'TSExportAssignment',
        expression: defaultExport.local,
      }
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
function patchTsNamespace(nodes: t.Statement[]) {
  const removed = new Set<t.Node>()

  for (const [i, node] of nodes.entries()) {
    const result = getExportAllNamespace(node)
    if (!result) continue

    const [binding, exports] = result
    if (!exports.properties.length) continue

    nodes[i] = {
      type: 'TSModuleDeclaration',
      id: binding,
      kind: 'namespace',
      declare: true,
      body: {
        type: 'TSModuleBlock',
        body: [
          {
            type: 'ExportNamedDeclaration',
            specifiers: (exports as t.ObjectExpression).properties
              .filter((property) => property.type === 'ObjectProperty')
              .map((property) => {
                const local = (property.value as t.ArrowFunctionExpression)
                  .body as t.Identifier
                const exported = property.key as t.Identifier
                return { type: 'ExportSpecifier', local, exported }
              }),
            source: null,
            declaration: null,
          },
        ],
      },
    }
  }

  return nodes.filter((node) => !removed.has(node))
}

function getExportAllNamespace(
  node: t.Statement,
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
function patchReExport(nodes: t.Statement[]) {
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
      isIdentifierOf(node.expression.callee, '__reExport')
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

      nodes[i] = {
        type: 'TSTypeAliasDeclaration',
        id: {
          type: 'Identifier',
          name: (node.declarations[0].id as t.Identifier).name,
        },
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: {
            type: 'TSQualifiedName',
            left: {
              type: 'Identifier',
              name: exportsNames.get(node.declarations[0].init.object.name)!,
            },
            right: {
              type: 'Identifier',
              name: (node.declarations[0].init.property as t.Identifier).name,
            },
          },
        },
      }
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
  set: (node: t.Statement) => void,
): node is
  | t.ImportDeclaration
  | t.ExportAllDeclaration
  | t.TSImportEqualsDeclaration {
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
  } else if (node.type === 'TSImportEqualsDeclaration') {
    if (node.moduleReference.type === 'TSExternalModuleReference') {
      set({
        type: 'ImportDeclaration',
        specifiers: [
          {
            type: 'ImportDefaultSpecifier',
            local: node.id,
          },
        ],
        source: node.moduleReference.expression,
      })
    }
    return true
  } else if (
    node.type === 'TSExportAssignment' &&
    node.expression.type === 'Identifier'
  ) {
    set({
      type: 'ExportNamedDeclaration',
      specifiers: [
        {
          type: 'ExportSpecifier',
          local: node.expression,
          exported: {
            type: 'Identifier',
            name: 'default',
          },
        },
      ],
    })
    return true
  } else if (
    node.type === 'ExportDefaultDeclaration' &&
    node.declaration.type === 'Identifier'
  ) {
    set({
      type: 'ExportNamedDeclaration',
      specifiers: [
        {
          type: 'ExportSpecifier',
          local: node.declaration,
          exported: { type: 'Identifier', name: 'default' },
        },
      ],
    })
    return true
  }

  return false
}

function overwriteNode<T>(node: t.Node, newNode: T): T {
  // clear object keys
  for (const key of Object.keys(node)) {
    delete (node as any)[key]
  }
  Object.assign(node, newNode)
  return node as T
}

function inheritNodeComments<T extends t.Node>(oldNode: t.Node, newNode: T): T {
  newNode.leadingComments ||= []

  const leadingComments = oldNode.leadingComments?.filter((comment) =>
    comment.value.startsWith('#'),
  )
  if (leadingComments) {
    newNode.leadingComments.unshift(...leadingComments)
  }

  newNode.leadingComments = collectReferenceDirectives(
    newNode.leadingComments,
    true,
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
