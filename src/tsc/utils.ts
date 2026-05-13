import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { ExistingRawSourceMap } from 'rolldown'

/**
 * Host object required by TypeScript's
 * {@linkcode ts.formatDiagnostics | formatDiagnostics()} API.
 */
export const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
}

/**
 * Rewrites private-identifier property signatures to string-literal keys so
 * that the TypeScript declaration emitter does not produce invalid `.d.ts`
 * output.
 *
 * @see {@link https://github.com/sxzz/rolldown-plugin-dts/issues/77 | Issue #77}
 */
const stripPrivateFields: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = (
  ctx,
) => {
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
    return ts.visitEachChild(node, visitor, ctx)
  }
  return (sourceFile) =>
    ts.visitNode(sourceFile, visitor, ts.isSourceFile) ?? sourceFile
}

/**
 * Custom TypeScript transformers applied during declaration emit.
 * Includes a transformer that replaces private-identifier property signatures
 * with string literals to avoid invalid output in declaration files.
 */
export const customTransformers: ts.CustomTransformers = {
  afterDeclarations: [stripPrivateFields],
}

/**
 * Sets the {@linkcode ExistingRawSourceMap.sourceRoot | sourceRoot} of a
 * source map so that {@linkcode ExistingRawSourceMap.sources | sources} paths
 * remain correct when the output directory used by `tsc` differs from the
 * directory where `rolldown-plugin-dts` finally writes the file.
 *
 * @param map - The raw source map to mutate. A no-op if `undefined` or if {@linkcode ExistingRawSourceMap.sourceRoot | sourceRoot} is already set.
 * @param originalFilePath - The path where `tsc` originally emitted the map.
 * @param finalFilePath - The path where `rolldown-plugin-dts` will write the map.
 */
export function setSourceMapRoot(
  map: ExistingRawSourceMap | undefined,
  originalFilePath: string,
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
