import { b, is } from 'yuku-ast'
import type * as t from 'yuku-parser'

/**
 * A variable declaration that declares a runtime binding variable. It represents a declaration like:
 *
 * ```js
 * var binding = [declarationId, (param, ...) => [dep, ...], sideEffect()]
 * ```
 *
 * For an more concrete example, the following TypeScript declaration:
 *
 * ```ts
 * interface Bar extends Foo { bar: number }
 * ```
 *
 * Will be transformed to the following JavaScript code:
 *
 * ```js
 * const Bar = [123, () => [Foo]]
 * ```
 *
 * Which will be represented by this type.
 */
export type RuntimeBindingVariableDeclration = t.VariableDeclaration & {
  declarations: [
    t.VariableDeclarator & {
      id: t.ArrayPattern
      init: RuntimeBindingArrayExpression
    },
    ...t.VariableDeclarator[],
  ]
}

/**
 * Check if the given node is a {@link RuntimeBindingVariableDeclration}
 */
export function isRuntimeBindingVariableDeclaration(
  node: t.Node | null | undefined,
): node is RuntimeBindingVariableDeclration {
  return (
    node?.type === 'VariableDeclaration' &&
    node.declarations.length === 1 &&
    node.declarations[0].type === 'VariableDeclarator' &&
    node.declarations[0].id.type === 'ArrayPattern' &&
    isRuntimeBindingArrayExpression(node.declarations[0].init)
  )
}

/**
 * A array expression that contains {@link RuntimeBindingArrayElements}
 *
 * It can be used to represent the following JavaScript code:
 *
 * ```js
 * [declarationId, (param, ...) => [dep, ...], sideEffect()]
 * ```
 */
export type RuntimeBindingArrayExpression = t.ArrayExpression & {
  elements: RuntimeBindingArrayElements
}

/**
 * Check if the given node is a {@link RuntimeBindingArrayExpression}
 */
function isRuntimeBindingArrayExpression(
  node: t.Node | null | undefined,
): node is RuntimeBindingArrayExpression {
  return (
    node?.type === 'ArrayExpression' &&
    isRuntimeBindingArrayElements(node.elements)
  )
}

/**
 * Check if the given array is a {@link RuntimeBindingArrayElements}
 */
function isRuntimeBindingArrayElements(
  elements: Array<t.Node | null | undefined>,
): elements is RuntimeBindingArrayElements {
  const [declarationId, deps, children, effect] = elements
  return (
    is.NumericLiteral(declarationId) &&
    deps?.type === 'ArrowFunctionExpression' &&
    children?.type === 'ArrayExpression' &&
    (!effect || effect.type === 'CallExpression')
  )
}

export function runtimeBindingArrayExpression(
  elements: RuntimeBindingArrayElements,
): RuntimeBindingArrayExpression {
  return b.ArrayExpression({
    elements: [...elements],
  }) as RuntimeBindingArrayExpression
}

type RuntimeBindingArrayElementsBase = [
  declarationId: t.NumericLiteral,
  deps: t.ArrowFunctionExpression,
  children: t.ArrayExpression,
]

/**
 * An array that represents the elements in {@link RuntimeBindingArrayExpression}
 */
export type RuntimeBindingArrayElements =
  | RuntimeBindingArrayElementsBase
  | [...RuntimeBindingArrayElementsBase, effect: t.CallExpression]
