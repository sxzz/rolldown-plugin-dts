import { generate } from '@babel/generator'
import { isIdentifierName } from '@babel/helper-validator-identifier'
import { parse, type ParseResult } from '@babel/parser'
import {
  isDeclarationType,
  isIdentifierOf,
  isTypeOf,
  resolveString,
  walkAST,
} from 'ast-kit'
import {
  filename_dts_to,
  filename_js_to_dts,
  RE_DTS,
  RE_DTS_MAP,
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
 * A collection of type parameters grouped by parameter name.
 */
type TypeParams = Array<{
  /**
   * The type parameter name shared by all entries in this group.
   */
  name: string

  /**
   * The {@linkcode t.Identifier | Identifier} nodes extracted from the
   * {@linkcode t.TSTypeParameterDeclaration | TSTypeParameterDeclaration}
   * params for this type parameter name, collected so each one can be renamed
   * in lock-step.
   */
  typeParams: t.Identifier[]
}>

/**
 * Stores everything the plugin needs to reconstruct a TypeScript declaration
 * after Rolldown renames its bindings during the fake-JS bundling phase.
 */
interface DeclarationInfo {
  /**
   * The original TypeScript declaration node.
   */
  decl: t.Declaration

  /**
   * The identifier nodes that name this declaration (may be multiple for
   * `var a, b`).
   */
  bindings: t.Identifier[]

  /**
   * Type parameter groups collected from the declaration, used to propagate
   * renames.
   */
  params: TypeParams

  /**
   * Runtime expressions that represent type-level dependencies of this
   * declaration.
   */
  deps: Dep[]

  /**
   * Child identifier nodes whose source positions are tracked for source-map
   * accuracy.
   */
  children: t.Node[]
}

/**
 * Maps a module source string (e.g. `'./foo'`) to the namespace import
 * statement and its local identifier, used when rewriting `import()`-style
 * `type` references.
 */
type NamespaceMap = Map<
  string,
  {
    /**
     * The `import * as X from './bar'` statement prepended to the module.
     */
    stmt: t.Statement

    /**
     * The local namespace identifier (or qualified name) introduced by the
     * import.
     */
    local: t.Identifier | t.TSQualifiedName
  }
>

/**
 * Creates the Rolldown {@linkcode Plugin | plugin} responsible for
 * transforming `.d.ts` declaration files into valid JavaScript so Rolldown can
 * bundle them, then reconstructing the original TypeScript declarations in the
 * {@linkcode Plugin.renderChunk | renderChunk} phase.
 *
 * @param resolvedOptions - Resolved plugin options controlling source-map generation, CommonJS `default` export rewriting, and side-effects marking.
 * @returns A Rolldown {@linkcode Plugin | plugin} that registers {@linkcode Plugin.transform | transform} and {@linkcode Plugin.renderChunk | renderChunk} hooks for `.d.ts` files.
 */
export function createFakeJsPlugin(
  resolvedOptions: Pick<
    OptionsResolved,
    'sourcemap' | 'cjsDefault' | 'sideEffects'
  >,
): Plugin {
  const { sourcemap, cjsDefault, sideEffects } = resolvedOptions

  let declarationIdx = 0
  const declarationMap = new Map<number /* declaration id */, DeclarationInfo>()
  const commentsMap = new Map<string /* filename */, t.Comment[]>()
  const typeOnlyMap = new Map<string /* filename */, string[]>()

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

  function transform(
    this: TransformPluginContext,
    code: string,
    id: string,
  ): TransformResult {
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
    const typeOnlyIds: string[] = []
    const identifierMap: Record<string, number> = Object.create(null)

    if (comments) {
      const directives = collectReferenceDirectives(comments)
      commentsMap.set(id, directives)
    }

    const appendStmts: t.Statement[] = []
    const namespaceStmts: NamespaceMap = new Map()

    for (const [i, stmt] of program.body.entries()) {
      const setStmt = (stmt: t.Statement) => (program.body[i] = stmt)
      if (rewriteImportExport(stmt, setStmt, typeOnlyIds)) continue

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
      const deps = collectDependencies(
        decl,
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
      const runtimeAssignment: RuntimeBindingVariableDeclaration = {
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

    typeOnlyMap.set(id, typeOnlyIds)

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

    const typeOnlyIds: string[] = []
    for (const module of chunk.moduleIds) {
      const ids = typeOnlyMap.get(module)
      if (ids) typeOnlyIds.push(...ids)
    }

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

        const newNode = patchImportExport(node, typeOnlyIds, cjsDefault)
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

  /**
   * Returns (and bumps) the usage count for {@linkcode name} in
   * {@linkcode identifierMap}, returning `0` on the first use.
   *
   * @param identifierMap - Mutable map from identifier base name to usage count.
   * @param name - The identifier base name to look up.
   * @returns The zero-based index for this name.
   */
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function getIdentifierIndex(
    identifierMap: Record<string, number>,
    name: string,
  ): number {
    if (name in identifierMap) {
      return ++identifierMap[name]
    }
    return (identifierMap[name] = 0)
  }

  /**
   * Stores a {@linkcode DeclarationInfo} in the plugin's
   * {@linkcode declarationMap} and returns its unique numeric ID.
   *
   * @param info - The declaration metadata to store.
   * @returns The unique numeric ID assigned to this declaration.
   */
  function registerDeclaration(info: DeclarationInfo) {
    const declarationId = declarationIdx++
    declarationMap.set(declarationId, info)
    return declarationId
  }

  /**
   * Retrieves the {@linkcode DeclarationInfo} for the given
   * {@linkcode declarationId}.
   *
   * @param declarationId - The numeric ID previously returned by {@linkcode registerDeclaration | registerDeclaration()}.
   * @returns The stored {@linkcode DeclarationInfo}.
   */
  function getDeclaration(declarationId: number) {
    return declarationMap.get(declarationId)!
  }

  /**
   * Collects all {@linkcode t.TSTypeParameter | TSTypeParameter} nodes from
   * the given node and groups them by their name. One name can associate with
   * one or more type parameters. These names will be used as the parameter
   * name in the generated JavaScript dependency function.
   *
   * @param node - The AST node to walk when collecting type parameters.
   * @returns An array of {@linkcode TypeParams | name/typeParams pairs}, one entry per unique type parameter name found in the {@linkcode node}.
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

  /**
   * Walks {@linkcode node} and collects all runtime dependency expressions
   * needed to preserve type-level references after Rolldown renames bindings.
   *
   * @param node - The TypeScript declaration AST node to analyze.
   * @param namespaceStmts - Accumulator map for `import * as` statements added for `import()` type references.
   * @param children - Set populated with child identifier nodes whose source positions need to be tracked.
   * @param identifierMap - Counter map used to generate unique identifiers for namespace imports.
   * @returns An array of {@linkcode Dep | runtime dependency expressions}.
   */
  function collectDependencies(
    node: t.Node,
    namespaceStmts: NamespaceMap,
    children: Set<t.Node>,
    identifierMap: Record<string, number>,
  ): Dep[] {
    const deps = new Set<Dep>()
    const seen = new Set<t.Node>()

    const inferredStack: string[][] = []
    let currentInferred = new Set<string>()
    function isInferred(node: t.Node): boolean {
      return node.type === 'Identifier' && currentInferred.has(node.name)
    }

    walkAST(node, {
      enter(node) {
        if (node.type === 'TSConditionalType') {
          const inferred = collectInferredNames(node.extendsType)
          inferredStack.push(inferred)
        }
      },
      leave(node, parent) {
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
        } else
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
              const dep = importNamespace(
                node,
                qualifier,
                source,
                namespaceStmts,
                identifierMap,
              )
              addDependency(dep)
              break
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

  /**
   * Generates a namespace import for a
   * {@linkcode t.TSImportType | TSImportType} node and rewrites the node in
   * place to a qualified name (`_$module.Qualifier`).
   *
   * @param node - The {@linkcode t.TSImportType | TSImportType} AST node to rewrite.
   * @param imported - Optional qualifier path inside the imported namespace.
   * @param source - The string-literal source of the import.
   * @param namespaceStmts - Accumulator map that deduplicates namespace imports.
   * @param identifierMap - Counter map for generating unique local identifiers.
   * @returns A {@linkcode Dep | runtime dependency expression} referencing the namespace member.
   * @throws An {@linkcode Error} when the imported qualifier's left-most name is `this`.
   */
  function importNamespace(
    node: t.TSImportType,
    imported: t.TSEntityName | null | undefined,
    source: t.StringLiteral,
    namespaceStmts: NamespaceMap,
    identifierMap: Record<string, number>,
  ): Dep {
    const sourceText = source.value.replaceAll(/\W/g, '_')
    // Use original source if it's already a valid identifier, otherwise use formatted text with index
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
}

/**
 * Returns `true` if {@linkcode node} represents a child symbol within
 * {@linkcode parent} i.e. an {@linkcode t.Identifier | Identifier} or a
 * computed key in a
 * {@linkcode t.TSPropertySignature | TSPropertySignature} / {@linkcode t.TSMethodSignature | TSMethodSignature}
 * whose source position should be tracked for source-map accuracy.
 *
 * @param node - The AST node to test.
 * @param parent - The parent AST node of {@linkcode node}.
 * @returns `true` if {@linkcode node} is a trackable child symbol.
 */
function isChildSymbol(node: t.Node, parent: t.Node) {
  if (node.type === 'Identifier') return true
  if (
    isTypeOf(parent, ['TSPropertySignature', 'TSMethodSignature']) &&
    parent.key === node
  )
    return true

  return false
}

/**
 * Collects all type-parameter names introduced by `infer` clauses inside a
 * conditional type's {@linkcode t.TSConditionalType.extendsType | extendsType}
 * branch, so they can be excluded from dependency tracking.
 *
 * @param node - The AST node to walk (typically a {@linkcode t.TSConditionalType | TSConditionalType}'s {@linkcode t.TSConditionalType.extendsType | extendsType}).
 * @returns An array of inferred type-parameter names.
 */
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

/**
 * Filters the {@linkcode comments} array to those that are
 * `/// <reference path=...>` or `/// <reference types=...>` directives,
 * optionally inverting the filter.
 *
 * @param comments - The array of {@linkcode t.Comment | Comment} nodes to filter.
 * @param [negative] - When `true`, returns comments that do NOT match the {@linkcode REFERENCE_RE | reference pattern} instead. Defaults to `false`.
 * @returns The filtered array of reference-directive {@linkcode t.Comment | Comment} nodes.
 */
function collectReferenceDirectives(comments: t.Comment[], negative = false) {
  return comments.filter((c) => REFERENCE_RE.test(c.value) !== negative)
}

//#region Runtime binding variable

/**
 * A variable declaration that declares a runtime binding variable. It
 * represents a declaration like:
 *
 * ```js
 * var binding = [
 *   declarationId,
 *   (param, ...) => [dep, ...],
 *   ['children symbol name'],
 *   sideEffect(),
 * ];
 * ```
 *
 * For a more concrete example, the following TypeScript declaration:
 *
 * ```ts
 * interface Bar extends Foo {
 *   bar: number;
 * }
 * ```
 *
 * Will be transformed to the following JavaScript code:
 *
 * ```js
 * const Bar = [123, () => [Foo], []];
 * ```
 *
 * Which will be represented by this type.
 */
type RuntimeBindingVariableDeclaration = t.VariableDeclaration & {
  declarations: [
    t.VariableDeclarator & { init: RuntimeBindingArrayExpression },
    ...t.VariableDeclarator[],
  ]
}

/**
 * Check if the given {@linkcode node} is a
 * {@linkcode RuntimeBindingVariableDeclaration}.
 *
 * @param node - The AST node to test.
 * @returns `true` if {@linkcode node} is a {@linkcode RuntimeBindingVariableDeclaration}.
 */
function isRuntimeBindingVariableDeclaration(
  node: t.Node | null | undefined,
): node is RuntimeBindingVariableDeclaration {
  return (
    node?.type === 'VariableDeclaration' &&
    node.declarations.length > 0 &&
    node.declarations[0].type === 'VariableDeclarator' &&
    isRuntimeBindingArrayExpression(node.declarations[0].init)
  )
}

/**
 * An array expression that contains {@linkcode RuntimeBindingArrayElements}.
 *
 * It can be used to represent the following JavaScript code:
 *
 * ```js
 * [declarationId, (param, ...) => [dep, ...], ['children'], sideEffect()];
 * ```
 */
type RuntimeBindingArrayExpression = t.ArrayExpression & {
  elements: RuntimeBindingArrayElements
}

/**
 * Check if the given {@linkcode node} is a
 * {@linkcode RuntimeBindingArrayExpression}.
 *
 * @param node - The AST node to test.
 * @returns `true` if {@linkcode node} is a {@linkcode RuntimeBindingArrayExpression}.
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
 * Check if the given array is a {@linkcode RuntimeBindingArrayElements}.
 *
 * @param elements - The array of AST nodes to test.
 * @returns `true` if {@linkcode elements} matches the shape of {@linkcode RuntimeBindingArrayElements}.
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

/**
 * Wraps {@linkcode elements} in a {@linkcode RuntimeBindingArrayExpression}
 * object.
 *
 * @param elements - The tuple elements for the runtime binding array.
 * @returns A new {@linkcode RuntimeBindingArrayExpression} node.
 */
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
 * An array that represents the elements in
 * {@linkcode RuntimeBindingArrayExpression}
 */
type RuntimeBindingArrayElements =
  | RuntimeBindingArrayElementsBase
  | [...RuntimeBindingArrayElementsBase, effect: t.CallExpression]

// #endregion

/**
 * Returns `true` if {@linkcode node} represents a
 * {@linkcode t.ThisExpression | ThisExpression}
 * (including `this.member` chains).
 *
 * @param node - The AST node to test.
 * @returns `true` if {@linkcode node} is or contains a `this` reference.
 */
function isThisExpression(node: t.Node): boolean {
  return (
    isIdentifierOf(node, 'this') ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && isThisExpression(node.object))
  )
}

/**
 * Returns `true` if {@linkcode node} is an
 * {@linkcode t.Identifier | Identifier} named `infer`.
 *
 * @param node - The AST node to test.
 * @returns `true` if {@linkcode node} is an {@linkcode t.Identifier | Identifier} named `infer`.
 */
function isInfer(node: t.Node): node is t.Identifier {
  return isIdentifierOf(node, 'infer')
}
/**
 * Converts a TypeScript qualified name (`A.B.C`) to an equivalent JavaScript
 * member expression (`A.B.C`) by mutating the node in place.
 *
 * @param node - The {@linkcode t.TSEntityName | TSEntityName} AST node to convert.
 * @returns The rewritten node as a {@linkcode t.MemberExpression | MemberExpression}, {@linkcode t.Identifier | Identifier}, or {@linkcode t.ThisExpression | ThisExpression}.
 */
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

/**
 * Walks a qualified name left-recursively and returns its leftmost
 * {@linkcode t.Identifier | Identifier} or
 * {@linkcode t.ThisExpression | ThisExpression} node.
 *
 * @param node - The {@linkcode t.TSEntityName | TSEntityName} to unwrap.
 * @returns The leftmost {@linkcode t.Identifier | Identifier} or {@linkcode t.ThisExpression | ThisExpression} node.
 */
function getIdFromTSEntityName(node: t.TSEntityName) {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }
  return getIdFromTSEntityName(node.left)
}

/**
 * Returns `true` if {@linkcode node} is an
 * {@linkcode t.Identifier | Identifier} or
 * {@linkcode t.MemberExpression | MemberExpression}, i.e. a node that can
 * appear as a runtime reference to a `type`.
 *
 * @param [node] - The AST node to test.
 * @returns `true` if {@linkcode node} is a referenceable {@linkcode t.Identifier | Identifier} or {@linkcode t.MemberExpression | MemberExpression}.
 */
function isReferenceId(
  node?: t.Node | null,
): node is t.Identifier | t.MemberExpression {
  return isTypeOf(node, ['Identifier', 'MemberExpression'])
}

/**
 * Returns `true` if {@linkcode node} is an import declaration that imports
 * only Rolldown's internal helpers (`__exportAll`, `__reExport`), which must
 * be stripped from the final `.d.ts` output.
 *
 * @param node - The AST node to test.
 * @returns `true` if {@linkcode node} is a Rolldown-helper-only import declaration.
 */
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
 * Rewrites `import`/`export` sources by replacing `.d.ts` extensions with
 * `.js` and applies `export =` rewriting for CommonJS `default` exports when
 * {@linkcode cjsDefault} is enabled.
 *
 * @param node - The AST statement node to inspect and possibly rewrite.
 * @param typeOnlyIds - Exported names that should be marked `type`-only in the output.
 * @param cjsDefault - Whether to rewrite a `export { x as default }` into `export = x` for CommonJS compatibility.
 * @returns The (possibly mutated) {@linkcode t.Statement | Statement}, `false` to signal the `node` should be removed, or `undefined` if no rewrite applies.
 */
function patchImportExport(
  node: t.Statement,
  typeOnlyIds: string[],
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
    if (node.type === 'ExportNamedDeclaration' && typeOnlyIds.length) {
      for (const spec of node.specifiers) {
        const name = resolveString(spec.exported)
        if (typeOnlyIds.includes(name)) {
          if (spec.type === 'ExportSpecifier') {
            spec.exportKind = 'type'
          } else {
            node.exportKind = 'type'
          }
        }
      }
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
      const defaultExport = node.specifiers[0]
      return {
        type: 'TSExportAssignment',
        expression: defaultExport.local,
      }
    }
  }
}

/**
 * Rewrites `__exportAll` helper calls emitted by Rolldown into proper
 * `declare namespace` blocks so the output remains valid TypeScript
 * declaration syntax.
 *
 * @param nodes - The list of top-level AST statements to scan and rewrite in-place.
 * @returns The filtered statement list with `__exportAll` calls replaced by `declare namespace` declarations.
 */
function patchTsNamespace(nodes: t.Statement[]) {
  const removed = new Set<t.Node>()

  for (const [i, node] of nodes.entries()) {
    const result = handleExport(node)
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

  function handleExport(
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
}

/**
 * Rewrites `__reExport` helper calls emitted by Rolldown into `type` alias
 * declarations, preserving cross-module `type` re-exports in the bundled
 * declaration output.
 *
 * @param nodes - The list of top-level AST statements to scan and rewrite in-place.
 * @returns The (mutated) statement list with `__reExport` patterns replaced by {@linkcode t.TSTypeAliasDeclaration | TSTypeAliasDeclaration} nodes.
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

/**
 * Rewrites `type`-only imports/exports and special-case syntax (`export =`,
 * `export default Identifier`, `import Foo = require('./bar')`) to their
 * runtime equivalents so Rolldown can process them as JavaScript. Handles:
 * - `import type { X } from './bar'` -> `import { X } from './bar'`
 * - `import { type X } from './bar'` -> `import { X } from './bar'`
 * - `export type { X }` -> `export { X }`
 * - `export { type X }` -> `export { X }`
 * - `export type * as X from './bar'` -> `export * as X from './bar'`
 * - `import Foo = require('./bar')` -> `import Foo from './bar'`
 * - `export = Foo` -> `export { Foo as default }`
 * - `export default X` -> `export { X as default }`
 *
 * @param node - The AST node to inspect.
 * @param set - Callback that replaces {@linkcode node} in its parent's body array.
 * @param typeOnlyIds - Accumulator for exported names that should be re-marked as `type`-only in the rendered output.
 * @returns `true` if the {@linkcode node} was an `import`/`export` statement that was handled (and should be skipped by the caller), `false` otherwise.
 */
function rewriteImportExport(
  node: t.Node,
  set: (node: t.Statement) => void,
  typeOnlyIds: string[],
): node is
  | t.ImportDeclaration
  | t.ExportAllDeclaration
  | t.TSImportEqualsDeclaration {
  if (
    node.type === 'ImportDeclaration' ||
    (node.type === 'ExportNamedDeclaration' && !node.declaration)
  ) {
    for (const specifier of node.specifiers) {
      if (
        ('exportKind' in specifier && specifier.exportKind === 'type') ||
        ('exportKind' in node && node.exportKind === 'type')
      ) {
        typeOnlyIds.push(
          resolveString(
            (
              specifier as
                | t.ExportSpecifier
                | t.ExportDefaultSpecifier
                | t.ExportNamespaceSpecifier
            ).exported,
          ),
        )
      }

      // rewrite `import { type X } from './bar'` to `import { X } from './bar'`
      if (specifier.type === 'ImportSpecifier') {
        specifier.importKind = 'value'

        // `export { type X }` to `export { X }`
      } else if (specifier.type === 'ExportSpecifier') {
        specifier.exportKind = 'value'
      }
    }

    // rewrite `import type * as X from './bar'` to `import * as X from './bar'`
    if (node.type === 'ImportDeclaration') {
      node.importKind = 'value'

      // rewrite `export type { X }` to `export { X }`
    } else if (node.type === 'ExportNamedDeclaration') {
      node.exportKind = 'value'
    }

    return true

    // rewrite `export type * as X from './bar'` to `export * as X from './bar'`
  } else if (node.type === 'ExportAllDeclaration') {
    node.exportKind = 'value'
    return true

    // `import Foo = require('./bar')` to `import Foo from './bar'`
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

    // `export = Foo` to `export { Foo as default }`
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

    // `export default Foo` to `export { Foo as default }`
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

/**
 * Clears all own properties of {@linkcode node} and assigns
 * {@linkcode newNode}'s properties onto it, effectively mutating the original
 * AST node in place. This preserves any object references that point to
 * {@linkcode node} while changing its content.
 *
 * @template T - The shape of the new node.
 *
 * @param node - The AST node to overwrite.
 * @param newNode - The replacement data to assign.
 * @returns The mutated {@linkcode node} cast to {@linkcode T}.
 */
function overwriteNode<T>(node: t.Node, newNode: T): T {
  // clear object keys
  for (const key of Object.keys(node)) {
    delete (node as any)[key]
  }
  Object.assign(node, newNode)
  return node as T
}

/**
 * Copies leading comments from {@linkcode oldNode} to {@linkcode newNode},
 * keeping only non-reference-directive leading comments and filtering out
 * reference directives from the result.
 *
 * @template T - The shape of the new node.
 *
 * @param oldNode - The original node to copy comments from.
 * @param newNode - The target node to attach comments to.
 * @returns The {@linkcode newNode} with the inherited leading comments applied.
 */
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
