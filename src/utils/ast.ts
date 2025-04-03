import type { Range } from './magic-string'
import type { BindingPattern, TSModuleDeclarationName } from 'oxc-parser'

export function getIdentifierRange(
  node: BindingPattern | TSModuleDeclarationName,
  offset: number = 0,
): Range {
  if ('typeAnnotation' in node && node.typeAnnotation) {
    return [node.start + offset, node.typeAnnotation.start + offset]
  }
  return [node.start + offset, node.end + offset]
}
