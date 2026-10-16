import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { isLoopback, serverUrls } from './urls.js'

const nic = (address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: '', mac: '00:00:00:00:00:00', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo

const LAN = {
  lo0: [nic('127.0.0.1', 'IPv4', true), nic('::1', 'IPv6', true)],
  en0: [nic('fe80::1', 'IPv6'), nic('192.168.1.20', 'IPv4')],
  en1: [nic('10.0.0.5', 'IPv4')],
}

describe('isLoopback', () => {
  it('is true for the loopback names only', () => {
    for (const h of ['127.0.0.1', 'localhost', 'LocalHost', '::1', '[::1]']) expect(isLoopback(h), h).toBe(true)
    for (const h of ['0.0.0.0', '::', '192.168.1.20', 'box.local', '127.0.0.2']) expect(isLoopback(h), h).toBe(false)
  })
})

describe('serverUrls', () => {
  it('gives the loopback URL for a loopback bind', () => {
    expect(serverUrls({ host: '127.0.0.1', port: 4310, interfaces: LAN })).toEqual(['http://127.0.0.1:4310/'])
    expect(serverUrls({ host: '::1', port: 4310, interfaces: LAN })).toEqual(['http://[::1]:4310/'])
  })
  it('lists every non-internal IPv4 address for a wildcard bind, first one first', () => {
    for (const host of ['0.0.0.0', '::'])
      expect(serverUrls({ host, port: 4398, interfaces: LAN }), host).toEqual(['http://192.168.1.20:4398/', 'http://10.0.0.5:4398/'])
  })
  it('falls back to 127.0.0.1 for a wildcard bind without a LAN address', () => {
    expect(serverUrls({ host: '0.0.0.0', port: 4398, interfaces: { lo0: LAN.lo0, none: undefined } })).toEqual(['http://127.0.0.1:4398/'])
    expect(serverUrls({ host: '::', port: 4398, interfaces: {} })).toEqual(['http://127.0.0.1:4398/'])
  })
  it('names a specific host as given, bracketing an IPv6 literal', () => {
    expect(serverUrls({ host: '192.168.1.20', port: 80, interfaces: LAN })).toEqual(['http://192.168.1.20:80/'])
    expect(serverUrls({ host: 'box.local', port: 80, interfaces: LAN })).toEqual(['http://box.local:80/'])
    expect(serverUrls({ host: 'fe80::1', port: 80, interfaces: LAN })).toEqual(['http://[fe80::1]:80/'])
    expect(serverUrls({ host: '[fe80::1]', port: 80, interfaces: LAN })).toEqual(['http://[fe80::1]:80/'])
  })
})
