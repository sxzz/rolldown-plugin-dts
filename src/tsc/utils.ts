import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { ExistingRawSourceMap } from 'rolldown'

export const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
}

// Rewrite property signatures whose name is a private identifier (e.g. the
// `#private` marker tsc inlines into type literals) into string-literal names,
// so the emitted dts stays parseable by downstream tools.
// See https://github.com/sxzz/rolldown-plugin-dts/issues/77
const stripPrivateFields: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = (
  ctx,
) => {
  // Recursing with the live `ctx` crashes when a get/set accessor appears in a
  // type literal in a function-like node's return type, e.g.
  // `function makeBox(): { get value(): number }`.
  // See https://github.com/sxzz/rolldown-plugin-dts/issues/258
  //
  // `visitEachChild` visits a function-like node in this order: parameter
  // list, return type, body. Visiting the parameter list leaves the lexical
  // environment suspended until the body visit resumes it:
  // https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/visitorPublic.ts#L1429-L1440
  // https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/visitorPublic.ts#L416
  // So when the return type contains an accessor, visiting that accessor's own
  // parameter list calls `startLexicalEnvironment` while the environment is
  // still suspended and hits this assertion:
  // https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/transformer.ts#L483
  // Upstream bug: https://github.com/microsoft/TypeScript/issues/58020
  //
  // This transformer never hoists declarations, so it does not need the
  // lexical environment at all. TypeScript >= 5.4 allows opting out by passing
  // `undefined` as the context (https://github.com/microsoft/TypeScript/pull/52941):
  // https://github.com/microsoft/TypeScript/blob/v5.4.5/src/compiler/visitorPublic.ts#L597
  // But TypeScript 5.0 to 5.3, which the `typescript` peer dependency range
  // still allows, requires a real context and would throw
  // `TypeError: Cannot read properties of undefined (reading 'factory')`
  // on every recursion:
  // https://github.com/microsoft/TypeScript/blob/v5.3.3/src/compiler/visitorPublic.ts#L596
  // So instead, recurse with a copy of `ctx` whose lexical environment
  // lifecycle methods are no-ops. This is exactly what TypeScript >= 5.4
  // substitutes internally for an undefined context:
  // https://github.com/microsoft/TypeScript/blob/v6.0.3/src/compiler/transformer.ts#L669
  const recurseCtx: ts.TransformationContext = {
    ...ctx,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
  }
  const visitor = (node: ts.Node) => {
    if (ts.isPropertySignature(node) && ts.isPrivateIdentifier(node.name)) {
      return ctx.factory.updatePropertySignature(
        node,
        node.modifiers,
        ctx.factory.createStringLiteral(node.name.text),
        node.questionToken,
        node.type,
      )
    }
    return ts.visitEachChild(node, visitor, recurseCtx)
  }
  return (sourceFile) =>
    ts.visitNode(sourceFile, visitor, ts.isSourceFile) ?? sourceFile
}

export const customTransformers: ts.CustomTransformers = {
  afterDeclarations: [stripPrivateFields],
}

// Since the output directory of tsc and rolldown-plugin-dts might be different,
// we need to explicitly set the `sourceRoot` of the source map so that the
// final sourcemap has correct paths in `sources` field.
export function setSourceMapRoot(
  map: ExistingRawSourceMap | undefined,
  // The original path of the source map file (e.g. configured by tsconfig.json `outDir` and emitted by tsc)
  originalFilePath: string,
  // The final path of the source map file (e.g. emitted by rolldown-plugin-dts)
  finalFilePath: string,
): void {
  if (!map) {
    return
  }

  // Don't override the sourceRoot if it's already set.
  if (map.sourceRoot) {
    return
  }

  const originalDir = path.posix.dirname(
    pathToFileURL(originalFilePath).pathname,
  )
  const finalDir = path.posix.dirname(pathToFileURL(finalFilePath).pathname)
  if (originalDir !== finalDir) {
    map.sourceRoot = path.posix.relative(finalDir, originalDir)
  }
}
