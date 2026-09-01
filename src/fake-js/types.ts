import type * as t from 'yuku-parser'

export type Dep = t.Expression & { replace?: (newNode: t.Node) => void }

/**
 * A collection of type parameters grouped by parameter name
 */
export type TypeParams = Array<{
  name: string
  typeParams: t.Identifier[]
}>

export interface DeclarationInfo {
  decl: t.Declaration
  bindings: t.Identifier[]
  params: TypeParams
  deps: Dep[]
  children: t.Node[]
  /** How the declaration was exported in the source file, if it was */
  exportType?: InlineExportKind
  /** The comments attached to the declaration, as parsed */
  comments?: t.AttachedComment[]
}

export interface ModuleExports {
  typeOnlyLocals: Set<string>
  exports: Map<string, boolean>
  reExports: ReExportInfo[]
  exportAlls: ExportAllInfo[]
}

export interface ReExportInfo {
  source?: string
  local: string
  exported: string
  typeOnly: boolean
}

export interface ExportAllInfo {
  source?: string
  rawSource: string
  typeOnly: boolean
}

export interface ChunkExportPlan {
  /** Names the chunk exports as types only, `export type { x }` */
  typeOnlyNames: Set<string>
  typeOnlyExportAllSources: Set<string>
  /** Declaration id to the `export` form the declaration gets back */
  inlineKinds: Map<number, InlineExportKind>
  /** Whether `export = x` may still be emitted for the `cjsDefault` option */
  allowExportAssignment: boolean
}

export type NamespaceMap = Map<
  string,
  {
    stmt: t.ProgramStatement
    local: t.Identifier | t.TSQualifiedName
  }
>

/** How a declaration was exported in its source file */
export type InlineExportKind = 'named' | 'default'
