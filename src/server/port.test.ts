import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { findPort } from './port.js'

it('skips a port that is taken', async () => {
  const held = createServer()
  await new Promise<void>(resolve => held.listen(0, '127.0.0.1', resolve))
  const p = (held.address() as AddressInfo).port
  try {
    expect(await findPort(p)).toBeGreaterThan(p)
  } finally {
    await new Promise<void>(resolve => held.close(() => resolve()))
  }
})
