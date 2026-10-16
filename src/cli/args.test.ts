import { describe, expect, it } from 'vitest'
import { parseArgs, USAGE } from './args.js'
import { browserCommand } from './open.js'

describe('parseArgs', () => {
  it('parses flags in any order', () => {
    expect(parseArgs(['--open', 'plan.json', '--port', '4400', '--no-watch'])).toEqual({ path: 'plan.json', port: 4400, open: true, watch: false })
    expect(parseArgs(['plan.json'])).toEqual({ path: 'plan.json', open: false, watch: true })
  })
  it('takes port 0 and 65535', () => {
    expect(parseArgs(['p.json', '--port', '0'])).toEqual({ path: 'p.json', port: 0, open: false, watch: true })
    expect(parseArgs(['--port', '65535', 'p.json'])).toEqual({ path: 'p.json', port: 65535, open: false, watch: true })
  })
  it('rejects a missing path, a bad port and unknown flags', () => {
    for (const a of [[], ['p.json', '--port', 'x'], ['p.json', '--port', '70000'], ['p.json', '--port', '-1'], ['p.json', '--port', '4.5'], ['p.json', '--port'], ['p.json', '--watch-me'], ['a.json', 'b.json']])
      expect(parseArgs(a)).toHaveProperty('error')
  })
  it('answers -h and --help with the usage', () => {
    expect(parseArgs(['-h'])).toEqual({ help: USAGE })
    expect(parseArgs(['p.json', '--help'])).toEqual({ help: USAGE })
  })
})

describe('browserCommand', () => {
  it('picks the browser command per platform', () => {
    const url = 'http://127.0.0.1:4310/'
    expect(browserCommand('darwin', url)).toEqual(['open', [url]])
    expect(browserCommand('win32', url)).toEqual(['cmd', ['/c', 'start', '', url]])
    expect(browserCommand('linux', url)).toEqual(['xdg-open', [url]])
  })
})
