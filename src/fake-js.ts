import { generate } from '@babel/generator'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
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
  RE_NODE_MODULES,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
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
  const identifierMap: Record<string, number> = Object.create(null)
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
    const file = parse(code, {
      plugins: [['typescript', { dts: true }]],
      sourceType: 'module',
      errorRecovery: true,
      createParenthesizedExpressions: true,
    })
    const { program, comments } = file
    const typeOnlyIds: string[] = []

    if (comments) {
      const directives = collectReferenceDirectives(comments)
      commentsMap.set(id, directives)
    }

    const appendStmts: t.Statement[] = []
    const namespaceStmts: NamespaceMap = new Map()

    // First pass: collect namespace members and identify export = X patterns
    // Also collect top-level imports to distinguish declared vs re-exported types
    // And detect if file has explicit export statements (for .d.ts ambient module handling)
    const namespaceMembersMap = new Map<
      string,
      { declared: string[]; reexported: string[] }
    >()
    let exportAssignmentName: string | null = null
    const importedIdentifiers = new Set<string>()
    // Per TypeScript spec (microsoft/TypeScript#57764), in .d.ts files ALL top-level
    // declarations are considered exported UNLESS there's an `export { }` or explicit
    // export statement. We track this to know whether to auto-export non-exported types.
    let hasExplicitExportStatement = false

    for (const stmt of program.body) {
      // Check for explicit export statements (export { }, export type { X }, etc.)
      // This determines if the file opts out of ambient .d.ts "everything is exported" behavior
      if (
        stmt.type === 'ExportNamedDeclaration' &&
        !stmt.declaration &&
        stmt.specifiers.length === 0
      ) {
        // Empty export: export { }
        hasExplicitExportStatement = true
      }
      // Collect imported identifiers
      if (stmt.type === 'ImportDeclaration') {
        for (const spec of stmt.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            spec.local.type === 'Identifier'
          ) {
            importedIdentifiers.add(spec.local.name)
          } else if (
            spec.type === 'ImportDefaultSpecifier' &&
            spec.local.type === 'Identifier'
          ) {
            importedIdentifiers.add(spec.local.name)
          } else if (
            spec.type === 'ImportNamespaceSpecifier' &&
            spec.local.type === 'Identifier'
          ) {
            importedIdentifiers.add(spec.local.name)
          }
        }
      }

      if (
        stmt.type === 'TSModuleDeclaration' &&
        stmt.id.type === 'Identifier'
      ) {
        const members = extractNamespaceMembers(stmt, importedIdentifiers)
        if (members.declared.length > 0 || members.reexported.length > 0) {
          namespaceMembersMap.set(stmt.id.name, members)
        }
      }
      // Check for export = X pattern
      if (
        stmt.type === 'TSExportAssignment' &&
        stmt.expression.type === 'Identifier'
      ) {
        exportAssignmentName = stmt.expression.name
      }
    }

    // If we have export = X where X is a namespace, create exports for each member
    // - For declared members: create `export type X = namespace.X`
    // - For re-exported members: create `export { X }` to re-export the import
    if (exportAssignmentName && namespaceMembersMap.has(exportAssignmentName)) {
      const { declared, reexported } =
        namespaceMembersMap.get(exportAssignmentName)!
      // Reserved keywords that cannot be used as identifiers in export declarations
      const reservedKeywords = new Set([
        'default',
        'class',
        'function',
        'var',
        'let',
        'const',
        'if',
        'else',
        'for',
        'while',
        'do',
        'switch',
        'case',
        'break',
        'continue',
        'return',
        'throw',
        'try',
        'catch',
        'finally',
        'new',
        'delete',
        'typeof',
        'void',
        'in',
        'instanceof',
        'this',
        'super',
        'import',
        'export',
        'extends',
        'implements',
        'static',
        'public',
        'private',
        'protected',
        'yield',
        'await',
        'enum',
        'interface',
        'package',
        'with',
        'debugger',
      ])

      // Handle declared members: create type aliases
      for (const memberName of declared) {
        // Skip reserved keywords - they cannot be used as identifiers
        if (reservedKeywords.has(memberName)) continue
        // Create: export type MemberName = NamespaceName.MemberName
        const typeAlias: t.TSTypeAliasDeclaration = {
          type: 'TSTypeAliasDeclaration',
          id: t.identifier(memberName),
          typeAnnotation: t.tsTypeReference(
            t.tsQualifiedName(
              t.identifier(exportAssignmentName),
              t.identifier(memberName),
            ),
          ),
          declare: true,
        }
        const exportedTypeAlias: t.ExportNamedDeclaration = {
          type: 'ExportNamedDeclaration',
          declaration: typeAlias,
          specifiers: [],
          source: null,
        }
        program.body.push(exportedTypeAlias)
      }

      // Handle re-exported members: create re-exports
      // These are types imported from other files and re-exported via `export type { X }`
      const reexportSpecifiers: t.ExportSpecifier[] = []
      for (const memberName of reexported) {
        if (reservedKeywords.has(memberName)) continue
        reexportSpecifiers.push({
          type: 'ExportSpecifier',
          local: t.identifier(memberName),
          exported: t.identifier(memberName),
        })
      }
      if (reexportSpecifiers.length > 0) {
        const reexportDecl: t.ExportNamedDeclaration = {
          type: 'ExportNamedDeclaration',
          declaration: null,
          specifiers: reexportSpecifiers,
          source: null,
        }
        program.body.push(reexportDecl)
      }
    }

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
        ? (decl: t.Declaration) => (stmt.declaration = decl)
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
          ? t.identifier(`_${getIdentifierIndex('')}`)
          : binding

        if (binding.type !== 'Identifier') {
          throw new Error(`Unexpected ${binding.type} declaration id`)
        }

        bindings.push(binding)
      } else {
        const binding = t.identifier('export_default')
        bindings.push(binding)
        // @ts-expect-error
        decl.id = binding
      }

      const params: TypeParams = collectParams(decl)

      const childrenSet = new Set<t.Node>()
      const deps = collectDependencies(decl, namespaceStmts, childrenSet)
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

      const declarationIdNode = t.numericLiteral(declarationId)
      const depsNode = t.arrowFunctionExpression(
        params.map(({ name }) => t.identifier(name)),
        t.arrayExpression(deps),
      )
      const childrenNode = t.arrayExpression(
        children.map((node) => ({
          type: 'StringLiteral',
          value: '',
          start: node.start,
          end: node.end,
          loc: node.loc,
        })),
      )
      const sideEffectNode =
        sideEffect &&
        t.callExpression(t.identifier('sideEffect'), [bindings[0]])
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
        appendStmts.push(
          t.exportNamedDeclaration(null, [
            t.exportSpecifier(bindings[0], t.identifier('default')),
          ]),
        )
        // replace the whole statement
        setStmt(runtimeAssignment)
      } else if (isExportDecl) {
        // replace declaration, keep `export`
        setDecl(runtimeAssignment)
      } else if (RE_NODE_MODULES.test(id) && !hasExplicitExportStatement) {
        // Per TypeScript spec (microsoft/TypeScript#57764), in .d.ts files ALL
        // top-level declarations are considered exported UNLESS there's an
        // `export { }` statement (which tsc auto-inserts).
        // Without `export { }`, non-exported types can be imported from other files.
        // We need to export them for rolldown to resolve cross-file imports.
        // Tree-shaking will remove unused types from the final output.
        // We only do this for node_modules AND when no `export { }` exists.
        setStmt(runtimeAssignment)
        appendStmts.push(
          t.exportNamedDeclaration(null, [
            t.exportSpecifier(bindings[0], bindings[0]),
          ]),
        )
      } else {
        // Non-exported declaration - keep as-is (no export)
        // This applies when:
        // - User's own code (not in node_modules)
        // - Or .d.ts file has `export { }` (opts out of ambient behavior)
        setStmt(runtimeAssignment)
      }
    }

    if (sideEffects) {
      // module side effect marker
      appendStmts.push(
        t.expressionStatement(t.callExpression(t.identifier('sideEffect'), [])),
      )
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

    const file = parse(code, {
      sourceType: 'module',
    })
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
              ...t.identifier('undefined'),
              loc: transformedDep.loc,
              start: transformedDep.start,
              end: transformedDep.end,
            }
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

  function getIdentifierIndex(name: string) {
    if (name in identifierMap) {
      return identifierMap[name]++
    }
    return (identifierMap[name] = 0)
  }

  function registerDeclaration(info: DeclarationInfo) {
    const declarationId = declarationIdx++
    declarationMap.set(declarationId, info)
    return declarationId
  }

  function getDeclaration(declarationId: number) {
    return declarationMap.get(declarationId)!
  }

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
            ...node.typeParameters.params.map(({ name }) =>
              typeof name === 'string' ? t.identifier(name) : name,
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

  function collectDependencies(
    node: t.Node,
    namespaceStmts: NamespaceMap,
    children: Set<t.Node>,
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

  function importNamespace(
    node: t.TSImportType,
    imported: t.TSEntityName | null | undefined,
    source: t.StringLiteral,
    namespaceStmts: NamespaceMap,
  ): Dep {
    const sourceText = source.value.replaceAll(/\W/g, '_')
    let local: t.Identifier | t.TSQualifiedName = t.identifier(
      `${sourceText}${getIdentifierIndex(sourceText)}`,
    )

    if (namespaceStmts.has(source.value)) {
      local = namespaceStmts.get(source.value)!.local
    } else {
      // prepend: import * as ${local} from ${source}
      namespaceStmts.set(source.value, {
        stmt: t.importDeclaration([t.importNamespaceSpecifier(local)], source),
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
      overwriteNode(importedLeft, t.tsQualifiedName(local, { ...importedLeft }))
      local = imported
    }

    let replacement: t.Node = node
    if (node.typeArguments) {
      overwriteNode(node, t.tsTypeReference(local, node.typeArguments))
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
  return t.arrayExpression(elements) as RuntimeBindingArrayExpression
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

function TSEntityNameToRuntime(
  node: t.TSEntityName,
): t.MemberExpression | t.Identifier | t.ThisExpression {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }

  const left = TSEntityNameToRuntime(node.left)
  return Object.assign(node, t.memberExpression(left, node.right))
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
    node.specifiers.length === 1 &&
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
  node: t.Node,
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
      const defaultExport = node.specifiers[0] as t.ExportSpecifier
      return {
        type: 'TSExportAssignment',
        expression: defaultExport.local,
      }
    }
  }
}

/**
 * Handle `__exportAll` call
 */
function patchTsNamespace(nodes: t.Statement[]) {
  const removed = new Set<t.Node>()

  for (const [i, node] of nodes.entries()) {
    const result = handleExport(node)
    if (!result) continue

    const [binding, exports] = result

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
                return t.exportSpecifier(local, exported)
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

/**
 * Extract exported member names from a namespace declaration.
 * Returns declared members (defined in the namespace) and re-exported members (imported then re-exported).
 */
function extractNamespaceMembers(
  nsDecl: t.TSModuleDeclaration,
  importedIdentifiers: Set<string>,
): { declared: string[]; reexported: string[] } {
  const declared: string[] = []
  const reexported: string[] = []
  const body = nsDecl.body

  if (!body) return { declared, reexported }

  if (body.type === 'TSModuleBlock') {
    for (const stmt of body.body) {
      if (stmt.type === 'ExportNamedDeclaration') {
        if (stmt.declaration) {
          // Handle: export interface X { } / export type X = ...
          const decl = stmt.declaration
          if ('id' in decl && decl.id && decl.id.type === 'Identifier') {
            declared.push(decl.id.name)
          }
        } else if (stmt.specifiers.length > 0) {
          // Handle: export type { X, Y, Z } (re-exports from other files)
          for (const spec of stmt.specifiers) {
            if (
              spec.type === 'ExportSpecifier' &&
              spec.exported.type === 'Identifier'
            ) {
              const exportedName = spec.exported.name
              // Check if this was imported at the top level
              const localName =
                spec.local.type === 'Identifier'
                  ? spec.local.name
                  : exportedName
              if (importedIdentifiers.has(localName)) {
                reexported.push(exportedName)
              } else {
                // It's declared somewhere in the namespace
                declared.push(exportedName)
              }
            }
          }
        }
      }
      if ('id' in stmt && stmt.id && stmt.id.type === 'Identifier') {
        declared.push(stmt.id.name)
      }
      if (stmt.type === 'VariableDeclaration') {
        for (const varDecl of stmt.declarations) {
          if (varDecl.id.type === 'Identifier') {
            declared.push(varDecl.id.name)
          }
        }
      }
    }
  }

  return {
    declared: [...new Set(declared)],
    reexported: [...new Set(reexported)],
  }
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
          exported: t.identifier('default'),
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
