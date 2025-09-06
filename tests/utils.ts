import type { ExistingRawSourceMap, RolldownOutput } from 'rolldown'

/**
 * Find and parse a source map from the output chunks
 */
export function findSourceMapChunk(
  chunks: RolldownOutput['output'],
  fileName: string,
): ExistingRawSourceMap {
  const chunk = chunks.find((chunk) => chunk.fileName === fileName)

  if (!chunk) {
    throw new Error(
      `Unable to find file ${fileName} from the following chunks: ${chunks.map((chunk) => chunk.fileName).join(', ')}`,
    )
  }

  if (chunk.type !== 'asset') {
    throw new Error('Sourcemap chunk is not an asset')
  }

  if (typeof chunk.source !== 'string') {
    throw new TypeError('Sourcemap chunk source is not a string')
  }

  const map = JSON.parse(chunk.source) as ExistingRawSourceMap
  return map
}
