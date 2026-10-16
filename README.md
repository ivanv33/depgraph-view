# depgraph-view

A read-only 3D viewer for dependency graphs. Point it at a `graph.json` whose nodes name a markdown file each, and it serves the graph on `127.0.0.1` as a force-directed, layered 3D view: pan, zoom, group a branch, search steps by title or id, and open a step to read its markdown, its dependencies and the files in its folder. It follows the files on disk and reloads the page when they change. Nothing is ever written: there is no editing, no upload and no write route.

## Install and run

```sh
npx depgraph-view garden/graph.json
# or install it once
npm i -g depgraph-view
depgraph-view garden
```

Node 20.19 or newer. The command prints one line, the URL, and serves until you stop it (Ctrl-C).

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

Warnings from loading (see below) are printed to stderr as `warning: <text>` and listed on the page.

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

### Rules

- `name` (string) is the page title. `nodes` is an array. A node that is not an object, an `md` or `dir` that is not a string, or a `depends_on` that is not an array of strings rejects the file.
- `id` matches `^[a-z0-9][a-z0-9-]*$` and is unique; a bad or duplicate id rejects the file.
- `md` (string) is required; `dir` (string) is optional. Both are relative to the root. A path that leaves the root, before or after resolving symlinks, drops that node with a warning. A missing `md` file drops the node with a warning. A missing `dir` keeps the node with no files and a warning.
- `depends_on` (array of ids) lives only in the JSON. An id that is not in the graph is dropped with a warning; a node that depends on itself, or a cycle, rejects the file.
- The md file's frontmatter (YAML between `---` lines; optional) supplies the step's fields:
  - `title`: text; defaults to the id.
  - `description`: text; defaults to empty.
  - `status`: `todo`, `doing`, `done` or `blocked`; defaults to `todo`.
  - `priority`: `low`, `normal` or `high`; absent means normal.
  - `tags`: array of strings.
  - `due`: a real date, `YYYY-MM-DD`.
  - `hold`: 1–200 characters saying why the step is not broken down yet.
- The same seven keys may also sit on the JSON node; the frontmatter wins over them. Other keys are ignored.
- A frontmatter key set to null (`title:` with no value) counts as absent: its default applies, even over a value on the JSON node.
- A number or boolean `title` or `description` is read as text.
- A field with the wrong type or value, an unclosed frontmatter block, frontmatter that is not a mapping, a duplicate YAML key, or YAML that cannot be read rejects the file.
- The md body below the frontmatter is the text shown in the step's panel. Relative links and images in it resolve against the step's folder: `dir` when given, else the md file's folder.
- The step's folder is listed as its files (sorted, `.git` and `node_modules` skipped, entries whose realpath leaves the folder skipped, at most 500 with a warning past that).

At startup a rejected file ends the CLI with exit code 1. While watching, a change that makes the file invalid sends an `error` to the page, which shows it in a dismissible banner, and the last good graph stays served.

## The server

The server uses Node's `http` module, binds `127.0.0.1` only, and answers `GET` and `HEAD` (anything else is `405`). Every response carries `X-Content-Type-Options: nosniff`. A request whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (with or without the port), or that has none, is refused with `403`, so a page on another origin cannot reach the server through DNS rebinding.

| Route | Serves |
| --- | --- |
| `GET /` | The viewer page, with a `Content-Security-Policy` that allows only its own origin (plus inline styles and `blob:`/`data:` images and workers). `/viewer.css` and `/assets/*` are its stylesheet and bundle. |
| `GET /api/graph` | JSON `{ plan, resources, warnings, bodies, generatedAt }`: the loaded plan, each step's file list, the load warnings, each step's markdown body and the load time. Sent with `Cache-Control: no-store`. |
| `GET /files/<id>/<path>` | A file from step `<id>`'s folder. The resolved path must stay inside that folder after resolving symlinks, else `404`; a path through a `.git` or `node_modules` folder is `404` too. The content type comes from a short extension allowlist (anything else is `application/octet-stream`); `.html` is sent as `text/plain`, and every file carries a sandboxing `Content-Security-Policy`. |
| `GET /events` | Server-sent events for live reload: `reload` (with `generatedAt`) after the files change, debounced to 150 ms, and `error` (with `message`) when a reload fails; a page that connects while the last reload has failed gets that `error` at once. The page refetches `/api/graph` on `reload` and whenever the stream reconnects. |

There are no write routes and no uploads, and no directory listing beyond each step's file list.

The page keeps the selected step in the URL as `?step=<id>`, so a link opens with that step selected.

## Library use

The viewer's React components and the layout engine are exported for embedding in another React 19 app.

`react` and `react-dom` are pinned runtime dependencies at exactly `19.2.8`. The embedding app must resolve both at that same version: with any other 19.x, npm installs a second, nested React for this package, and its components fail with "Invalid hook call".

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

`Graph` props (`GraphProps`):

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

`Panel` (`PanelProps`: `plan`, `id`, `body`, `files`, `today`, `onSelect`, `onClose`) is the step panel, and `Search` (`SearchProps`: `plan`, `today`, `onPick`) is the search box. `Legend` shows the counts per readiness state (Ready, Doing, Waiting, Blocked, Done) and on hold, plus the priority marks and the edge key.

Two more entry points:

- `depgraph-view/engine`: the layout, schema and label modules as namespaces (label modules build DOM and need a browser `document`), for example `schema` (`validatePlan`, `ID_RE`, the `Plan` types), `layered`, `grouping`, `graphData`, `camera`, `frame`.
- `depgraph-view/server` (Node only): `startServer({ path, port?, watch?, distDir? })` resolves to `{ url, port, warnings, close() }`; `loadGraph(rootDir, json)` is the loader behind the contract above (it reads the md files and folders under `rootDir`) and returns `{ plan, resources, bodies, warnings, ... }`; `GraphError` and `PortInUseError` are the errors they throw.

## Development

```sh
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run build       # lib/ (tsc) and dist/ (Vite)
npm run test:e2e    # builds, then runs the Playwright specs through the CLI
```

The Playwright specs serve a fictional fixture through the CLI on port `4390`, or the port in `DEPGRAPH_VIEW_E2E_PORT`; the performance spec uses that port + 1.

## License

MIT
