import path from 'node:path'
import { MagicStringAST } from 'magic-string-ast'
import {
  parseAsync,
  type Declaration,
  type Function,
  type Node,
  type TSTypeName,
  type TSTypeQuery,
  type TSTypeReference,
  type VariableDeclaration,
  type VariableDeclarator,
} from 'oxc-parser'
import type { Plugin } from 'rolldown'

const RE_TYPE = /\btype\b/

export function dts(): Plugin {
  let i = 0
  const map = new Map<number, string>()

  function register(raw: string) {
    const id = i++
    map.set(id, raw)
    return id
  }

  function retrieve(id: number) {
    return map.get(id)!
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
      for (let node of program.body) {
        if (node.type === 'ImportDeclaration') {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.importKind === 'type'
            ) {
              s.overwriteNode(
                specifier,
                s.sliceNode(specifier).replace(RE_TYPE, ''),
              )
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
        }

        if (node.type === 'ExportNamedDeclaration' && node.declaration) {
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
          const id = register(s.sliceNode(node))
          const deps = scanTypeReference(node)
            .map((node) => `() => ${s.sliceNode(node)}`)
            .join(', ')

          s.overwriteNode(
            node,
            `var ${s.sliceNode(binding)} = [${id}, ${deps}]`,
          )
        }
      }

      return s.toString()
    },

    async renderChunk(code, chunk) {
      const { program } = await parseAsync(chunk.fileName, code)
      const s = new MagicStringAST(code)

      for (const node of program.body) {
        if (patchImportSource(s, node)) {
          continue
        }
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

        const idNode = decl.init.elements[0]
        if (idNode?.type !== 'Literal' || typeof idNode.value !== 'number') {
          patchVariableDeclarator(s, node, decl)
          continue
        }

        const id = idNode.value
        const type = retrieve(id)
        s.overwriteNode(node, type)
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
    const id = register(raw)
    const deps = scanTypeReference(node)
      .map((node) => s.sliceNode(node))
      .join(', ')
    s.overwriteNode(node, `var ${s.sliceNode(decl.id)} = [${id}, ${deps}]`)
  }
}

function scanTypeReference(node: Node): TSTypeName[] {
  if (!node) return []
  const result: any[] = []

  for (const value of Object.values(node)) {
    if (value?.type === 'TSTypeReference') {
      result.push((value as TSTypeReference).typeName)
    }
    if (value?.type === 'TSTypeQuery') {
      result.push((value as TSTypeQuery).exprName)
    }

    if (typeof value === 'object') {
      result.push(...scanTypeReference(value))
    }
  }

  return result
}

function patchVariableDeclarator(
  s: MagicStringAST,
  node: VariableDeclaration,
  decl: VariableDeclarator,
) {
  if (decl.init && !decl.id.typeAnnotation) {
    s.overwriteNode(
      node,
      `declare ${node.kind} ${s.sliceNode(decl.id)}: typeof ${s.sliceNode(decl.init)}`,
    )
  } else if (!node.declare) {
    s.prependLeft(node.start, 'declare ')
  }
}

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
