# depgraph-view

A read-only 3D viewer for dependency graphs. Point it at a `graph.json` whose nodes name a markdown file each. It serves the graph on `127.0.0.1` as a force-directed, layered 3D view. You can pan, zoom, group branches, search steps by title or id, and open a step to read its markdown, its dependencies and the files in its folder. It follows the files on disk and reloads the page when they change. Nothing is ever written: there is no editing, no upload and no write route.

![The viewer showing an eleven-step garden plan as a layered graph, with the step "Spread compost on the beds" selected and its panel open on the right: the step's text and image, the steps it depends on and is needed by, and its two files](https://raw.githubusercontent.com/ivanv33/depgraph-view/main/docs/viewer.png)

## Quick start

```sh
npx depgraph-view garden/graph.json
```

The command prints one line, the URL, and serves until you stop it (Ctrl-C). Open the URL in a browser, or pass `--open`.

## Install

Node 20.19 or newer.

From npm, once:

```sh
npm i -g depgraph-view
depgraph-view garden
```

### Install from GitHub

```sh
npx github:ivanv33/depgraph-view#v0.1.0 garden
```

As a dependency in `package.json`:

```json
"depgraph-view": "github:ivanv33/depgraph-view#v0.1.0"
```

A git install builds the package from source, so it is slower than installing the npm package.

## CLI reference

```
depgraph-view <path> [--port N] [--open] [--no-watch]
```

| Argument | Meaning |
| --- | --- |
| `<path>` | A graph JSON file, or a folder holding exactly one `.json` file at its top level (usually `graph.json`). |
| `--port N` | Serve on port `N` (0–65535; `0` lets the OS pick). A port that is taken is an error. Without `--port`, the first free port from `4310` upward. |
| `--open` | Open the page in the default browser. Off by default. |
| `--no-watch` | Serve the graph as loaded, without following file changes. |
| `-h`, `--help` | Print the usage to stdout and exit with code `0`. |

On start the URL goes to stdout. Warnings from loading (see below) go to stderr as `warning: <text>`, and the page lists them too.

### Exit codes

| Code | When |
| --- | --- |
| `0` | The server started (and later stopped on SIGINT or SIGTERM), or `-h` / `--help` printed the usage. |
| `1` | The server could not start: invalid JSON, a graph the schema refuses, a missing path, a folder without exactly one `.json` file, or a `--port` that is in use. The message is printed to stderr as `depgraph-view: <message>`. |
| `2` | Usage error: no path, two paths, an unknown option or a bad `--port` value. The usage is printed to stderr. |

## The `graph.json` contract

The JSON file is an index. Each node points at a markdown file and, optionally, a folder of attached files. Paths are relative to the JSON file's folder (the root).

```json
{
  "name": "Spring garden",
  "nodes": [
    {
      "id": "plant-tomatoes",
      "md": "nodes/plant-tomatoes/plant-tomatoes.md",
      "dir": "nodes/plant-tomatoes.context",
      "depends_on": ["till-the-beds"]
    },
    {
      "id": "till-the-beds",
      "md": "nodes/till-the-beds/till-the-beds.md"
    }
  ]
}
```

`nodes/plant-tomatoes/plant-tomatoes.md`:

```markdown
---
title: Plant the tomatoes
status: todo
priority: high
due: 2026-05-10
tags: [vegetables]
---
Six seedlings along the south fence, 60 cm apart. See ![the bed plan](bed-plan.png).
```

### The JSON file

- `name` (string) is the page title. `nodes` is an array.
- A node that is not an object, an `md` or `dir` that is not a string, or a `depends_on` that is not an array of strings rejects the file.
- `id` matches `^[a-z0-9][a-z0-9-]*$` and is unique. A bad or duplicate id rejects the file.
- `md` (string) is required. `dir` (string) is optional. Both are relative to the root.
- A path that leaves the root, before or after resolving symlinks, drops that node with a warning.
- A missing `md` file drops the node with a warning. A missing `dir` keeps the node with no files and a warning.
- `depends_on` (array of ids) lives only in the JSON. An id that is not in the graph is dropped with a warning. A node that depends on itself, or a cycle, rejects the file.

### The md file

- The frontmatter (YAML between `---` lines) is optional. It supplies the step's fields:
  - `title`: text; defaults to the id.
  - `description`: text; defaults to empty.
  - `status`: `todo`, `doing`, `done` or `blocked`; defaults to `todo`.
  - `priority`: `low`, `normal` or `high`; absent means normal.
  - `tags`: array of strings.
  - `due`: a real date, `YYYY-MM-DD`.
  - `hold`: 1–200 characters saying why the step is not broken down yet.
- The same seven keys may also sit on the JSON node. The frontmatter wins over them. Other keys are ignored.
- A frontmatter key set to null (`title:` with no value) counts as absent. Its default applies, even over a value on the JSON node.
- A number or boolean `title` or `description` is read as text.
- These reject the file: a field with the wrong type or value, an unclosed frontmatter block, frontmatter that is not a mapping, a duplicate YAML key, or YAML that cannot be read.
- The md body below the frontmatter is the text shown in the step's panel. Relative links and images in it resolve against the step's folder: `dir` when given, else the md file's folder.

### The step's folder

The step's folder is listed as its files:

- sorted;
- `.git` and `node_modules` skipped;
- entries whose realpath leaves the folder skipped;
- at most 500, with a warning past that.

Give each step its own folder (as in the example) if you want its file list to hold only that step's files.

### Errors

At startup a rejected file ends the CLI with exit code 1. While watching, a change that makes the file invalid sends an `error` to the page. The page shows it in a dismissible banner, and the last good graph stays served.

## What the viewer shows

![The same garden plan with no step selected: eleven steps in layers, dependencies drawn as arrows, the toolbar top left and the legend bottom left](https://raw.githubusercontent.com/ivanv33/depgraph-view/main/docs/graph.png)

- **The graph.** Each step is a node with its title, laid out in layers along its dependencies. Click a step to select it. Click the background to clear the selection. Escape clears it too.
- **The toolbar** (top left) holds the search box and two buttons. `Group` draws only the path to the selection and its subtree, and folds every other branch into a deck. It is on by default, and the browser remembers your choice. `Fit` frames the whole plan and keeps the selection.
- **Search** matches steps by title or by id. Up and Down move the highlight, Enter or a click selects the step, and Escape clears the box.
- **The panel** (right) opens for the selected step. It shows the title, the readiness state, the priority, the due date and the tags when set, and the md body as markdown. Under it are the steps it depends on and the steps that need it, each a button that selects that step. Last is the step's file list. Each file opens in a new tab from `/files/<id>/<path>`.
- **The legend** (bottom left) counts the steps per readiness state (Ready, Doing, Waiting, Blocked, Done) and on hold, and explains the priority marks and the edge styles.
- **Warnings** from loading sit in a collapsed list in the bottom left corner.
- **`?step=<id>`.** The page keeps the selected step in the URL, so a link opens with that step selected.
- **Live reload.** Unless the CLI runs with `--no-watch`, the page follows the files and reloads the graph when they change.

## Routes and security

The server uses Node's `http` module and binds `127.0.0.1` only. It answers `GET` and `HEAD`; anything else is `405`. Every response carries `X-Content-Type-Options: nosniff`.

A request whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (with or without the port), or that has none, is refused with `403`. So a page on another origin cannot reach the server through DNS rebinding.

| Route | Serves |
| --- | --- |
| `GET /` | The viewer page, with a `Content-Security-Policy` that allows only its own origin (plus inline styles and `blob:`/`data:` images and workers). `/viewer.css` and `/assets/*` are its stylesheet and bundle. |
| `GET /api/graph` | JSON `{ plan, resources, warnings, bodies, generatedAt }`: the loaded plan, each step's file list, the load warnings, each step's markdown body and the load time. Sent with `Cache-Control: no-store`. |
| `GET /files/<id>/<path>` | A file from step `<id>`'s folder. The resolved path must stay inside that folder after resolving symlinks, else `404`. A path through a `.git` or `node_modules` folder is `404` too. The content type comes from a short extension allowlist (anything else is `application/octet-stream`). `.html` is sent as `text/plain`, and every file carries a sandboxing `Content-Security-Policy`. |
| `GET /events` | Server-sent events for live reload: `reload` (with `generatedAt`) after the files change, debounced to 150 ms, and `error` (with `message`) when a reload fails. A page that connects while the last reload has failed gets that `error` at once. The page refetches `/api/graph` on `reload` and whenever the stream reconnects. |

There are no write routes and no uploads, and no directory listing beyond each step's file list.

## Library use

The viewer's React components and the layout engine are exported for embedding in another React 19 app.

`react` and `react-dom` are pinned runtime dependencies at exactly `19.2.8`. The embedding app must resolve both at that same version. With any other 19.x, npm installs a second, nested React for this package, and its components fail with "Invalid hook call".

`viewer.css` carries Tailwind's preflight (a CSS reset) and page globals: the `body` font and `color-scheme: dark`. Importing it changes those for the whole embedding page.

```tsx
import { Graph, Panel, Search, Legend } from 'depgraph-view'
import 'depgraph-view/viewer.css'

<Graph
  plan={plan}
  selected={selected}
  onSelect={setSelected}
  grouped={false}
  today="2026-05-01"
  insets={{ top: 64, right: 0, bottom: 0, left: 0 }}
  fitAll={fitCount}
/>
```

### `Graph` props (`GraphProps`)

| Prop | Type | Meaning |
| --- | --- | --- |
| `plan` | `Plan` | `{ name, nodes }`, the shape `/api/graph` returns as `plan`. |
| `selected` | `string \| null` | The selected step's id. |
| `onSelect` | `(id: string \| null) => void` | Called on a click: a step's id, or `null` for the background. |
| `grouped` | `boolean` | Draw only the path to the selection and its subtree; other branches fold into decks. |
| `today` | `string` | The local date, `YYYY-MM-DD`, that due dates are read against. |
| `insets` | `{ top, right, bottom, left }` | How far the host's chrome (toolbar, panel) reaches in from each window edge, in CSS pixels. `Graph` never measures the host page. Whatever the insets say, `Graph` always keeps a 72 px top band clear and, on views at least 900 px wide, a 240 px left band for the Legend. |
| `fitAll` | `number` | Change it to frame the whole plan; the selection stays. |
| `onGlides` | `(history) => void` | Optional. Receives the transition timing history after each transition. |
| `focusFallback` | `() => HTMLElement \| null` | Optional. Where keyboard focus goes when no step label can take it. |

### The other components

- `Panel` (`PanelProps`: `plan`, `id`, `body`, `files`, `today`, `onSelect`, `onClose`) is the step panel.
- `Search` (`SearchProps`: `plan`, `today`, `onPick`) is the search box.
- `Legend` shows the counts per readiness state (Ready, Doing, Waiting, Blocked, Done) and on hold, plus the priority marks and the edge key.

### Two more entry points

- `depgraph-view/engine`: the layout, schema and label modules as namespaces, for example `schema` (`validatePlan`, `ID_RE`, the `Plan` types), `layered`, `grouping`, `graphData`, `camera`, `frame`. The label modules build DOM and need a browser `document`.
- `depgraph-view/server` (Node only):
  - `startServer({ path, port?, watch?, distDir? })` resolves to `{ url, port, warnings, close() }`.
  - `loadGraph(rootDir, json)` is the loader behind the contract above. It reads the md files and folders under `rootDir` and returns `{ plan, resources, bodies, warnings, ... }`.
  - `GraphError` and `PortInUseError` are the errors they throw.

## Development

```sh
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run build       # lib/ (tsc) and dist/ (Vite)
npm run test:e2e    # builds, then runs the Playwright specs through the CLI
```

The Playwright specs serve a fictional fixture through the CLI on port `4390`, or the port in `DEPGRAPH_VIEW_E2E_PORT`. The performance spec uses that port + 1.

The screenshots in `docs/` are not part of the npm package.

## License

MIT
