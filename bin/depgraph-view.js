#!/usr/bin/env node
import { run } from '../lib/cli/main.js'

const io = { out: line => console.log(line), err: line => console.error(line) }
const { code, server } = await run(process.argv.slice(2), io)
if (code !== 0 || !server) process.exit(code)

let closing = false
const stop = async () => {
  if (closing) return
  closing = true
  await server.close().catch(() => {}) // exit 0 regardless: nothing is left to save on shutdown
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
