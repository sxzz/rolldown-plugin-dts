// Minimal identity mapper: .component files contain TypeScript.
let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1],
    )
    if (buffer.length < end + 4 + length) return
    const request = JSON.parse(
      buffer.subarray(end + 4, end + 4 + length).toString(),
    )
    buffer = buffer.subarray(end + 4 + length)
    if (request.id === undefined) continue
    let result = {}
    if (request.method === 'initialize') {
      result = { positionEncoding: 'utf-16', diagnosticSource: 'test-mapper' }
    } else if (request.method === 'transform') {
      const text = request.params.content
      if (text.includes('MAPPER_ERROR')) {
        respond({
          id: request.id,
          error: { code: -32603, message: 'Test mapper failed' },
        })
        continue
      }
      result = {
        text,
        extension: '.ts',
        mappings: [[0, text.length, 0, text.length, 0, 0]],
      }
      if (text.includes('MAPPER_DIAGNOSTIC')) {
        result.diagnostics = [
          {
            code: 1005,
            messageText: 'Test mapper diagnostic',
            start: 0,
            length: 0,
          },
        ]
      }
    }
    respond({ id: request.id, result })
  }
})
function respond(response) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...response }))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}
