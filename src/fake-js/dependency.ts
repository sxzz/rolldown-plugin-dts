import { b, is, isIdentifierName, walk, walkAsync } from 'yuku-ast'
import {
  getIdentifierIndex,
  getIdFromTSEntityName,
  isReferenceId,
  isThisExpression,
  overwriteNode,
  TSEntityNameToRuntime,
} from './utils.ts'
import type { Dep, NamespaceMap, TypeParams } from './types.ts'
import type { TransformPluginContext } from 'rolldown'
import type * as t from 'yuku-parser'

/**
 * Collects all TSTypeParameter nodes from the given node and groups them by
 * their name. One name can associate with one or more type parameters. These
 * names will be used as the parameter name in the generated JavaScript
 * dependency function.
 */
export function collectParams(node: t.Node): TypeParams {
  const typeParams: t.Identifier[] = []
  walk(node, {
    leave(node) {
      if (
        'typeParameters' in node &&
        node.typeParameters?.type === 'TSTypeParameterDeclaration'
      ) {
        typeParams.push(...node.typeParameters.params.map(({ name }) => name))
      }
    },
  })

  const paramMap = new Map<string, t.Identifier[]>()
  for (const typeParam of typeParams) {
    const name = typeParam.name
    const group = paramMap.get(name)
    if (group) {
      group.push(typeParam)
    } else {
      paramMap.set(name, [typeParam])
    }
  }

  return Array.from(paramMap, ([name, typeParams]) => ({
    name,
    typeParams,
  }))
}

export async function collectDependencies(
  context: TransformPluginContext,
  node: t.Node,
  importer: string,
  namespaceStmts: NamespaceMap,
  children: Set<t.Node>,
  identifierMap: Record<string, number>,
): Promise<Dep[]> {
  const deps = new Set<Dep>()
  const seen = new Set<t.Node>()
  const preserveImportTypeCache = new Map<string, boolean>()

  const inferredStack: string[][] = []
  let currentInferred = new Set<string>()
  function isInferred(node: t.Node): boolean {
    return node.type === 'Identifier' && currentInferred.has(node.name)
  }

  await walkAsync(node, {
    enter(node) {
      if (node.type !== 'TSConditionalType') return

      const inferred = collectInferredNames(node.extendsType)
      inferredStack.push(inferred)
    },
    async leave(node, path) {
      const { parent } = path

      // handle infer scope
      if (node.type === 'TSConditionalType') {
        inferredStack.pop()
      } else if (parent?.type === 'TSConditionalType') {
        const trueBranch = parent.trueType === node
        currentInferred = new Set<string>(
          (trueBranch ? inferredStack : inferredStack.slice(0, -1)).flat(),
        )
      } else {
        currentInferred = new Set<string>()
      }

      if (node.type === 'ExportNamedDeclaration') {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportSpecifier') {
            addDependency(specifier.local)
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
        is.oneOf(node, [
          'Property',
          'PropertyDefinition',
          'TSAbstractPropertyDefinition',
          'MethodDefinition',
          'TSAbstractMethodDefinition',
          'TSPropertySignature',
          'TSMethodSignature',
        ])
      ) {
        if (node.computed && isReferenceId(node.key)) {
          addDependency(node.key)
        }
        if ('value' in node && isReferenceId(node.value)) {
          addDependency(node.value)
        }
      } else {
        switch (node.type) {
          case 'TSTypeReference': {
            addDependency(TSEntityNameToRuntime(node.typeName))
            break
          }
          case 'TSQualifiedName': {
            addDependency(getIdFromTSEntityName(node.left))
            break
          }
          case 'TSTypeQuery': {
            if (seen.has(node.exprName)) return
            if (node.exprName.type === 'TSImportType') break

            addDependency(TSEntityNameToRuntime(node.exprName))

            break
          }
          case 'TSImportType': {
            seen.add(node)
            const { source, qualifier } = node

            const resolved = await context.resolve(source.value, importer)
            if (!resolved || !!resolved.external) {
              preserveImportTypeCache.set(source.value, true)
              break
            }

            const dep = importNamespace(
              node,
              qualifier,
              source,
              namespaceStmts,
              identifierMap,
            )
            if (dep) addDependency(dep)
            break
          }
        }
      }

      if (parent && !deps.has(node as Dep) && isChildSymbol(node, parent)) {
        children.add(node)
      }
    },
  })

  return Array.from(deps)

  function addDependency(node: Dep) {
    if (isThisExpression(node) || isInferred(node)) return
    deps.add(node)
  }
}

function importNamespace(
  node: t.TSImportType,
  imported: t.TSTypeName | null | undefined,
  source: t.StringLiteral,
  namespaceStmts: NamespaceMap,
  identifierMap: Record<string, number>,
): Dep | undefined {
  const sourceText = source.value.replaceAll(/\W/g, '_')
  // Use original source if it's already a valid identifier,
  // otherwise use formatted text with index.
  const localName = `_$${
    isIdentifierName(source.value)
      ? source.value
      : `${sourceText}${getIdentifierIndex(identifierMap, sourceText)}`
  }`
  let local: t.Identifier | t.TSQualifiedName = b.Identifier({
    name: localName,
  })

  if (namespaceStmts.has(source.value)) {
    local = namespaceStmts.get(source.value)!.local
  } else {
    // prepend: import * as ${local} from ${source}
    namespaceStmts.set(source.value, {
      stmt: b.ImportDeclaration({
        specifiers: [b.ImportNamespaceSpecifier({ local })],
        source,
        phase: null,
        attributes: [],
      }),
      local,
    })
  }

  if (imported) {
    const importedLeft = getIdFromTSEntityName(imported)
    if (
      imported.type === 'ThisExpression' ||
      importedLeft.type === 'ThisExpression'
    ) {
      throw new Error('Cannot import `this` from module.')
    }
    overwriteNode(
      importedLeft,
      b.TSQualifiedName({ left: local, right: { ...importedLeft } }),
    )
    local = imported
  }

  let replacement: t.Node = node
  if (node.typeArguments) {
    overwriteNode(
      node,
      b.TSTypeReference({ typeName: local, typeArguments: node.typeArguments }),
    )
    replacement = local
  } else {
    overwriteNode(node, local)
  }

  const dep: Dep = {
    ...TSEntityNameToRuntime(local),
    replace(newNode) {
      overwriteNode(replacement, newNode)
    },
  }
  return dep
}

function isChildSymbol(node: t.Node, parent: t.Node) {
  if (node.type === 'Identifier') return true
  if (
    is.oneOf(parent, ['TSPropertySignature', 'TSMethodSignature']) &&
    parent.key === node
  )
    return true

  return false
}

function collectInferredNames(node: t.Node) {
  const inferred: string[] = []
  walk(node, {
    enter(node) {
      if (node.type === 'TSInferType' && node.typeParameter) {
        inferred.push(node.typeParameter.name.name)
      }
    },
  })
  return inferred
}
