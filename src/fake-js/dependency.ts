import { b, is, isIdentifierName, walk, walkAsync } from 'yuku-ast'
import {
  Meaning,
  QUALIFIER_MEANING,
  type Dep,
  type DepRoot,
  type NamespaceMap,
  type NamespaceMember,
  type NamespaceScope,
  type TypeParams,
} from './types.ts'
import {
  getDeclarationBindings,
  getDeclarationMeaning,
  getIdentifierIndex,
  getIdFromTSEntityName,
  getRootIdentifier,
  isReferenceId,
  isThisExpression,
  overwriteNode,
  TSEntityNameToRuntime,
} from './utils.ts'
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

function isNamespaceWithBody(
  node: t.Node,
): node is t.TSModuleDeclaration & { body: t.TSModuleBlock } {
  return (
    node.type === 'TSModuleDeclaration' &&
    node.kind === 'namespace' &&
    !!node.body
  )
}

/**
 * Collects the names declared directly in the body of a namespace. They are in
 * scope for the whole body, where they shadow the names around the namespace.
 */
function collectNamespaceMembers(
  node: t.Node,
  params: TypeParams,
): Map<string, NamespaceMember> {
  const members = new Map<string, NamespaceMember>()
  if (!isNamespaceWithBody(node)) return members

  for (const [decl, meaning] of memberDeclarations(node.body)) {
    for (const binding of getDeclarationBindings(decl)) {
      const member = members.get(binding.name)
      if (member) {
        member.meaning |= meaning
        member.bindings.push(binding)
      } else {
        members.set(binding.name, {
          name: binding.name,
          meaning,
          bindings: [binding],
          references: new Set(),
        })
      }
    }
  }

  // A type parameter or a member of a nested namespace shadows the member
  // again. Which of them a reference means is not tracked, so leave those
  // names alone.
  for (const { name } of params) {
    members.delete(name)
  }
  walk(node, {
    enter(child) {
      if (child.type !== 'TSModuleBlock' || child === node.body) return
      for (const [decl] of memberDeclarations(child)) {
        for (const binding of getDeclarationBindings(decl)) {
          members.delete(binding.name)
        }
      }
    },
  })

  return members
}

function* memberDeclarations(
  block: t.TSModuleBlock,
): Generator<[decl: t.Node, meaning: number]> {
  for (const stmt of block.body) {
    const decl =
      stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    const meaning = decl ? getDeclarationMeaning(decl) : 0
    if (decl && meaning) yield [decl, meaning]
  }
}

export async function collectDependencies(
  context: TransformPluginContext,
  node: t.Node,
  importer: string,
  namespaceStmts: NamespaceMap,
  children: Set<t.Node>,
  identifierMap: Record<string, number>,
  params: TypeParams,
): Promise<{
  deps: Dep[]
  /** Bit set of `Meaning` for each dependency, what it has to refer to */
  meanings: number[]
  /** The left-most identifier of each dependency, as written */
  roots: Array<DepRoot | undefined>
  namespace?: NamespaceScope
}> {
  const deps = new Set<Dep>()
  const meanings = new Map<Dep, number>()
  const roots = new Map<Dep, DepRoot>()
  const members = collectNamespaceMembers(node, params)
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
            addDependency(specifier.local, Meaning.Any)
          }
        }
      } else if (node.type === 'TSInterfaceDeclaration' && node.extends) {
        for (const heritage of node.extends || []) {
          addDependency(heritage.expression, Meaning.Type)
        }
      } else if (node.type === 'ClassDeclaration') {
        if (node.superClass) addDependency(node.superClass, Meaning.Value)
        if (node.implements) {
          for (const implement of node.implements) {
            addDependency(implement.expression, Meaning.Type)
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
          addDependency(node.key, Meaning.Value)
        }
        if ('value' in node && isReferenceId(node.value)) {
          addDependency(node.value, Meaning.Value)
        }
      } else {
        switch (node.type) {
          case 'TSTypeReference': {
            addDependency(TSEntityNameToRuntime(node.typeName), Meaning.Type)
            break
          }
          case 'TSQualifiedName': {
            addDependency(getIdFromTSEntityName(node.left), QUALIFIER_MEANING)
            break
          }
          case 'TSTypeQuery': {
            if (seen.has(node.exprName)) return
            if (node.exprName.type === 'TSImportType') break

            addDependency(TSEntityNameToRuntime(node.exprName), Meaning.Value)

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
            if (dep) addDependency(dep, Meaning.Type)
            break
          }
        }
      }

      if (parent && !deps.has(node as Dep) && isChildSymbol(node, parent)) {
        children.add(node)
      }
    },
  })

  const result = Array.from(deps)
  return {
    deps: result,
    meanings: result.map((dep) => meanings.get(dep)!),
    roots: result.map((dep) => roots.get(dep)),
    namespace:
      members.size && isNamespaceWithBody(node)
        ? {
            body: [...node.body.body],
            members: Array.from(members.values()),
          }
        : undefined,
  }

  function addDependency(node: Dep, meaning: number) {
    if (isThisExpression(node) || isInferred(node)) return

    const root = getRootIdentifier(node)
    const rootMeaning = root === node ? meaning : QUALIFIER_MEANING
    const member = root && members.get(root.name)
    if (member && member.meaning & rootMeaning) {
      // refers to a member of the namespace, not to anything around it
      member.references.add(root)
      return
    }

    deps.add(node)
    meanings.set(node, meaning)
    if (root) roots.set(node, { name: root.name, meaning: rootMeaning })
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
