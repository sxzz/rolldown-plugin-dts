import _generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { isDeclarationType, isTypeOf } from 'ast-kit'
import { walk } from 'estree-walker'
import {
  filename_dts_to,
  filename_js_to_dts,
  RE_DTS,
  RE_DTS_MAP,
} from './utils/filename'
import type { OptionsResolved } from '.'
import type { Plugin } from 'rolldown'

// @ts-expect-error interop default
const generate: typeof _generate = (_generate.default as undefined) || _generate

// input:
// export declare function x(xx: X): void

// to:            const x   = [1, () => X  ]
// after compile: const x$1 = [1, () => X$1]

// replace X with X$1
// output:
// export declare function x$1(xx: X$1): void

type Dep = t.Expression & { replace?: (newNode: t.Node) => void }
interface SymbolInfo {
  decl: t.Declaration
  binding: t.Identifier
  deps: Dep[]
}

export function createFakeJsPlugin({
  dtsInput,
  sourcemap,
}: Pick<OptionsResolved, 'dtsInput' | 'sourcemap'>): Plugin {
  let symbolIdx = 0
  let identifierIdx = 0
  const symbolMap = new Map<number /* symbol id */, SymbolInfo>()
  const commentsMap = new Map<string /* filename */, t.Comment[]>()

  function getIdentifierIndex() {
    return identifierIdx++
  }

  function registerSymbol(info: SymbolInfo) {
    const symbolId = symbolIdx++
    symbolMap.set(symbolId, info)
    return symbolId
  }

  function getSymbol(symbolId: number) {
    return symbolMap.get(symbolId)!
  }

  return {
    name: 'rolldown-plugin-dts:fake-js',

    options: dtsInput
      ? (options) => {
          return {
            ...options,
            resolve: {
              extensions: ['.d.ts', '.d.mts', '.d.cts'],
              extensionAlias: {
                '.js': ['.d.ts'],
                '.mjs': ['.d.mts'],
                '.cjs': ['.d.cts'],
              },
              ...options.resolve,
            },
          }
        }
      : undefined,

    outputOptions(options) {
      if (options.format === 'cjs' || options.format === 'commonjs') {
        throw new Error(
          '[rolldown-plugin-dts] Cannot bundle dts files with `cjs` format.',
        )
      }
      return {
        ...options,
        sourcemap: sourcemap ? true : options.sourcemap,
        entryFileNames:
          options.entryFileNames ?? (dtsInput ? '[name].ts' : undefined),
        chunkFileNames(chunk) {
          const original =
            (typeof options.chunkFileNames === 'function'
              ? options.chunkFileNames(chunk)
              : options.chunkFileNames) || '[name]-[hash].js'

          if (!original.includes('.d') && chunk.name.endsWith('.d')) {
            return filename_js_to_dts(original)
          }
          return original
        },
      }
    },

    transform: {
      filter: { id: RE_DTS },
      handler(code, id) {
        const file = parse(code, {
          plugins: [['typescript', { dts: true }]],
          sourceType: 'module',
        })
        const { program, comments } = file

        if (comments) {
          const directives = collectReferenceDirectives(comments)
          commentsMap.set(id, directives)
        }

        const prependStmts: t.Statement[] = []
        const appendStmts: t.Statement[] = []
        const prepend = (stmt: t.Statement) => prependStmts.push(stmt)

        for (const [i, stmt] of program.body.entries()) {
          const setStmt = (node: t.Node) =>
            (program.body[i] = inheritNode(stmt, node) as any)
          if (rewriteImportExport(stmt, setStmt)) continue

          const sideEffect =
            stmt.type === 'TSModuleDeclaration' && stmt.kind !== 'namespace'
          const isDefaultExport = stmt.type === 'ExportDefaultDeclaration'
          const isDecl =
            isTypeOf(stmt, [
              'ExportNamedDeclaration',
              'ExportDefaultDeclaration',
            ]) && stmt.declaration

          const decl: t.Node = isDecl ? stmt.declaration! : stmt
          const setDecl = isDecl
            ? (node: t.Node) =>
                (stmt.declaration = inheritNode(stmt.declaration!, node) as any)
            : setStmt

          if (
            decl.type === 'VariableDeclaration' &&
            decl.declarations.length !== 1
          )
            throw new Error('Only one declaration is supported')

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

          let binding =
            decl.type === 'VariableDeclaration'
              ? (decl.declarations[0].id as t.Identifier)
              : 'id' in decl
                ? decl.id
                : null
          if (!binding) {
            binding = t.identifier('export_default')
            // @ts-expect-error
            decl.id = binding
          }
          binding = sideEffect
            ? t.identifier(`_${identifierIdx++}`)
            : (binding as t.Identifier)

          const deps = collectDependencies(decl, getIdentifierIndex, prepend)

          const elements: t.Expression[] = [
            t.numericLiteral(0),
            ...deps.map((dep) => t.arrowFunctionExpression([], dep)),
            ...(sideEffect
              ? [t.callExpression(t.identifier('sideEffect'), [])]
              : []),
          ]
          const runtime: t.ArrayExpression = t.arrayExpression(elements)

          const symbolId = registerSymbol({ decl, deps, binding })
          elements[0] = t.numericLiteral(symbolId)

          // var ${binding} = [${symbolId}, () => ${dep}, ..., sideEffect()]
          const runtimeAssignment: t.VariableDeclaration = {
            type: 'VariableDeclaration',
            kind: 'var',
            declarations: [
              {
                type: 'VariableDeclarator',
                id: { ...binding, typeAnnotation: null },
                init: runtime,
              },
            ],
          }

          if (isDefaultExport) {
            // export { ${binding} as default }
            appendStmts.push(
              t.exportNamedDeclaration(null, [
                t.exportSpecifier(binding, t.identifier('default')),
              ]),
            )
            // replace the whole statement
            setStmt(runtimeAssignment)
          } else {
            // replace declaration, keep `export`
            setDecl(runtimeAssignment)
          }
        }

        program.body = [...prependStmts, ...program.body, ...appendStmts]

        const result = generate(file, {
          comments: true,
          sourceMaps: sourcemap,
          sourceFileName: id,
        })
        return result
      },
    },

    renderChunk(code, chunk) {
      if (!RE_DTS.test(chunk.fileName)) {
        return
      }

      const file = parse(code, {
        sourceType: 'module',
      })
      const { program } = file

      // recover comments
      if (program.body.length) {
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
          program.body[0].leadingComments.push(...comments)
        }
      }

      program.body = patchTsNamespace(program.body)

      program.body = program.body
        .map((node) => {
          if (patchImportSource(node)) return node

          if (
            node.type !== 'VariableDeclaration' ||
            node.declarations.length !== 1
          )
            return node

          const [decl] = node.declarations
          if (decl.init?.type !== 'ArrayExpression' || !decl.init.elements[0]) {
            return null
          }

          const [symbolIdNode, ...depsFns] = decl.init
            .elements as t.Expression[]
          if (symbolIdNode?.type !== 'NumericLiteral') {
            return null
          }

          const symbolId = symbolIdNode.value
          const original = getSymbol(symbolId)

          const transformedBinding = {
            ...decl.id,
            typeAnnotation: original.binding.typeAnnotation,
          }
          overwriteNode(original.binding, transformedBinding)

          const transformedDeps = depsFns
            .filter((node) => node?.type === 'ArrowFunctionExpression')
            .map((node) => node.body)

          if (original.deps.length) {
            for (let i = 0; i < original.deps.length; i++) {
              const originalDep = original.deps[i]
              if (originalDep.replace) {
                originalDep.replace(transformedDeps[i])
              } else {
                Object.assign(originalDep, transformedDeps[i])
              }
            }
          }

          return inheritNode(node, original.decl)
        })
        .filter((node) => !!node)

      if (program.body.length === 0) {
        return 'export { };'
      }

      const result = generate(file, {
        comments: true,
        sourceMaps: sourcemap,
        sourceFileName: chunk.fileName,
      })

      return result
    },
    generateBundle(options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type !== 'asset' ||
          !RE_DTS_MAP.test(chunk.fileName) ||
          typeof chunk.source !== 'string'
        )
          continue

        const maps = JSON.parse(chunk.source)
        maps.sourcesContent = null
        chunk.source = JSON.stringify(maps)
      }
    },
  }
}

const REFERENCE_RE = /\/\s*<reference\s+(?:path|types)=/
function collectReferenceDirectives(comment: t.Comment[]) {
  return comment.filter((c) => REFERENCE_RE.test(c.value))
}

function collectDependencies(
  node: t.Node,
  getIdentifierIndex: () => number,
  prepend: (node: t.Statement) => void,
): Dep[] {
  const deps = new Set<Dep>()
  const seen = new Set<t.Node>()

  ;(walk as any)(node, {
    leave(node: t.Node) {
      if (node.type === 'ExportNamedDeclaration') {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportSpecifier') {
            addDependency(specifier.local)
          }
        }
      } else if (node.type === 'TSInterfaceDeclaration' && node.extends) {
        for (const heritage of node.extends || []) {
          addDependency(TSEntityNameToRuntime(heritage.expression))
        }
      } else if (node.type === 'ClassDeclaration') {
        if (node.superClass) addDependency(node.superClass)
        if (node.implements) {
          for (const implement of node.implements) {
            addDependency(
              TSEntityNameToRuntime(
                (implement as t.TSExpressionWithTypeArguments).expression,
              ),
            )
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
      } else if (node.type === 'TSTypeReference') {
        addDependency(TSEntityNameToRuntime(node.typeName))
      } else if (node.type === 'TSTypeQuery') {
        if (seen.has(node.exprName)) return
        if (node.exprName.type !== 'TSImportType') {
          addDependency(TSEntityNameToRuntime(node.exprName))
        }
      } else if (node.type === 'TSImportType') {
        seen.add(node)
        const source = node.argument
        const imported = node.qualifier
        const dep = importNamespace(
          node,
          imported,
          source,
          getIdentifierIndex,
          prepend,
        )
        addDependency(dep)
      }
    },
  })
  return Array.from(deps)

  function addDependency(node: Dep) {
    if (node.type === 'Identifier' && node.name === 'this') return
    deps.add(node)
  }
}

function TSEntityNameToRuntime(
  node: t.TSEntityName,
): t.MemberExpression | t.Identifier {
  if (node.type === 'Identifier') {
    return node
  }
  const left = TSEntityNameToRuntime(node.left)
  return Object.assign(node, t.memberExpression(left, node.right))
}

function getIdFromTSEntityName(node: t.TSEntityName) {
  if (node.type === 'Identifier') {
    return node
  }
  return getIdFromTSEntityName(node.left)
}

function isReferenceId(
  node?: t.Node | null,
): node is t.Identifier | t.MemberExpression {
  return (
    !!node && (node.type === 'Identifier' || node.type === 'MemberExpression')
  )
}

// patch `.d.ts` suffix in import source to `.js`
function patchImportSource(node: t.Node) {
  if (
    isTypeOf(node, [
      'ImportDeclaration',
      'ExportAllDeclaration',
      'ExportNamedDeclaration',
    ]) &&
    node.source?.value &&
    RE_DTS.test(node.source.value)
  ) {
    node.source.value = filename_dts_to(node.source.value, 'js')
    return true
  }
}

function patchTsNamespace(nodes: t.Statement[]) {
  const emptyObjectAssignments = new Map<string, t.VariableDeclaration>()
  const removed = new Set<t.Node>()

  for (const [i, node] of nodes.entries()) {
    if (
      node.type === 'VariableDeclaration' &&
      node.declarations.length === 1 &&
      node.declarations[0].id.type === 'Identifier' &&
      node.declarations[0].init?.type === 'ObjectExpression' &&
      node.declarations[0].init.properties.length === 0
    ) {
      emptyObjectAssignments.set(node.declarations[0].id.name, node)
    }

    if (
      node.type !== 'ExpressionStatement' ||
      node.expression.type !== 'CallExpression' ||
      node.expression.callee.type !== 'Identifier' ||
      !node.expression.callee.name.startsWith('__export')
    )
      continue

    const [binding, exports] = node.expression.arguments
    if (binding.type !== 'Identifier') continue
    const bindingText = binding.name

    if (emptyObjectAssignments.has(bindingText)) {
      const emptyNode = emptyObjectAssignments.get(bindingText)!
      emptyObjectAssignments.delete(bindingText)
      removed.add(emptyNode)
    }

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
}

// fix:
// - import type { ... } from '...'
// - import { type ... } from '...'
// - export type { ... }
// - export { type ... }
// - export type * as '...'
// - import Foo = require("./bar")
// - export = Foo
// - export default x
function rewriteImportExport(
  node: t.Node,
  set: (node: t.Node) => void,
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
          exported: t.identifier('default'),
        },
      ],
    })
    return true
  }

  return false
}

function importNamespace(
  node: t.TSImportType,
  imported: t.TSEntityName | null | undefined,
  source: t.StringLiteral,
  getIdentifierIndex: () => number,
  prepend: (node: t.Statement) => void,
): Dep {
  const sourceText = source.value.replaceAll(/\W/g, '_')
  let local: t.Identifier | t.TSQualifiedName = t.identifier(
    `${sourceText}${getIdentifierIndex()}`,
  )

  // prepend: import * as ${local} from ${source}
  prepend(t.importDeclaration([t.importNamespaceSpecifier(local)], source))

  if (imported) {
    const importedLeft = getIdFromTSEntityName(imported)
    overwriteNode(importedLeft, t.tsQualifiedName(local, { ...importedLeft }))
    local = imported
  }

  let replacement: t.Node = node
  if (node.typeParameters) {
    overwriteNode(node, t.tsTypeReference(local, node.typeParameters))
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

function inheritNode<T extends t.Node>(oldValue: t.Node, newValue: T): T {
  return {
    ...newValue,
    leadingComments: oldValue.leadingComments,
    innerComments: oldValue.innerComments,
    trailingComments: oldValue.trailingComments,
  }
}

function overwriteNode<T>(node: t.Node, newNode: T): T {
  const preserve = ['leadingComments', 'innerComments', 'trailingComments']
  // clear object keys
  for (const key of Object.keys(node)) {
    if (preserve.includes(key)) continue
    delete (node as any)[key]
  }
  Object.assign(node, newNode, { ...node })
  return node as T
}
