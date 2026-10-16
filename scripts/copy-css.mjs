// tsc emits no CSS: copy the two stylesheets a host imports into lib/view/ next to the modules that use them.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(join(repo, 'lib/view'), { recursive: true })
for (const file of ['labels.css', 'deckList.css']) copyFileSync(join(repo, 'src/view', file), join(repo, 'lib/view', file))
