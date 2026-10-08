import { describe, it, expect } from 'vitest';
import { createServer } from 'net';
import { parseBridgeAddr, probeBridgeLine, probeSocks5Handshake } from '../src/main/services/tor-check';

describe('parseBridgeAddr', () => {
  it('extracts ip:port from obfs4 bridge line', () => {
    const a = parseBridgeAddr('obfs4 192.0.2.1:443 FINGERPRINT cert=abc iat-mode=0');
    expect(a).toEqual({ host: '192.0.2.1', port: 443 });
  });
  it('parses bare ip:port', () => {
    expect(parseBridgeAddr('192.0.2.1:443')).toEqual({ host: '192.0.2.1', port: 443 });
  });
  it('returns null for garbage', () => {
    expect(parseBridgeAddr('not a bridge')).toBeNull();
  });
});

describe('probeSocks5Handshake', () => {
  it('returns connected on valid SOCKS5 greeting response', async () => {
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.write(Buffer.from([0x05, 0x00]));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const res = await probeSocks5Handshake(`127.0.0.1:${port}`);
    expect(res.state).toBe('connected');
    server.close();
  });

  it('returns disconnected when nothing listens', async () => {
    const res = await probeSocks5Handshake('127.0.0.1:1');
    expect(res.state).toBe('disconnected');
  });
});

describe('probeBridgeLine', () => {
  it('reachable for an open port', async () => {
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const res = await probeBridgeLine(`bridge 127.0.0.1:${port} x`);
    expect(res.state).toBe('reachable');
    server.close();
  });
  it('unparsable for bad line', async () => {
    expect((await probeBridgeLine('garbage here')).state).toBe('unparsable');
  });
});
