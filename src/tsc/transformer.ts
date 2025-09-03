import ts from 'typescript'

// fix #77
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

export const customTransformers: ts.CustomTransformers = {
  afterDeclarations: [stripPrivateFields],
}
