import { b, is, nameOf } from 'yuku-ast'
import { filename_dts_to, RE_DTS } from '../filename.ts'
import { isInfer } from './utils.ts'
import type { ChunkExportPlan } from './types.ts'
import type * as t from 'yuku-parser'

/**
 * patch `.d.ts` suffix in import source to `.js`
 */
export function patchImportExport(
  node: t.ProgramStatement,
  exportPlan: ChunkExportPlan,
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
      exportPlan.typeOnlyExportAllSources.has(node.source.value)
    ) {
      node.exportKind = 'type'
    }

    if (
      node.type === 'ExportNamedDeclaration' &&
      exportPlan.typeOnlyNames.size
    ) {
      for (const spec of node.specifiers) {
        const name = nameOf(spec.exported)!
        if (exportPlan.typeOnlyNames.has(name)) {
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
      exportPlan.allowExportAssignment &&
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
export function patchTsNamespace(
  nodes: t.ProgramStatement[],
): t.ProgramStatement[] {
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
export function patchReExport(
  nodes: t.ProgramStatement[],
): t.ProgramStatement[] {
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
export function rewriteImportExport(
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
