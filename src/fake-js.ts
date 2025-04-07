import { walk } from 'estree-walker'
import { MagicStringAST, type MagicString } from 'magic-string-ast'
import {
  parseAsync,
  type Comment,
  type Declaration,
  type Expression,
  type Function,
  type IdentifierName,
  type MemberExpression,
  type Node,
  type Span,
  type VariableDeclaration,
  type VariableDeclarator,
} from 'oxc-parser'
import { getIdentifierRange } from './utils/ast'
import {
  filename_dts_to,
  filename_js_to_dts,
  isRelative,
  RE_DTS,
  RE_NODE_MODULES,
} from './utils/filename'
import { overwriteOrAppend, type Range } from './utils/magic-string'
import type { Options } from '.'
import type { Plugin } from 'rolldown'

const RE_TYPE = /\btype\b/

// export declare function x(xx: X): void

// to:            const x = [1, () => X]
// after compile: const y = [1, () => Y]

// replace X with Y:
// export declare function y(xx: Y): void

// how? needs
// - original range (overwrite or add)
// - replacement

type Dep = Partial<Node> & Span & { _suffix?: string }
type DepSymbol = [start: number, end: number, suffix?: string]
interface SymbolInfo {
  code: string
  binding: Range
  deps: DepSymbol[]
  needDeclare: boolean
  jsdoc?: string
  preserveName: boolean
}

export function createFakeJsPlugin({
  dtsInput,
}: Pick<Options, 'dtsInput'>): Plugin {
  let symbolIdx = 0
  let identifierIdx = 0
  const symbolMap = new Map<number /* symbol id */, SymbolInfo>()
  const preserveMap = new Map<string /* filename */, string[]>()

  function getIdentifierIndex() {
    return identifierIdx++
  }

  function register(info: SymbolInfo) {
    const symbolId = symbolIdx++
    symbolMap.set(symbolId, info)
    return symbolId
  }

  function retrieve(symbolId: number) {
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
      return {
        ...options,
        entryFileNames:
          options.entryFileNames ?? (dtsInput ? '[name].ts' : undefined),
        chunkFileNames(chunk) {
          const original =
            (typeof options.chunkFileNames === 'function'
              ? options.chunkFileNames(chunk)
              : options.chunkFileNames) || '[name]-[hash].js'

          if (chunk.name.endsWith('.d')) {
            return filename_js_to_dts(original)
          }
          return original
        },
      }
    },

    transform: {
      filter: {
        id: {
          include: [RE_DTS],
          exclude: [RE_NODE_MODULES],
        },
      },
      async handler(code, id) {
        const { program, comments } = await parseAsync(id, code)
        const preserved = collectReferenceDirectives(comments)
        preserveMap.set(id, preserved)

        const s = new MagicStringAST(code)
        for (let node of program.body as (Node & Span)[]) {
          if (
            node.type === 'ExportAllDeclaration' &&
            node.exported &&
            isRelative(node.source.value)
          ) {
            throw new Error("`export * as foo from './...'` is not supported")
          }
          if (rewriteImportExport(s, node)) continue

          const sideEffect =
            node.type === 'TSModuleDeclaration' && node.kind !== 'namespace'

          const stmt = node
          // remove `export` modifier
          const isDefaultExport = node.type === 'ExportDefaultDeclaration'

          if (
            (node.type === 'ExportNamedDeclaration' ||
              node.type === 'ExportDefaultDeclaration') &&
            node.declaration
          ) {
            node = node.declaration
          }

          if (
            node.type === 'VariableDeclaration' &&
            node.declarations.length !== 1
          )
            throw new Error('Only one declaration is supported')

          if (
            node.type === 'TSDeclareFunction' ||
            node.type.endsWith('Declaration')
          ) {
            const binding =
              node.type === 'VariableDeclaration'
                ? node.declarations[0].id
                : (node as Exclude<Declaration | Function, VariableDeclaration>)
                    .id

            const code = s.sliceNode(node)

            const jsdoc = comments.find(
              (c) =>
                c.type === 'Block' &&
                c.value[0] === '*' &&
                stmt.start - c.end <= 1,
            )

            const offset = node.start

            let bindingRange: Range
            if (sideEffect) {
              bindingRange = [0, 0]
            } else if (binding) {
              bindingRange = getIdentifierRange(binding, -offset)
            } else if (isDefaultExport) {
              const idx = s.sliceNode(node).indexOf('function') + 8
              bindingRange = [idx, idx]
            } else {
              continue
            }

            const depsNodes = collectDependencies(s, node, getIdentifierIndex)
            const depsString = stringifyDependencies(s, depsNodes)
            const depsSymbols: DepSymbol[] = depsNodes.map((dep) => [
              dep.start - offset,
              dep.end - offset,
              dep._suffix,
            ])
            const needDeclare =
              (node.type === 'TSEnumDeclaration' ||
                node.type === 'ClassDeclaration' ||
                node.type === 'FunctionDeclaration' ||
                node.type === 'TSDeclareFunction' ||
                node.type === 'TSModuleDeclaration' ||
                node.type === 'VariableDeclaration') &&
              !node.declare

            const symbolId = register({
              code,
              binding: bindingRange,
              deps: depsSymbols,
              needDeclare,
              jsdoc: jsdoc ? s.sliceNode(jsdoc) : undefined,
              preserveName: sideEffect,
            })

            const runtime = `[${symbolId}, ${depsString}${depsString && sideEffect ? ', ' : ''}${sideEffect ? 'sideEffect()' : ''}]`
            const bindingName = sideEffect
              ? `_${identifierIdx++}`
              : binding
                ? s.sliceNode(binding)
                : 'export_default'
            if (isDefaultExport) {
              s.overwriteNode(
                stmt,
                `var ${bindingName} = ${runtime};export { ${bindingName} as default }`,
              )
            } else {
              s.overwriteNode(node, `var ${bindingName} = ${runtime};`)
            }
          }
        }

        if (!s.hasChanged()) return

        const str = s.toString()
        return str
      },
    },

    async renderChunk(code, chunk) {
      if (!RE_DTS.test(chunk.fileName)) {
        return
      }

      const { program } = await parseAsync(chunk.fileName, code)
      const s = new MagicStringAST(code)

      const comments = new Set<string>()
      for (const id of chunk.moduleIds) {
        const preserveComments = preserveMap.get(id)
        if (preserveComments) {
          preserveComments.forEach((c) => comments.add(c))
          preserveMap.delete(id)
        }
      }
      if (comments.size) s.prepend(`${[...comments].join('\n')}\n`)

      for (const node of program.body) {
        if (patchImportSource(s, node)) continue

        if (
          node.type !== 'VariableDeclaration' ||
          node.declarations.length !== 1
        )
          continue

        const [decl] = node.declarations

        if (decl.init?.type !== 'ArrayExpression' || !decl.init.elements[0]) {
          patchVariableDeclarator(s, node, decl)
          continue
        }

        const [symbolIdNode, ...depsNodes] = decl.init.elements as Expression[]
        if (
          symbolIdNode?.type !== 'Literal' ||
          typeof symbolIdNode.value !== 'number'
        ) {
          patchVariableDeclarator(s, node, decl)
          continue
        }

        const symbolId = symbolIdNode.value
        const { code, binding, deps, needDeclare, jsdoc, preserveName } =
          retrieve(symbolId)

        const depsRaw = depsNodes
          .filter((node) => node?.type === 'ArrowFunctionExpression')
          .map((dep) => s.sliceNode(dep.body))

        const ss = new MagicStringAST(code)
        if (!preserveName) {
          overwriteOrAppend(ss, binding, s.sliceNode(decl.id))
        }
        for (const dep of deps) {
          const [start, end, suffix] = dep
          overwriteOrAppend(ss, [start, end], depsRaw.shift()!, suffix)
        }
        if (needDeclare) ss.prepend('declare ')
        if (jsdoc) ss.prepend(`${jsdoc}\n`)

        s.overwriteNode(node, ss.toString())
      }

      const str = s.toString()
      if (str.trim().length === 0) {
        return 'export {}'
      }

      return str
    },
  }
}

const REFERENCE_RE = /\/\s*<reference\s+(?:path|types)=/
function collectReferenceDirectives(comment: Comment[]) {
  return comment
    .filter((c) => REFERENCE_RE.test(c.value))
    .map((c) => `//${c.value}`)
}

function collectDependencies(
  s: MagicStringAST,
  node: Node,
  getIdentifierIndex: () => number,
): Dep[] {
  const deps: Set<Dep> = new Set()

  ;(walk as any)(node, {
    leave(node: Node) {
      if (node.type === 'ExportNamedDeclaration') {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportSpecifier') {
            let _suffix: string | undefined
            if (
              specifier.local.start === specifier.exported.start &&
              specifier.local.end === specifier.exported.end
            ) {
              _suffix = ` as ${s.sliceNode(specifier.local)}`
            }
            addDependency({
              ...specifier.local,
              _suffix,
            })
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
        node.type === 'MethodDefinition' ||
        node.type === 'PropertyDefinition' ||
        node.type === 'TSPropertySignature'
      ) {
        if (node.computed && isReferenceId(node.key)) {
          addDependency(node.key)
        }
        if ('value' in node && isReferenceId(node.value)) {
          addDependency(node.value)
        }
      } else if (node.type === 'TSTypeReference') {
        addDependency(node.typeName)
      } else if (node.type === 'TSTypeQuery') {
        addDependency(node.exprName)
      } else if (node.type === 'TSImportType') {
        if (
          node.argument.type !== 'TSLiteralType' ||
          node.argument.literal.type !== 'Literal' ||
          typeof node.argument.literal.value !== 'string'
        )
          return
        if (!node.qualifier) {
          throw new Error('Import namespace is not supported')
        }
        const source = node.argument.literal.value
        const imported = s.sliceNode(node.qualifier)
        const local = importNamespace(s, source, imported, getIdentifierIndex)
        addDependency({
          type: 'Identifier',
          name: local,
          start: node.start + (node.isTypeOf ? 7 : 0),
          end: node.qualifier.end,
        })
      }
    },
  })
  return Array.from(deps)

  function addDependency(node: Dep) {
    if (node.type === 'Identifier' && node.name === 'this') return
    deps.add(node)
  }
}

function isReferenceId(
  node?: Node | null,
): node is (IdentifierName | MemberExpression) & Span {
  return (
    !!node && (node.type === 'Identifier' || node.type === 'MemberExpression')
  )
}

function stringifyDependencies(s: MagicStringAST, deps: Dep[]) {
  return deps
    .map(
      (node) =>
        `() => ${node.type === 'Identifier' ? node.name! : s.sliceNode(node)}`,
    )
    .join(', ')
}

// patch `let x = 1;` to `type x: 1;`
function patchVariableDeclarator(
  s: MagicStringAST,
  node: VariableDeclaration,
  decl: VariableDeclarator,
) {
  if (decl.init && !decl.id.typeAnnotation) {
    s.overwriteNode(
      node,
      `type ${s.sliceNode(decl.id)} = ${s.sliceNode(decl.init)}`,
    )
  } else if (!node.declare) {
    s.prependLeft(node.start, 'declare ')
  }
}

// patch `.d.ts` suffix in import source to `.js`
function patchImportSource(s: MagicStringAST, node: Node) {
  if (
    (node.type === 'ImportDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportNamedDeclaration') &&
    node.source?.value &&
    RE_DTS.test(node.source.value)
  ) {
    s.overwriteNode(
      node.source,
      JSON.stringify(filename_dts_to(node.source.value, 'js')),
    )
    return true
  }
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
function rewriteImportExport(s: MagicStringAST, node: Node) {
  if (
    node.type === 'ImportDeclaration' ||
    (node.type === 'ExportNamedDeclaration' && !node.declaration)
  ) {
    for (const specifier of node.specifiers) {
      if (
        (specifier.type === 'ImportSpecifier' &&
          specifier.importKind === 'type') ||
        (specifier.type === 'ExportSpecifier' &&
          specifier.exportKind === 'type')
      ) {
        s.overwriteNode(specifier, s.sliceNode(specifier).replace(RE_TYPE, ''))
      }
    }

    const firstSpecifier = node.specifiers[0]
    const kind =
      node.type === 'ImportDeclaration' ? node.importKind : node.exportKind
    if (kind === 'type' && firstSpecifier) {
      s.overwrite(
        node.start,
        firstSpecifier.start,
        s.slice(node.start, firstSpecifier.start).replace(RE_TYPE, ''),
      )
    }
    return true
  } else if (node.type === 'ExportAllDeclaration') {
    if (node.exportKind === 'type') {
      s.overwrite(
        node.start,
        node.source.start,
        s.slice(node.start, node.source.start).replace(RE_TYPE, ''),
      )
    }
    return true
  } else if (node.type === 'TSImportEqualsDeclaration') {
    if (node.moduleReference.type === 'TSExternalModuleReference') {
      s.overwriteNode(
        node,
        `import ${s.sliceNode(node.id)} from ${s.sliceNode(
          node.moduleReference.expression,
        )}`,
      )
    }
    return true
  } else if (node.type === 'TSExportAssignment') {
    s.overwriteNode(node, `export default ${s.sliceNode(node.expression)}`)
    return true
  } else if (
    node.type === 'ExportDefaultDeclaration' &&
    node.declaration.type === 'Identifier'
  ) {
    s.overwriteNode(
      node,
      `export { ${s.sliceNode(node.declaration)} as default }`,
    )
    return true
  }
}

function importNamespace(
  s: MagicString,
  source: string,
  imported: string,
  getIdentifierIndex: () => number,
) {
  const local = `_${getIdentifierIndex()}`
  s.prepend(
    `import { ${imported} as ${local} } from ${JSON.stringify(source)};\n`,
  )
  return local
}
