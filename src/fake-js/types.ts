import type * as t from 'yuku-parser'

export type Dep = t.Expression & { replace?: (newNode: t.Node) => void }

/**
 * A collection of type parameters grouped by parameter name
 */
export type TypeParams = Array<{
  name: string
  typeParams: t.Identifier[]
}>

/**
 * The declaration spaces of TypeScript. A name can mean something different in
 * each of them, e.g. `var Foo: Foo` declares a value and refers to a type.
 */
export const Meaning = {
  Type: 1,
  Value: 2,
  Namespace: 4,
  Any: 7,
} as const

/**
 * `a` in `a.b` is a namespace, or a value in `typeof a.b`, but never a type
 */
export const QUALIFIER_MEANING: number = Meaning.Namespace | Meaning.Value

/** A name declared directly in the body of a namespace */
export interface NamespaceMember {
  name: string
  /** Bit set of `Meaning`, what the name means inside of the body */
  meaning: number
  /** The identifiers declaring the member */
  bindings: t.Identifier[]
  /** The identifiers inside of the body referring to the member */
  references: Set<t.Identifier>
}

export interface NamespaceScope {
  /** The statements of the body, as parsed */
  body: t.ProgramStatement[]
  members: NamespaceMember[]
}

export interface DeclarationInfo {
  decl: t.Declaration
  bindings: t.Identifier[]
  params: TypeParams
  deps: Dep[]
  /** Bit set of `Meaning` for each dependency, what it has to refer to */
  depMeanings: number[]
  children: t.Node[]
  /** The scope of a namespace declaring members, see `patchNamespaceMembers` */
  namespace?: NamespaceScope
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
