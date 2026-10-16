# depgraph-view

A read-only 3D viewer for dependency graphs. Point it at a plan YAML file that lists the steps and what each one needs; each step's text is a markdown file. It serves the graph on `127.0.0.1` (or your network, with `--host`) as a force-directed, layered 3D view. You can pan, zoom, group branches, search steps by title or id, and open a step to read its markdown, its dependencies and the files in its folder. It follows the files on disk and reloads the page when they change. Nothing is ever written: there is no editing, no upload and no write route.

<img src="https://raw.githubusercontent.com/ivanv33/depgraph-view/main/docs/viewer.png" width="830" alt="The viewer showing an eight-step garden plan (a smaller one than the example below) as a layered graph, with the step &quot;Spread compost on the beds&quot; selected and its panel open on the right: the step's text and image, the steps it depends on and is needed by, and its two files">

## Quick start

```sh
npx github:ivanv33/depgraph-view#v0.3.0 garden
```

`garden` is a folder holding the plan file `garden.yaml` (see [The plan file](#the-plan-file)). This runs the viewer straight from GitHub. A git install builds from source, so the first run takes a minute.

Once the package is published to npm:

```sh
npx depgraph-view garden
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

Any of these forms works with `npx`:

```sh
npx github:ivanv33/depgraph-view garden
npx ivanv33/depgraph-view garden
npx https://github.com/ivanv33/depgraph-view garden
```

To pin a release, add its tag:

```sh
npx github:ivanv33/depgraph-view#v0.3.0 garden
```

As a dependency in `package.json`:

```json
"depgraph-view": "github:ivanv33/depgraph-view#v0.3.0"
```

A git install builds the package from source, so it is slower than installing the npm package.

## Install the skill

The repo ships a skill that teaches Claude, and the other agents the [`skills`](https://www.npmjs.com/package/skills) CLI supports, to write and change plan files and to run this viewer.

```sh
npx skills add ivanv33/depgraph-view
npx skills add ivanv33/depgraph-view -g -a claude-code
```

The first installs it into the current project; the second installs it for your user, for Claude Code. The skill edits only the plan folder it is pointed at, and runs the viewer pinned to this release. Its full text is in [`skills/depgraph/SKILL.md`](skills/depgraph/SKILL.md).

## CLI reference

```
depgraph-view <path> [--port N] [--host ADDR] [--open] [--no-watch]
depgraph-view validate <path> [--json]
```

| Argument | Meaning |
| --- | --- |
| `<path>` | A plan YAML file (`.yaml` or `.yml`), or a folder holding `<folder>.yaml` or exactly one `.yaml` file. Dot-files such as `.pre-commit-config.yaml` are not counted. In a folder, a `.yml` file is not looked for: name it on the command line. |
| `--port N` | Serve on port `N` (0–65535; `0` lets the OS pick). A port that is taken is an error. Without `--port`, the first free port from `4310` upward. |
| `--host ADDR` | Bind `ADDR`: an IPv4 or IPv6 address, or a host name. Defaults to `127.0.0.1`. `0.0.0.0` (or `::`) serves every network interface; see [Serving on the network](#serving-on-the-network). |
| `--open` | Open the page in the default browser (the first URL printed). Off by default. |
| `--no-watch` | Serve the graph as loaded, without following file changes. |
| `-h`, `--help` | Print the usage to stdout and exit with code `0`. |

On start the URL goes to stdout. With `--host 0.0.0.0` or `::`, stdout gets one URL per LAN address instead, the first one first. Warnings from loading (see below) go to stderr as `warning: <text>`, and the page lists them too.

### Exit codes

| Code | When |
| --- | --- |
| `0` | The server started (and later stopped on SIGINT or SIGTERM), or `-h` / `--help` printed the usage. |
| `1` | The server could not start: a plan file that is not YAML or that the rules refuse, a missing path, a folder with no plan file (or with several `.yaml` files and none named after the folder), an old JSON graph file (see [From graph.json](#from-graphjson)), a `--port` that is in use, or a `--host` that cannot be bound. The message is printed to stderr as `depgraph-view: <message>`. |
| `2` | Usage error: no path, two paths, an unknown option, a bad `--port` value or a `--host` without a value. The usage is printed to stderr. |

### validate

`depgraph-view validate <path>` loads the plan once, with the same loader and the same messages as the server, and exits: it serves nothing, opens no browser and watches nothing. A refusal goes to stderr as `depgraph-view: <message>` and each warning as `warning: <message>`, the same lines the server prints at start. A plan that loads gets one summary line on stdout, such as `Vegetable garden: 3 steps, 2 links, no warnings` (or `..., 2 warnings`). With `--json`, stdout gets one JSON object instead, `{ "name", "steps", "links", "warnings": [...], "errors": [...] }` (`name` is `null` and `errors` holds the message when the plan is refused); stderr is the same. A folder named `validate` is still a path when written as `./validate`.

| Code | When |
| --- | --- |
| `0` | The plan loads with no warnings. |
| `1` | The plan loads, with warnings. |
| `2` | The plan cannot be loaded (any refusal, a missing path, a folder with no plan file), or a usage error. |

## The plan file

The plan is one YAML file. It names the plan and lists each step by id, with the steps it needs. A step's title, status and text live in its own markdown file. Paths are relative to the YAML file's folder (the root).

A plan folder in the default layout:

```
garden/
  garden.yaml
  nodes/
    dig-beds.context/
      dig-beds.md
    sow-peas.context/
      sow-peas.md
      row-plan.png
    ...
  notes/
    tomatoes.md         # plant-tomatoes names its md and dir (below)
    tomato-photos/
```

`garden/garden.yaml`:

```yaml
# Spring garden — the order things must happen in
name: Spring garden
nodes:
  dig-beds: {}
  buy-compost: {}
  spread-compost: {needs: [dig-beds, buy-compost]}
  sow-peas: {needs: [spread-compost]}
  sow-beans: {needs: [spread-compost]}
  build-trellis: {needs: [dig-beds]}
  train-peas: {needs: [sow-peas, build-trellis]}
  water-rota: {needs: [sow-peas, sow-beans]}
  plant-tomatoes:
    needs: [spread-compost]
    md: notes/tomatoes.md     # this step's md lives elsewhere
    dir: notes/tomato-photos
  harvest: {needs: [train-peas, water-rota, plant-tomatoes]}
```

`nodes/sow-peas.context/sow-peas.md` (the default md for `sow-peas`):

```markdown
---
title: Sow the peas
status: todo
tags: [vegetables]
---
Two rows along the trellis, 5 cm apart.
```

A step with a priority, a due date and a hold needs nothing more in the YAML. In another plan, the line

```yaml
  order-raised-bed-kit: {needs: [measure-plot]}
```

goes with `nodes/order-raised-bed-kit.context/order-raised-bed-kit.md`:

```markdown
---
title: Order the raised-bed kit
description: Cedar kit for the two south beds.
status: todo
priority: high
due: 2027-03-15
hold: Which size fits depends on the plot measurements.
tags: [beds, shopping]
---
```

### Keys

The top level is a mapping:

| Key | Rule |
| --- | --- |
| `name` | String, required. The page title. |
| `nodes` | Mapping from id to step, required. `{}`, or `nodes:` with nothing after it, is an empty plan. |

Any other top-level key is ignored with a warning.

Each step's value is a mapping, or empty (`dig-beds:` with nothing after it means `{}`):

| Key | Rule |
| --- | --- |
| `needs` | List of ids. Absent, empty (`needs:`) or `[]` means none. An id listed twice counts once. A single id without brackets (`needs: dig-beds`) rejects the file: write `needs: [dig-beds]`. |
| `md` | String, a path relative to the root. Defaults to `nodes/<id>.context/<id>.md`. |
| `dir` | String, a path relative to the root: the step's folder. Defaults to `nodes/<id>.context`. With `md` given and no `dir`, the folder is the md file's folder. |
| `title`, `description`, `status`, `tags`, `due`, `priority`, `hold` | Optional. Used when the md file's frontmatter does not set them; the frontmatter wins. |

Any other key on a step is ignored with the warning `node "<id>": unknown key "<key>" ignored` (it catches typos such as `need:`).

### The rules

- An id matches `^[a-z0-9][a-z0-9-]*$`. A bad id, or the same id twice, rejects the file.
- Ids are strings. YAML reads an unquoted `2026` as a number, so quote such an id, as a key and in `needs`: `"2026": {}`, `needs: ["2026"]`. An unquoted one rejects the file.
- These reject the file too: text that is not YAML, a top level that is not a mapping, a `name` that is not a string, `nodes` that is not a mapping, a step whose value is not a mapping or empty, `needs` that is not a list of strings, and an `md` or `dir` that is not a string.
- A path that leaves the root, before or after resolving symlinks, drops that step with a warning.
- A step whose default md file is missing is kept, with the warning `no md file`: its fields come from the plan file or take their defaults (the title is the id). While watching, the viewer reads the file once it appears, even when `nodes/` itself is created after the viewer started. A step whose `md` is given but missing is dropped, with the warning `md not found`.
- A `dir` that does not exist keeps the step with no files and a warning.
- An id in `needs` that is not in the plan is dropped with a warning. A step that needs itself, or a cycle, rejects the file.
- Only the YAML makes a step: a folder under `nodes/` that the YAML does not list is not shown.

### The md file

- The frontmatter (YAML between `---` lines) is optional. It supplies the step's fields:
  - `title`: text; defaults to the id.
  - `description`: text; defaults to empty.
  - `status`: `todo`, `doing`, `done` or `blocked`; defaults to `todo`.
  - `priority`: `low`, `normal` or `high`; absent means normal.
  - `tags`: array of strings.
  - `due`: a real date, `YYYY-MM-DD`.
  - `hold`: 1–200 characters saying why the step is not broken down yet.
- The same seven keys may also sit on the step in the plan file. The frontmatter wins over them. Other keys are ignored.
- A frontmatter key set to null (`title:` with no value) counts as absent. Its default applies, even over a value in the plan file.
- A number or boolean `title` or `description` is read as text.
- These reject the file: a field with the wrong type or value, an unclosed frontmatter block, frontmatter that is not a mapping, a duplicate YAML key, or YAML that cannot be read.
- The md body below the frontmatter is the text shown in the step's panel. Relative links and images in it resolve against the step's folder (see `dir` above).

### The step's folder

The step's folder is listed as its files:

- sorted;
- `.git` and `node_modules` skipped;
- entries whose realpath leaves the folder skipped;
- at most 500, with a warning past that.

The default layout gives each step its own folder, so its file list holds only that step's files. Steps that share a `dir` share its list.

### Errors

At startup a rejected file ends the CLI with exit code 1. While watching, a change that makes the file invalid sends an `error` to the page. The page shows it in a dismissible banner, and the last good graph stays served.

### From graph.json

Version 0.1.0 read a JSON graph file. A `.json` path, or a folder with no `.yaml` but with `<folder>.json` or a `.json` file holding a `nodes` list, now ends the CLI with exit code 1 and asks for the YAML. To rewrite one:

- Rename `depends_on` to `needs`.
- Turn the `nodes` list into a mapping keyed by id: `{"id": "sow-peas", "depends_on": ["spread-compost"]}` becomes `sow-peas: {needs: [spread-compost]}`.
- Drop `md` and `dir` where they equal the defaults (`nodes/<id>.context/<id>.md`, `nodes/<id>.context`). Keep them where they differ.
- Quote ids that YAML would read as something other than a string, such as `"2026"`.
- Name the file after its folder (`garden/garden.yaml`), or keep it the only `.yaml` file there.

## What the viewer shows

<img src="https://raw.githubusercontent.com/ivanv33/depgraph-view/main/docs/graph.png" width="830" alt="The same garden plan with no step selected: eight steps in layers, dependencies drawn as arrows, the toolbar top left and the legend bottom left">

- **The graph.** Each step is a node with its title, laid out in layers along its dependencies. Click a step to select it. Click the background to clear the selection. Escape clears it too.
- **The toolbar** (top left) holds the search box and two buttons. `Group` draws only the path to the selection and its subtree, and folds every other branch into a deck. It is on by default, and the browser remembers your choice. `Fit` frames the whole plan and keeps the selection.
- **Search** matches steps by title or by id. Up and Down move the highlight, Enter or a click selects the step, and Escape clears the box.
- **The panel** opens for the selected step: at the right on a wide or landscape window, along the bottom on a narrow portrait one (a phone, a tablet upright, a narrow pane), with the graph framed in the room left beside or above it. It is as tall as its content; a long step scrolls under its title. It shows the title, the readiness state, the priority, the due date and the tags when set, and the md body as markdown. Under it are the steps it depends on and the steps that need it, each a button that selects that step. Last is the step's file list. Each file opens in a new tab from `/files/<id>/<path>`.
- **The legend** (bottom left) counts the steps per readiness state (Ready, Doing, Waiting, Blocked, Done) and on hold, and explains the priority marks and the edge styles.
- **Warnings** from loading sit in a collapsed list in the bottom left corner.
- **`?step=<id>`.** The page keeps the selected step in the URL, so a link opens with that step selected.
- **Live reload.** Unless the CLI runs with `--no-watch`, the page follows the files and reloads the graph when they change.

## Routes and security

The server uses Node's `http` module and binds `127.0.0.1` unless you pass `--host`. It answers `GET` and `HEAD`; anything else is `405`. Every response carries `X-Content-Type-Options: nosniff`.

A request whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` (with or without the port), or that has none, is refused with `403`. So a page on another origin cannot reach the server through DNS rebinding.

### Serving on the network

`--host 0.0.0.0` binds every network interface, so other devices on your network can open the viewer:

```sh
npx github:ivanv33/depgraph-view garden --host 0.0.0.0
```

The CLI prints a URL for each LAN address, and a warning on stderr. Anyone who can reach the port can read the plan and every step's folder. The `Host` check above is off for any bind that is not loopback, since other devices name the server by its address. Everything else stays the same: the server is still read-only, with the same routes and headers.

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

A host with its own Tailwind v4 skips `viewer.css`. It imports `depgraph-view/labels.css` and `depgraph-view/deckList.css` instead (the label and deck-list rules only, no preflight; `Panel`'s markdown styles live only in `viewer.css`), and adds an `@source` for `node_modules/depgraph-view/lib/view`, relative to its stylesheet, so the package's classes are generated. From `src/app/globals.css` that is `@source "../../node_modules/depgraph-view/lib/view"`. A host without Tailwind imports `depgraph-view/viewer.css` as above.

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
| `onSelect` | `(id: string \| null) => void` | Called on a click: a step's id, or `null` for the background. With `onPick` given it is called only with `null` (a deselect), and every step pick goes to `onPick`. |
| `grouped` | `boolean` | Draw only the path to the selection and its subtree; other branches fold into decks. |
| `today` | `string` | The local date, `YYYY-MM-DD`, that due dates are read against. |
| `insets` | `{ top, right, bottom, left }` | How far the host's chrome (toolbar, panel) reaches in from each window edge, in CSS pixels. `Graph` never measures the host page. Whatever the insets say, `Graph` always keeps a 72 px top band clear and, while `legend` is on, the Legend's room (on views at least 900 px wide, a 240 px left band). |
| `fitAll` | `number` | Change it to frame the whole plan; the selection stays. |
| `onGlides` | `(history) => void` | Optional. Receives the transition timing history after each transition. |
| `focusFallback` | `() => HTMLElement \| null` | Optional. Where keyboard focus goes when no step label can take it. |
| `legend` | `boolean` | Optional, default `true`. Whether the host shows the Legend in the bottom-left corner; when `false` the frames use its room. |
| `onPick` | `(id: string, mode?: 'link' \| 'edit' \| 'shift') => void` | Optional. Given, every step pick (a label, a deck's row, a deck's open-branch button, the selected step's own text) calls it instead of `onSelect(id)`; a deselect still calls `onSelect(null)`. `mode` says how the press was made: Meta is `'link'`, Ctrl or the context menu is `'edit'`. Shift never reaches it: with `onShiftLink` it links, otherwise it is a plain pick. |
| `arming` | `boolean` | Optional. The host is waiting for the step to link to (its own link mode): a Shift pick is then a plain pick, a click on a done deck only shakes it, the deck list says to pick a step and its rows move no focus, and the cursor is a crosshair. |
| `onShiftLink` | `(from: string, to: string) => void` | Optional. Given, Shift+click on a step and then on another links them: called with the step the first click was on and the one the second was on. Absent, Shift+click is a plain pick and none of the linking runs. |
| `onAddAt` | `(x: number, y: number) => void` | Optional. Given, Shift+click on empty canvas calls it with the click's window point. Absent, that click deselects. |
| `onLinkContextMenu` | `(dependencyId: string, dependentId: string) => void` | Optional. Given, a right click on a dependency line calls it with the step that is needed and the step that needs it. A line to or from a deck stands for several dependencies and calls nothing. |
| `flyTo` | `NodeSignal \| null` | Optional. `NodeSignal` is `{ id: string; seq: number }`. A new `seq` glides the camera to put the step (a step folded into a deck: its deck) clear of the top, left and bottom strips (the insets, the passive insets and the legend) but not the right ones, once the view has settled and the step is still the selected one; it reads those strips once, when the signal arrives. Without it nothing flies. |
| `shake` | `NodeSignal \| null` | Optional. A step whose label shakes: a new `seq` shakes it once (a refusal, say). |
| `marked` | `{ ids: string[]; seq: number } \| null` | Optional. Steps to mark: a new `seq` puts `data-added="true"` on their labels for a couple of seconds (the host styles it, as the viewer's own label sheet does). A step not drawn yet is marked once it is. |
| `onOpenedDone` | `(ids: ReadonlySet<string>) => void` | Optional. Called with the decks opened to show their members, on mount and each time they change (a selection that moves on drops them). |
| `passiveInsets` | `Partial<Insets>` | Optional. Strips of the window the host covers without wanting the cues kept clear of them (a sheet that rests beside the panel). Each frame `Graph` starts (a selection, a fit, a focus reveal) keeps them clear too, added to the insets; a fly (`flyTo`) does the same for the top, left and bottom strips only, and a change in them never frames again by itself. |
| `chrome` | `HostChrome` | Optional. `{ toolbar?, panel?, hud?, chip? }`, each a box `{ left, top, right, bottom }` in window pixels, for what `insets` cannot describe: the `chip` (a small box the cues keep clear of) and, to replace the ones derived from the insets, the `toolbar`, `panel` and `hud` (the bottom card: the edge cues' free area ends at its top). The cues and a deck's list keep clear of them. |

Every prop after `fitAll` is optional. `Graph` stays read-only: it reports gestures through these callbacks and changes nothing itself.

### The other components

- `Panel` (`PanelProps`: `plan`, `id`, `body`, `files`, `today`, `onSelect`, `onClose`) is the step panel. It is as tall as its content, up to the height its container allows; past that the part under its title scrolls.
- `Search` (`SearchProps`: `plan`, `today`, `onPick`) is the search box.
- `Legend` shows the counts per readiness state (Ready, Doing, Waiting, Blocked, Done) and on hold, plus the priority marks and the edge key. It takes an optional `list` (`LegendList`: `{ open, onToggle, controls }`); given, its Ready and Doing rows become buttons that call `onToggle`, to open the host's ready list (`controls` is that list's id, for `aria-controls`).
- Also exported from the root: `PriorityMark` (`PriorityMarkProps`), `STATE_NAME` and `STATE_SWATCH` (the readiness states' names and colours), the hooks `useGrouping`, `useToday`, `useElementHeight` and `useElementEdge` (with the `WindowEdge` type), and the types `Insets`, `HostChrome`, `NodeSignal` and `PickMode`.

### More entry points

- `depgraph-view/engine`: the layout, schema and label modules as namespaces, for example `schema` (`validatePlan`, `ID_RE`, the `Plan` types), `layered`, `grouping`, `graphData`, `camera`, `frame`. The label modules build DOM and need a browser `document`.
- `depgraph-view/engine/<module>`: one engine module by name, for example `depgraph-view/engine/frame`.
- `depgraph-view/view/<module>`: one view module by name, for code that must not load `Graph` and its 3D library, such as server code: `depgraph-view/view/PriorityMark`, `depgraph-view/view/focusSoon`, `depgraph-view/view/hooks/<hook>`.
- `depgraph-view/labels.css` and `depgraph-view/deckList.css`: the two stylesheets for a host with its own Tailwind (see above).
- `depgraph-view/server` (Node only):
  - `startServer({ path, port?, host?, watch?, distDir? })` resolves to `{ url, urls, port, warnings, close() }`. `host` defaults to `127.0.0.1`; `urls` lists every URL it is reachable at and `url` is the first.
  - `loadGraph(rootDir, yaml)` is the loader behind [The plan file](#the-plan-file): `yaml` is the plan file's text. It reads the md files and folders under `rootDir` and returns `{ plan, resources, bodies, warnings, ... }`.
  - `parseGraphYaml(text)` applies the plan file's shape rules alone and reads no files. It returns `{ name, entries, warnings }`, each entry `{ id, needs, md?, dir?, common }` in file order.
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

The screenshots in `docs/` are not part of the npm package. Nor is the skill, which lives in `skills/`.

## License

MIT
