import { describe, it, expect } from 'vitest'
import net from 'net'
import { httpFetch } from '../src/main/services/http'

/**
 * Fake SOCKS5 proxy: completes greeting/handshake, answers CONNECT with
 * success for any target, and serves a canned HTTP response exactly once on
 * the first request bytes sent through the tunnelled socket.
 */
function startFakeSocks(httpResponse: string): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((c) => {
      let stage = 0
      let responded = 0
      c.on('data', (chunk: Buffer) => {
        if (stage === 0) { stage = 1; c.write(Buffer.from([0x05, 0x00])); return }
        if (stage === 1) { stage = 2; c.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); return }
        if (responded === 0) { responded = 1; c.write(Buffer.from(httpResponse)) }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('socks5Connect tunnelling', () => {
  it('keeps the tunnel socket alive after handshake for plain http', async () => {
    const body = '<html>ok</html>'
    const response = `HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: ${body.length}\r\n\r\n${body}`
    const server = await startFakeSocks(response)
    try {
      const r = await httpFetch({ url: 'http://example.invalid/search/?q=x&page=1', timeoutMs: 15_000 }, `127.0.0.1:${(server.address() as net.AddressInfo).port}`)
      expect(r.status).toBe(200)
      expect(r.text).toBe(body)
    } finally {
      server.close()
    }
  })
})
