import path from 'node:path'
import { walk } from 'estree-walker'
import { MagicStringAST } from 'magic-string-ast'
import {
  parseAsync,
  type BindingPattern,
  type Declaration,
  type Expression,
  type Function,
  type Node,
  type Span,
  type TSModuleDeclarationName,
  type VariableDeclaration,
  type VariableDeclarator,
} from 'oxc-parser'
import type { Plugin } from 'rolldown'

const RE_TYPE = /\btype\b/

type Range = [start: number, end: number]

export function dts(): Plugin {
  let i = 0
  const symbolMap = new Map<
    number /* symbol id */,
    [code: string, bindingRange: Range[], isType: boolean, hasDeclare: boolean]
  >()

  function register(
    raw: string,
    binding: BindingPattern | TSModuleDeclarationName,
    deps: (Node & Span)[],
    parent: Span,
    isType: boolean,
    hasDeclare: boolean,
  ) {
    const symbolId = i++
    let bindingEnd = binding.end
    if ('typeAnnotation' in binding && binding.typeAnnotation) {
      bindingEnd = binding.typeAnnotation.start
    }
    const ranges: Range[] = [
      [binding.start - parent.start, bindingEnd - parent.start],
      ...deps.map((d): Range => [d.start - parent.start, d.end - parent.start]),
    ]
    symbolMap.set(symbolId, [raw, ranges, isType, hasDeclare])
    return symbolId
  }

  function retrieve(s: MagicStringAST, id: number, bindings: Span[]) {
    const [code, ranges, isType, hasDeclare] = symbolMap.get(id)!
    if (!ranges.length) return code

    let codeIndex = 0
    let result = ''
    for (const [start, end] of ranges) {
      result += code.slice(codeIndex, start)
      result += s.sliceNode(bindings.shift())
      codeIndex = end
    }
    result += code.slice(codeIndex)
    return [result, isType, hasDeclare]
  }

  return {
    name: 'rolldown-plugin-dts',
    options(options) {
      options.resolve ||= {}
      options.resolve.extensions = ['.d.ts']
      options.resolve.extensionAlias = { '.js': ['.d.ts'] }
    },
    outputOptions(options) {
      options.entryFileNames = '[name].ts'
      options.chunkFileNames = '[name]-[hash].d.ts'
    },
    resolveId(id, importer) {
      if (importer && !path.isAbsolute(id) && id[0] !== '.') {
        return { id, external: true }
      }
    },
    async transform(code, id) {
      const { program } = await parseAsync(id, code)

      const s = new MagicStringAST(code)
      for (let node of program.body as (Node & Span)[]) {
        const stmt = node

        if (rewriteImportType(s, node)) continue

        // remove `export` modifier
        const isDefaultExport = node.type === 'ExportDefaultDeclaration'

        if (
          (node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportDefaultDeclaration') &&
          node.declaration
        ) {
          node = node.declaration
        }

        if (node.type === 'VariableDeclaration') {
          handleVariableDeclaration(s, node)
          continue
        }

        if (
          node.type === 'TSDeclareFunction' ||
          node.type.endsWith('Declaration')
        ) {
          const binding = (
            node as Exclude<Declaration, VariableDeclaration> | Function
          ).id
          if (!binding) continue
          const original = s.sliceNode(node)
          const deps = collectDependencies(node)
          deps.sort((a, b) => a.start - b.start)
          const depsString = deps
            .map((node) => `() => ${s.sliceNode(node)}`)
            .join(', ')
          const isType =
            node.type.startsWith('TS') && node.type !== 'TSDeclareFunction'
          const hasDeclare = 'declare' in node && !!node.declare
          const symbolId = register(
            original,
            binding,
            deps,
            node,
            isType,
            hasDeclare,
          )

          const runtime = `[${symbolId}, ${depsString}]`
          const bindingName = s.sliceNode(binding)
          if (isDefaultExport) {
            s.overwriteNode(
              stmt,
              `var ${bindingName} = ${runtime};export default ${bindingName}`,
            )
          } else
            s.overwriteNode(
              node,
              `var ${bindingName} = [${symbolId}, ${depsString}]`,
            )
        }
      }

      return s.toString()
    },

    async renderChunk(code, chunk) {
      const { program } = await parseAsync(chunk.fileName, code)
      const s = new MagicStringAST(code)

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
        const [type, isType, hasDeclare] = retrieve(s, symbolId, [
          decl.id,
          ...depsNodes.map((dep) => {
            if (dep.type !== 'ArrowFunctionExpression')
              throw new Error('Expected ArrowFunctionExpression')
            return dep.body
          }),
        ])
        console.log(type, isType, hasDeclare)

        s.overwriteNode(
          node,
          `${!isType && !hasDeclare ? 'declare ' : ''}${type}`,
        )
      }

      const str = s.toString()
      if (str.trim().length === 0) {
        return 'export {}'
      }

      return str
    },
  }

  function handleVariableDeclaration(
    s: MagicStringAST,
    node: VariableDeclaration,
  ) {
    if (!node.declare) return
    if (node.declarations.length !== 1)
      throw new Error('Only one declaration is supported')

    const [decl] = node.declarations

    const raw = s.sliceNode(node)
    const deps = collectDependencies(node)
    const depsString = deps
      .map((node) => `() => ${s.sliceNode(node)}`)
      .join(', ')
    const symbolId = register(raw, decl.id, deps, node, false, node.declare)
    const runtime = `[${symbolId}, ${depsString}]`
    s.overwriteNode(node, `var ${s.sliceNode(decl.id)} = ${runtime}`)
  }
}

function collectDependencies(node: Node): (Node & Span)[] {
  const deps = new Set<Node & Span>()
  ;(walk as any)(node, {
    enter(node: Node) {
      if (node.type === 'TSInterfaceDeclaration' && node.extends) {
        for (const heritage of node.extends || []) {
          deps.add(heritage.expression)
        }
      } else if (node.type === 'ClassDeclaration' && node.superClass) {
        deps.add(node.superClass)
      } else if (
        (node.type === 'MethodDefinition' ||
          node.type === 'PropertyDefinition' ||
          node.type === 'TSPropertySignature') &&
        (node.key.type === 'Identifier' ||
          node.key.type === 'MemberExpression') &&
        node.computed
      ) {
        deps.add(node.key)
      } else if (node.type === 'TSTypeReference') {
        deps.add(node.typeName)
      } else if (node.type === 'TSTypeQuery') {
        deps.add(node.exprName)
      }
    },
  })
  return Array.from(deps)
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
function rewriteImportType(s: MagicStringAST, node: Node) {
  if (node.type === 'ImportDeclaration') {
    for (const specifier of node.specifiers) {
      if (
        specifier.type === 'ImportSpecifier' &&
        specifier.importKind === 'type'
      ) {
        s.overwriteNode(specifier, s.sliceNode(specifier).replace(RE_TYPE, ''))
      }
    }

    const firstSpecifier = node.specifiers[0]
    if (node.importKind === 'type' && firstSpecifier) {
      s.overwrite(
        node.start,
        firstSpecifier.start,
        s.slice(node.start, firstSpecifier.start).replace(RE_TYPE, ''),
      )
    }
    return true
  }
}
