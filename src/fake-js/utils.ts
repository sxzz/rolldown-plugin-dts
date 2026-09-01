import { is } from 'yuku-ast'
import type * as t from 'yuku-parser'

export function isThisExpression(node: t.Node): boolean {
  return (
    is.Identifier(node, 'this') ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && isThisExpression(node.object))
  )
}

export function isInfer(node: t.Node): node is t.Identifier {
  return is.Identifier(node, 'infer')
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
  comment: t.Comment[],
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
export function pragmaComments(node: t.Node): t.AttachedComment[] {
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
