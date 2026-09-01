import { b, is, nameOf } from 'yuku-ast'
import { isRuntimeBindingVariableDeclaration } from './runtime-binding.ts'
import { getIdFromTSEntityName } from './utils.ts'
import type {
  ChunkExportPlan,
  DeclarationInfo,
  InlineExportKind,
  ModuleExports,
} from './types.ts'
import type { RenderedChunk, TransformPluginContext } from 'rolldown'
import type * as t from 'yuku-parser'

//#region Module exports

export async function collectModuleExports(
  context: TransformPluginContext,
  nodes: t.ProgramStatement[],
  id: string,
): Promise<ModuleExports> {
  const info: ModuleExports = {
    typeOnlyLocals: new Set(),
    exports: new Map(),
    reExports: [],
    exportAlls: [],
  }

  for (const node of nodes) {
    collectTypeOnlyLocals(node, info.typeOnlyLocals)
  }

  for (const node of nodes) {
    await collectExportInfo(context, node, id, info)
  }

  return info
}

function collectTypeOnlyLocals(
  node: t.ProgramStatement,
  typeOnlyLocals: Set<string>,
): void {
  if (node.type !== 'ImportDeclaration') return

  for (const specifier of node.specifiers) {
    if (
      node.importKind === 'type' ||
      ('importKind' in specifier && specifier.importKind === 'type')
    ) {
      typeOnlyLocals.add(specifier.local.name)
    }
  }
}

function collectDeclarationNames(node: t.Node): string[] {
  if (node.type === 'VariableDeclaration') {
    return node.declarations.flatMap((decl) => collectPatternNames(decl.id))
  }

  if ('id' in node && node.id) {
    if (node.id.type !== 'Identifier' && node.id.type !== 'TSQualifiedName') {
      return []
    }

    const id = getIdFromTSEntityName(node.id)
    return id.type === 'Identifier' ? [id.name] : []
  }

  return []
}

function collectPatternNames(node: t.Node | null | undefined): string[] {
  if (!node) return []

  if (node.type === 'Identifier') {
    return [node.name]
  }

  if (node.type === 'RestElement') {
    return collectPatternNames(node.argument)
  }

  if (node.type === 'AssignmentPattern') {
    return collectPatternNames(node.left)
  }

  if (node.type === 'ArrayPattern') {
    return node.elements.flatMap((element) => collectPatternNames(element))
  }

  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap((property) => {
      if (property.type === 'RestElement') {
        return collectPatternNames(property.argument)
      }
      return collectPatternNames(property.value)
    })
  }

  return []
}

function isTypeOnlyExport(
  node: t.ExportNamedDeclaration,
  specifier: t.ExportSpecifier,
): boolean {
  return node.exportKind === 'type' || specifier.exportKind === 'type'
}

async function collectExportInfo(
  context: TransformPluginContext,
  node: t.ProgramStatement,
  id: string,
  info: ModuleExports,
): Promise<void> {
  if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration) {
      for (const name of collectDeclarationNames(node.declaration)) {
        info.exports.set(name, false)
      }
      return
    }

    const source = await resolveExportSource(context, node.source, id)
    for (const specifier of node.specifiers) {
      const typeOnly = isTypeOnlyExport(node, specifier)

      const exported = nameOf(specifier.exported)!
      const local = nameOf(specifier.local)!
      if (source) {
        info.reExports.push({ source, local, exported, typeOnly })
      } else {
        info.exports.set(exported, typeOnly || info.typeOnlyLocals.has(local))
      }
    }
    return
  }

  if (node.type === 'ExportDefaultDeclaration') {
    info.exports.set('default', false)
    return
  }

  if (node.type === 'ExportAllDeclaration') {
    if (node.exported) {
      info.exports.set(nameOf(node.exported)!, node.exportKind === 'type')
      return
    }

    info.exportAlls.push({
      source: await resolveExportSource(context, node.source, id),
      rawSource: node.source.value,
      typeOnly: node.exportKind === 'type',
    })
  }
}

async function resolveExportSource(
  context: TransformPluginContext,
  source: t.StringLiteral | null | undefined,
  importer: string,
): Promise<string | undefined> {
  if (!source) return

  const resolved = await context.resolve(source.value, importer)
  if (!resolved || resolved.external) return

  return resolved.id
}

// #endregion

//#region Chunk export plan

interface ChunkExports {
  typeOnlyNames: Set<string>
  typeOnlyExportAllSources: Set<string>
  /**
   * Names the chunk exports as values, the only ones that may be attached back
   * to their declaration. A type only export has to stay a specifier to keep
   * its `type` modifier.
   */
  inlineNames: Set<string>
}

/**
 * Resolves what the chunk exports and how each export is emitted: which names
 * are type only, and which declarations get their `export` keyword back.
 */
export function planChunkExports(
  chunk: RenderedChunk,
  moduleExportsMap: Map<string, ModuleExports>,
  nodes: t.ProgramStatement[],
  getDeclaration: (declarationId: number) => DeclarationInfo,
  cjsDefault: boolean,
): ChunkExportPlan {
  const { typeOnlyNames, typeOnlyExportAllSources, inlineNames } =
    collectChunkExports(chunk, moduleExportsMap)
  const { kinds, allowExportAssignment } = planInlineExports(
    nodes,
    inlineNames,
    getDeclaration,
    cjsDefault,
  )

  return {
    typeOnlyNames,
    typeOnlyExportAllSources,
    inlineKinds: kinds,
    allowExportAssignment,
  }
}

function collectChunkExports(
  chunk: RenderedChunk,
  moduleExportsMap: Map<string, ModuleExports>,
): ChunkExports {
  const exportsByModule = resolveAllModuleExports(moduleExportsMap)
  const roots =
    chunk.facadeModuleId && moduleExportsMap.has(chunk.facadeModuleId)
      ? [chunk.facadeModuleId]
      : chunk.moduleIds
  const mergedExports = new Map<string, boolean>()
  const typeOnlyExportAllSources = new Set<string>()

  for (const root of roots) {
    const exports = exportsByModule.get(root)
    if (exports) {
      for (const [name, typeOnly] of exports) {
        setExportTypeOnly(mergedExports, name, typeOnly)
      }
    }

    const moduleExports = moduleExportsMap.get(root)
    if (!moduleExports) continue

    for (const exportAll of moduleExports.exportAlls) {
      if (!exportAll.typeOnly || exportAll.source) continue
      typeOnlyExportAllSources.add(exportAll.rawSource)
    }
  }

  const typeOnlyNames = new Set<string>()
  const inlineNames = new Set<string>()
  for (const [name, typeOnly] of mergedExports) {
    if (typeOnly) typeOnlyNames.add(name)
    else inlineNames.add(name)
  }

  return { typeOnlyNames, typeOnlyExportAllSources, inlineNames }
}

function resolveAllModuleExports(
  moduleExportsMap: Map<string, ModuleExports>,
): Map<string, Map<string, boolean>> {
  const exportsByModule = new Map<string, Map<string, boolean>>()

  for (const [id, info] of moduleExportsMap) {
    exportsByModule.set(id, new Map(info.exports))
  }

  let changed = true
  while (changed) {
    changed = false

    for (const [id, info] of moduleExportsMap) {
      const exports = exportsByModule.get(id)!

      for (const reExport of info.reExports) {
        const sourceExports = reExport.source
          ? exportsByModule.get(reExport.source)
          : undefined
        const sourceTypeOnly = sourceExports?.get(reExport.local) ?? false
        if (
          setExportTypeOnly(
            exports,
            reExport.exported,
            reExport.typeOnly || sourceTypeOnly,
          )
        ) {
          changed = true
        }
      }

      for (const exportAll of info.exportAlls) {
        if (!exportAll.source) continue

        const sourceExports = exportsByModule.get(exportAll.source)
        if (!sourceExports) continue

        for (const [name, typeOnly] of sourceExports) {
          if (name === 'default') continue
          if (
            setExportTypeOnly(exports, name, exportAll.typeOnly || typeOnly)
          ) {
            changed = true
          }
        }
      }
    }
  }

  return exportsByModule
}

function setExportTypeOnly(
  exports: Map<string, boolean>,
  name: string,
  typeOnly: boolean,
): boolean {
  const current = exports.get(name)
  if (current === false || current === typeOnly) return false

  if (current === undefined || !typeOnly) {
    exports.set(name, typeOnly)
    return true
  }

  return false
}

// #endregion

//#region Inline export

interface InlineExportPlan {
  /** Declaration id to the `export` form the declaration gets back */
  kinds: Map<number, InlineExportKind>
  /** Whether `export = x` may still be emitted for the `cjsDefault` option */
  allowExportAssignment: boolean
}

interface LocalExport {
  local: string
  typeOnly: boolean
  specifier: t.ExportSpecifier
}

/**
 * Collects the `export { local as exported }` statements of a chunk, i.e. the
 * exports that could be attached back to their declaration. Re-exports
 * (`export { x } from '...'`) are not local and therefore skipped.
 */
function getLocalExportsMap(
  nodes: t.ProgramStatement[],
): Map<string /* exported */, LocalExport> {
  const exportsMap = new Map<string, LocalExport>()

  for (const node of nodes) {
    if (
      node.type !== 'ExportNamedDeclaration' ||
      node.declaration ||
      node.source
    ) {
      continue
    }

    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ExportSpecifier') continue

      exportsMap.set(nameOf(specifier.exported), {
        local: nameOf(specifier.local),
        typeOnly: node.exportKind === 'type' || specifier.exportKind === 'type',
        specifier,
      })
    }
  }

  return exportsMap
}

/**
 * Decides which declarations get their `export` keyword back, so that a
 * declaration written as `export declare const x` is emitted as
 * `export declare const x` instead of `declare const x` + `export { x }`.
 *
 * A declaration qualifies only if it was exported inline in its own source
 * file, the chunk exports it as a value under its own name, and every
 * declaration it merges with qualifies as well. The specifiers of the
 * re-attached exports are removed here, before `patchImportExport` runs, so
 * that both stay in sync.
 */
function planInlineExports(
  nodes: t.ProgramStatement[],
  inlineNames: Set<string>,
  getDeclaration: (declarationId: number) => DeclarationInfo,
  cjsDefault: boolean,
): InlineExportPlan {
  const exportsMap = getLocalExportsMap(nodes)
  const allowExportAssignment = hasOnlyDefaultExport(nodes)
  const kinds = new Map<number, InlineExportKind>()
  const removed = new Set<t.ExportSpecifier>()

  // declarations of the chunk, and the names they bind after bundling
  const declNames = new Map<number /* declaration id */, string[]>()
  const nameDecls = new Map<string, number[] /* declaration ids */>()
  for (const node of nodes) {
    if (!isRuntimeBindingVariableDeclaration(node)) continue

    const { id, init } = node.declarations[0]
    const declarationId = init.elements[0].value as number
    const names = (id.elements as t.Identifier[]).map(({ name }) => name)

    declNames.set(declarationId, names)
    for (const name of names) {
      const decls = nameDecls.get(name)
      if (decls) decls.push(declarationId)
      else nameDecls.set(name, [declarationId])
    }
  }

  const named = new Set<number>()
  for (const [declarationId, names] of declNames) {
    if (getDeclaration(declarationId).exportType !== 'named') continue
    if (names.every(isInlinableName)) named.add(declarationId)
  }

  // Merged declarations — overloads, `function` + `namespace`, ... — share a
  // name and a single export specifier. TypeScript requires all of them to be
  // exported or all of them to be local, so keep a group only if every
  // declaration of it qualifies.
  let changed = true
  while (changed) {
    changed = false

    for (const declarationId of named) {
      const complete = declNames
        .get(declarationId)!
        .every((name) => nameDecls.get(name)!.every((id) => named.has(id)))
      if (!complete) {
        named.delete(declarationId)
        changed = true
      }
    }
  }

  for (const declarationId of named) {
    kinds.set(declarationId, 'named')
    for (const name of declNames.get(declarationId)!) {
      removed.add(exportsMap.get(name)!.specifier)
    }
  }

  const defaultExport = exportsMap.get('default')
  if (
    defaultExport &&
    !defaultExport.typeOnly &&
    inlineNames.has('default') &&
    // `export = x` wins over `export default x`
    (!cjsDefault || !allowExportAssignment)
  ) {
    for (const [declarationId, names] of declNames) {
      const declaration = getDeclaration(declarationId)
      if (
        declaration.exportType !== 'default' ||
        names.length !== 1 ||
        names[0] !== defaultExport.local ||
        // a merged declaration cannot be exported as `export default`
        nameDecls.get(names[0])!.length !== 1 ||
        !isInlinableDefaultDeclaration(declaration.decl)
      ) {
        continue
      }

      kinds.set(declarationId, 'default')
      removed.add(defaultExport.specifier)
      break
    }
  }

  if (removed.size) {
    for (const node of nodes) {
      if (node.type !== 'ExportNamedDeclaration') continue

      node.specifiers = node.specifiers.filter(
        (specifier) => !removed.has(specifier),
      )
    }
  }

  return { kinds, allowExportAssignment }

  function isInlinableName(name: string): boolean {
    if (!inlineNames.has(name)) return false

    // the declaration has to be exported under its own name, an alias such as
    // `export { x as y }` has to stay a specifier
    const exported = exportsMap.get(name)
    return !!exported && exported.local === name && !exported.typeOnly
  }
}

/** Whether `default` is the only name the chunk exports */
function hasOnlyDefaultExport(nodes: t.ProgramStatement[]): boolean {
  let hasDefault = false

  for (const node of nodes) {
    if (node.type === 'ExportAllDeclaration') return false
    if (node.type === 'ExportDefaultDeclaration') {
      hasDefault = true
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration) return false

    for (const specifier of node.specifiers) {
      if (nameOf(specifier.exported) !== 'default') return false
      hasDefault = true
    }
  }

  return hasDefault
}

/** `export default` only accepts a class, function or interface declaration */
function isInlinableDefaultDeclaration(node: t.Node): boolean {
  return is.oneOf(node, [
    'ClassDeclaration',
    'FunctionDeclaration',
    'TSDeclareFunction',
    'TSInterfaceDeclaration',
  ])
}

export function inlineExportDeclaration(
  decl: t.Declaration,
  kind: InlineExportKind,
): t.ProgramStatement {
  if (kind === 'default' && 'declare' in decl) {
    // `export default declare class X {}` is invalid
    decl.declare = false
  }

  const exported: t.ProgramStatement =
    kind === 'default'
      ? b.ExportDefaultDeclaration({
          declaration: decl as t.ExportDefaultDeclarationKind,
        })
      : b.ExportNamedDeclaration({
          declaration: decl,
          specifiers: [],
          source: null,
          attributes: [],
        })

  // the comments have to lead the `export` keyword, TypeScript ignores a doc
  // comment sitting between `export` and the declaration
  exported.comments = decl.comments
  decl.comments = undefined

  return exported
}

// #endregion
