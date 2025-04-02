import path from 'node:path'
import { walk } from 'estree-walker'
import { MagicStringAST, type MagicString } from 'magic-string-ast'
import {
  parseAsync,
  type BindingPattern,
  type Comment,
  type Declaration,
  type Expression,
  type Function,
  type IdentifierName,
  type MemberExpression,
  type Node,
  type Span,
  type TSModuleDeclarationName,
  type VariableDeclaration,
  type VariableDeclarator,
} from 'oxc-parser'
import { overwriteOrAppend, type Range } from './utils/magic-string'
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

interface SymbolInfo {
  code: string
  binding: Range
  deps: Range[]
  isType: boolean
  needDeclare: boolean
}

export function dts(): Plugin {
  let i = 0
  const symbolMap = new Map<number /* symbol id */, SymbolInfo>()
  const commentMap = new Map<string /* filename */, string[]>()

  function register(info: SymbolInfo) {
    const symbolId = i++
    symbolMap.set(symbolId, info)
    return symbolId
  }

  function retrieve(symbolId: number) {
    return symbolMap.get(symbolId)!
  }

  return {
    name: 'rolldown-plugin-dts',

    options({ onLog, ...options }) {
      return {
        ...options,
        resolve: {
          extensions: ['.d.ts'],
          extensionAlias: { '.js': ['.d.ts'] },
          ...options.resolve,
        },
        onLog(level, log, defaultHandler) {
          if (level === 'warn' && log.code === 'CIRCULAR_DEPENDENCY') {
            return
          }
          if (onLog) {
            onLog(level, log, defaultHandler)
          } else {
            defaultHandler(level, log)
          }
        },
        treeshake: {
          moduleSideEffects: 'no-external',
          unknownGlobalSideEffects: false,
        },
      }
    },

    outputOptions(options) {
      return {
        chunkFileNames: '[name]-[hash].d.ts',
        entryFileNames: '[name].ts',
        format: 'es',
        exports: 'named',
        ...options,
      }
    },

    resolveId(id, importer) {
      if (importer && !path.isAbsolute(id) && id[0] !== '.') {
        return { id, external: true }
      }
    },
    async transform(code, id) {
      const { program, comments } = await parseAsync(id, code)
      const preserveComments = collectReferenceDirectives(comments)
      commentMap.set(id, preserveComments)

      const s = new MagicStringAST(code)
      for (let node of program.body as (Node & Span)[]) {
        if (rewriteImportExport(s, node)) continue

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
          const offset = node.start

          let bindingRange: Range
          if (binding) {
            bindingRange = getIdentifierRange(binding, -offset)
          } else if (isDefaultExport) {
            const idx = s.sliceNode(node).indexOf('function') + 8
            bindingRange = [idx, idx]
          } else {
            continue
          }

          const deps = collectDependencies(s, node)
          const depsString = stringifyDependencies(s, deps)
          const depsRanges: Range[] = deps.map((dep) => [
            dep.start - offset,
            dep.end - offset,
          ])
          const isType =
            node.type.startsWith('TS') && node.type !== 'TSDeclareFunction'
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
            deps: depsRanges,
            isType,
            needDeclare,
          })

          const runtime = `[${symbolId}, ${depsString}]`
          const bindingName = binding ? s.sliceNode(binding) : 'export_default'
          if (isDefaultExport) {
            s.overwriteNode(
              stmt,
              `var ${bindingName} = ${runtime};export { ${bindingName} as default }`,
            )
          } else {
            s.overwriteNode(
              node,
              `var ${bindingName} = [${symbolId}, ${depsString}]`,
            )
          }
        }
      }

      if (!s.hasChanged()) return

      const str = s.toString()
      // console.log(str)
      return str
    },

    async renderChunk(code, chunk) {
      const { program } = await parseAsync(chunk.fileName, code)
      const s = new MagicStringAST(code)

      const comments = new Set<string>()
      for (const id of chunk.moduleIds) {
        const preserveComments = commentMap.get(id)
        if (preserveComments) {
          preserveComments.forEach((c) => comments.add(c))
          commentMap.delete(id)
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
        const { code, binding, deps, needDeclare } = retrieve(symbolId)

        const depsRaw = depsNodes.map((dep) => {
          if (dep.type !== 'ArrowFunctionExpression')
            throw new Error('Expected ArrowFunctionExpression')
          return s.sliceNode(dep.body)
        })

        const ss = new MagicStringAST(code)
        overwriteOrAppend(ss, binding, s.sliceNode(decl.id))
        for (const dep of deps) {
          overwriteOrAppend(ss, dep, depsRaw.shift()!)
        }
        if (needDeclare) ss.prepend('declare ')

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
): (Partial<Node> & Span)[] {
  const deps: Set<Partial<Node> & Span> = new Set()

  ;(walk as any)(node, {
    leave(node: Node) {
      if (node.type === 'TSInterfaceDeclaration' && node.extends) {
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
          // throw new Error('Import namespace is not supported')
          return
        }
        const source = node.argument.literal.value
        const imported = s.sliceNode(node.qualifier)
        const local = importNamespace(s, source, imported)
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

  function addDependency(node: Partial<Node> & Span) {
    if (node.type === 'Identifier' && node.name === 'this') {
      return
    }

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

function stringifyDependencies(
  s: MagicStringAST,
  deps: (Partial<Node> & Span)[],
) {
  return deps
    .map(
      (node) =>
        `() => ${node.type === 'Identifier' ? node.name! : s.sliceNode(node)}`,
    )
    .join(', ')
}

function getIdentifierRange(
  node: BindingPattern | TSModuleDeclarationName,
  offset: number = 0,
): Range {
  if ('typeAnnotation' in node && node.typeAnnotation) {
    return [node.start + offset, node.typeAnnotation.start + offset]
  }
  return [node.start + offset, node.end + offset]
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
    node.source?.value.endsWith('.d.ts')
  ) {
    s.overwriteNode(
      node.source,
      JSON.stringify(`${node.source.value.slice(0, -4)}js`),
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

let i = 0
function importNamespace(s: MagicString, source: string, imported: string) {
  const local = `_${i++}`
  s.prepend(
    `import { ${imported} as ${local} } from ${JSON.stringify(source)};\n`,
  )
  return local
}
