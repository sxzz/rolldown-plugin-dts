import { is } from 'yuku/utils'
import type * as t from 'yuku'

export function isThisExpression(node: t.Node): boolean {
  return (
    (is.Identifier(node) && node.name === 'this') ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && isThisExpression(node.object))
  )
}

export function isInfer(node: t.Node): node is t.Identifier {
  return is.Identifier(node) && node.name === 'infer'
}

/** Identifiers bound by a declaration id, e.g. `[a, { b }]` */
export function collectPatternIdentifiers(
  node: t.Node | null | undefined,
): t.Identifier[] {
  if (!node) return []

  switch (node.type) {
    case 'Identifier':
      return [node]
    case 'RestElement':
      return collectPatternIdentifiers(node.argument)
    case 'AssignmentPattern':
      return collectPatternIdentifiers(node.left)
    case 'ArrayPattern':
      return node.elements.flatMap((element) =>
        collectPatternIdentifiers(element),
      )
    case 'ObjectPattern':
      return node.properties.flatMap((property) =>
        collectPatternIdentifiers(
          property.type === 'RestElement' ? property.argument : property.value,
        ),
      )
  }

  return []
}

export function nameOf(node: t.ModuleExportName): string {
  return node.type === 'Identifier' ? node.name : node.value
}

export function TSEntityNameToRuntime(
  node: t.TSTypeName,
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
 * The reverse of {@link TSEntityNameToRuntime}, in place. A type name taken out
 * as a runtime dependency comes back from Rolldown as a member expression,
 * which the printer rejects in a type position.
 */
export function runtimeToTSEntityName(node: t.Node): void {
  if (node.type !== 'MemberExpression') return

  const { object, property } = node
  runtimeToTSEntityName(object)
  for (const key of ['object', 'property', 'computed', 'optional']) {
    Reflect.deleteProperty(node, key)
  }
  Object.assign(node, {
    type: 'TSQualifiedName',
    left: object,
    right: property,
  })
}

export function getIdFromTSEntityName(
  node: t.TSTypeName,
): t.Identifier | t.ThisExpression {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return node
  }
  return getIdFromTSEntityName(node.left)
}

export function isReferenceId(
  node?: t.Node | null,
): node is t.Identifier | t.MemberExpression {
  return is.oneOf(node, ['Identifier', 'MemberExpression'])
}

export function isHelperImport(node: t.Node): boolean {
  return (
    node.type === 'ImportDeclaration' &&
    node.specifiers.length > 0 &&
    node.specifiers.every(
      (spec) =>
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier' &&
        ['__exportAll', '__reExport'].includes(spec.local.name),
    )
  )
}

const REFERENCE_RE = /\/\s*<reference\s+(?:path|types)=/
export function collectReferenceDirectives(
  comment: readonly t.Comment[],
  negative = false,
): t.Comment[] {
  return comment.filter((c) => REFERENCE_RE.test(c.value) !== negative)
}

const SOURCE_MAP_PRAGMA_RE = /^#\s*source(?:Mapping)?URL=/
export function isSourceMapPragma(comment: { value: string }): boolean {
  return SOURCE_MAP_PRAGMA_RE.test(comment.value)
}

export function isCjsDtsInputSyntax(node: t.ProgramStatement): boolean {
  return (
    node.type === 'TSExportAssignment' ||
    (node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference.type === 'TSExternalModuleReference')
  )
}

export function findDefaultExportRef(
  body: t.ProgramStatement[],
): t.Identifier | undefined {
  for (const stmt of body) {
    const ref =
      stmt.type === 'ExportDefaultDeclaration'
        ? stmt.declaration
        : stmt.type === 'TSExportAssignment'
          ? stmt.expression
          : undefined
    if (ref) return ref.type === 'Identifier' ? ref : undefined
  }
}

export function isLineMapped(
  mappings: string,
  code: string,
  offset: number,
): boolean {
  const line = code.slice(0, offset).split('\n').length - 1
  return !!mappings.split(';')[line]
}

export function overwriteNode<T>(node: t.Node, newNode: T): T {
  // clear object keys
  for (const key of Object.keys(node)) {
    Reflect.deleteProperty(node, key)
  }
  Object.assign(node, newNode)
  return node as T
}

/**
 * Region markers and alike, the comments worth keeping when their node is
 * replaced or dropped
 */
export function pragmaComments(node: t.Node): t.Comment[] {
  return (
    node.comments?.filter(
      (comment) =>
        comment.position === 'before' &&
        comment.value.startsWith('#') &&
        !isSourceMapPragma(comment),
    ) || []
  )
}

export function inheritNodeComments<T extends t.Node>(
  oldNode: t.Node,
  newNode: T,
): T {
  newNode.comments ||= []
  newNode.comments.unshift(...pragmaComments(oldNode))

  newNode.comments = newNode.comments.filter(
    (comment) =>
      !REFERENCE_RE.test(comment.value) && !isSourceMapPragma(comment),
  )

  return newNode
}

export function getIdentifierIndex(
  identifierMap: Record<string, number>,
  name: string,
): number {
  if (name in identifierMap) {
    return ++identifierMap[name]
  }
  return (identifierMap[name] = 0)
}
