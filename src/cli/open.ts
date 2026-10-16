import { spawn } from 'node:child_process'

/** The command that opens `url` in the default browser on `platform`. */
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]]
  return ['xdg-open', [url]]
}

/** Opens `url` in the default browser without waiting for it; a missing opener is ignored. */
export function openBrowser(url: string): void {
  const [command, args] = browserCommand(process.platform, url)
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}
