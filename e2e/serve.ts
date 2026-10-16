import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The viewer spec's port; the performance spec uses E2E_PORT + 1. */
export const E2E_PORT = Number(process.env.DEPGRAPH_VIEW_E2E_PORT ?? 4390)

const BIN = fileURLToPath(new URL('../bin/depgraph-view.js', import.meta.url))

/**
 * Starts the built CLI on `dir` at `port`. Resolves with the URL it prints; rejects with its stderr if it exits first.
 * `stop` sends SIGTERM and waits for the process to exit.
 */
export function serve(dir: string, port: number): Promise<{ url: string; stop(): Promise<void> }> {
  const child = spawn(process.execPath, [BIN, dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<void>(done => child.once('exit', () => done()))
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
  }
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk })
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk
      const url = out.split('\n').find(line => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(line))
      if (url) resolve({ url, stop })
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`depgraph-view exited with code ${code} before serving: ${err.trim()}`)))
  })
}
