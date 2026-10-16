import type { NetworkInterfaceInfo } from 'node:os'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const WILDCARD = new Set(['0.0.0.0', '::', '[::]'])

/** Whether `host` (a bind address or name) is this machine only: `127.0.0.1`, `localhost`, `::1` or `[::1]`. */
export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase())
}

/** `host` as it goes in a URL: an IPv6 literal in brackets, anything else as is. */
function urlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

/**
 * The URLs to print for a server bound to `host` on `port`, the first one being the one to open. A wildcard
 * bind (`0.0.0.0`, `::`) lists every non-internal IPv4 address in `interfaces` (the shape of
 * `os.networkInterfaces()`), or `127.0.0.1` when there is none; any other host is named as is.
 */
export function serverUrls({ host, port, interfaces }: { host: string; port: number; interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> }): string[] {
  const url = (h: string) => `http://${urlHost(h)}:${port}/`
  if (!WILDCARD.has(host)) return [url(host)]
  const lan = Object.values(interfaces)
    .flatMap(list => list ?? [])
    .filter(i => !i.internal && (i.family === 'IPv4' || (i.family as unknown) === 4))
    .map(i => url(i.address))
  return lan.length > 0 ? lan : [url('127.0.0.1')]
}
