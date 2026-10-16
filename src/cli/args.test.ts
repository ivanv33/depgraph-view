import { describe, expect, it } from 'vitest'
import { parseArgs, USAGE } from './args.js'
import { browserCommand } from './open.js'

describe('parseArgs', () => {
  it('parses flags in any order', () => {
    expect(parseArgs(['--open', 'plan.yaml', '--port', '4400', '--no-watch'])).toEqual({ path: 'plan.yaml', port: 4400, open: true, watch: false })
    expect(parseArgs(['plan.yaml'])).toEqual({ path: 'plan.yaml', open: false, watch: true })
  })
  it('takes port 0 and 65535', () => {
    expect(parseArgs(['p.yaml', '--port', '0'])).toEqual({ path: 'p.yaml', port: 0, open: false, watch: true })
    expect(parseArgs(['--port', '65535', 'p.yaml'])).toEqual({ path: 'p.yaml', port: 65535, open: false, watch: true })
  })
  it('rejects a missing path, a bad port and unknown flags', () => {
    for (const a of [[], ['p.yaml', '--port', 'x'], ['p.yaml', '--port', '70000'], ['p.yaml', '--port', '-1'], ['p.yaml', '--port', '4.5'], ['p.yaml', '--port'], ['p.yaml', '--watch-me'], ['a.yaml', 'b.yaml']])
      expect(parseArgs(a)).toHaveProperty('error')
  })
  it('takes --host with any non-empty value and leaves it out by default', () => {
    expect(parseArgs(['p.yaml', '--host', '0.0.0.0'])).toEqual({ path: 'p.yaml', host: '0.0.0.0', open: false, watch: true })
    expect(parseArgs(['--host', '::', 'p.yaml', '--port', '0'])).toEqual({ path: 'p.yaml', host: '::', port: 0, open: false, watch: true })
    expect(parseArgs(['p.yaml'])).not.toHaveProperty('host')
  })
  it('rejects --host without a value', () => {
    for (const a of [['p.yaml', '--host'], ['p.yaml', '--host', '']]) expect(parseArgs(a)).toHaveProperty('error')
  })
  it('lists --host in the usage', () => {
    expect(USAGE).toContain('[--host ADDR]')
    expect(USAGE).toMatch(/--host ADDR\s+.*127\.0\.0\.1/)
  })
  it('describes the path as a plan YAML file or its folder', () => {
    expect(USAGE).toContain('<path>       a plan YAML file, or a folder holding it')
  })
  it('answers -h and --help with the usage', () => {
    expect(parseArgs(['-h'])).toEqual({ help: USAGE })
    expect(parseArgs(['p.yaml', '--help'])).toEqual({ help: USAGE })
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
