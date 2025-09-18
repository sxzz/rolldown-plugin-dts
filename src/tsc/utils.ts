import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ts, type Ts } from './require-tsc.ts'
import type { ExistingRawSourceMap } from 'rolldown'

export const formatHost: Ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
}

// fix #77
const stripPrivateFields: Ts.TransformerFactory<Ts.SourceFile | Ts.Bundle> = (
  ctx,
) => {
  const visitor = (node: Ts.Node) => {
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

export const customTransformers: Ts.CustomTransformers = {
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
