import { b, is, nameOf, walk } from 'yuku-ast'
import { filename_dts_to, RE_DTS } from '../filename.ts'
import { collectDeclarationNames } from './exports.ts'
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
    !is.oneOf(node, [
      'ImportDeclaration',
      'ExportAllDeclaration',
      'ExportNamedDeclaration',
    ])
  ) {
    return
  }

  if (
    node.type === 'ExportAllDeclaration' &&
    node.source &&
    exportPlan.typeOnlyExportAllSources.has(node.source.value)
  ) {
    node.exportKind = 'type'
  }

  if (node.type === 'ExportNamedDeclaration' && exportPlan.typeOnlyNames.size) {
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

  // eslint-disable-next-line unicorn/prefer-early-return
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

/**
 * Expose the members of an `export =` target as named exports, the way
 * TypeScript resolves `import { x } from './cjs'`
 *
 * ```ts
 * declare const _exports: { x: typeof x }
 * declare namespace ns { interface Y {} }
 * export = _exports // or ns
 * ```
 * to
 * ```ts
 * declare const _exports_x: typeof _exports.x
 * export { _exports_x as x }
 * import ns_Y = ns.Y
 * export { ns_Y as Y }
 * ```
 *
 * @returns the `export =` statement, if its target could be expanded
 */
export function expandExportAssignment(
  body: t.ProgramStatement[],
): t.TSExportAssignment | undefined {
  const assignment = body.find(
    (node): node is t.TSExportAssignment =>
      node.type === 'TSExportAssignment' &&
      node.expression.type === 'Identifier',
  )
  if (!assignment) return
  const target = (assignment.expression as t.Identifier).name

  // name -> whether it is a namespace member (`import =`) or a property (`typeof`)
  const members = new Map<string, 'namespace' | 'property'>()
  let expandable = false
  for (const node of body) {
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        const type = declarator.id.typeAnnotation?.typeAnnotation
        if (
          !is.Identifier(declarator.id, target) ||
          type?.type !== 'TSTypeLiteral'
        ) {
          continue
        }
        expandable = true
        for (const name of collectPropertyNames(type)) {
          if (!members.has(name)) members.set(name, 'property')
        }
      }
    } else if (
      node.type === 'TSModuleDeclaration' &&
      node.kind === 'namespace'
    ) {
      if (is.Identifier(node.id, target)) {
        expandable = true
        for (const name of collectNamespaceExportNames(node)) {
          members.set(name, 'namespace')
        }
      } else if (node.id.type === 'TSQualifiedName') {
        // `declare namespace ns.a.b {}` exports `a` from `ns`
        let id = node.id
        while (id.left.type === 'TSQualifiedName') id = id.left
        if (is.Identifier(id.left, target)) {
          expandable = true
          members.set(id.right.name, 'namespace')
        }
      }
    }
  }
  if (!expandable) return

  // e.g. tsc emits both `export =` and named exports for JSON modules
  const exportedNames = new Set<string>()
  const usedNames = new Set<string>()
  for (const node of body) {
    if (node.type === 'ExportNamedDeclaration') {
      for (const spec of node.specifiers) {
        exportedNames.add(nameOf(spec.exported)!)
      }
      if (node.declaration) {
        for (const name of collectDeclarationNames(node.declaration)) {
          exportedNames.add(name)
        }
      }
    }

    walk(node, {
      enter(node) {
        if (node.type === 'Identifier') usedNames.add(node.name)
      },
    })
  }

  for (const [name, kind] of members) {
    if (exportedNames.has(name)) continue

    let alias = `${target}_${name}`
    while (usedNames.has(alias)) alias += '$'
    usedNames.add(alias)

    const reference = b.TSQualifiedName({
      left: b.Identifier({ name: target }),
      right: b.Identifier({ name }),
    })
    body.push(
      kind === 'namespace'
        ? b.TSImportEqualsDeclaration({
            id: b.Identifier({ name: alias }),
            moduleReference: reference,
            importKind: 'value',
          })
        : b.VariableDeclaration({
            kind: 'const',
            declare: true,
            declarations: [
              b.VariableDeclarator({
                id: b.Identifier({
                  name: alias,
                  typeAnnotation: b.TSTypeAnnotation({
                    typeAnnotation: b.TSTypeQuery({
                      exprName: reference,
                      typeArguments: null,
                    }),
                  }),
                }),
                init: null,
              }),
            ],
          }),
      b.ExportNamedDeclaration({
        declaration: null,
        specifiers: [
          b.ExportSpecifier({
            local: b.Identifier({ name: alias }),
            exported: b.Identifier({ name }),
          }),
        ],
        source: null,
        attributes: [],
      }),
    )
  }

  return assignment
}

function collectPropertyNames(type: t.TSTypeLiteral): string[] {
  return type.members.flatMap((member) =>
    (member.type === 'TSPropertySignature' ||
      (member.type === 'TSMethodSignature' && member.kind === 'method')) &&
    !member.computed &&
    member.key.type === 'Identifier'
      ? [member.key.name]
      : [],
  )
}

/**
 * Every member of an ambient namespace is exported, unless the namespace has
 * an `export { ... }` list, in which case only explicit exports are
 */
function collectNamespaceExportNames(node: t.TSModuleDeclaration): string[] {
  const body = node.body?.body ?? []
  const hasExportList = body.some(
    (stmt) => stmt.type === 'ExportNamedDeclaration' && !stmt.declaration,
  )

  return body.flatMap((stmt) => {
    if (stmt.type === 'ExportNamedDeclaration') {
      return stmt.declaration
        ? collectDeclarationNames(stmt.declaration)
        : stmt.specifiers.map((spec) => nameOf(spec.exported)!)
    }
    return hasExportList ? [] : collectDeclarationNames(stmt)
  })
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
