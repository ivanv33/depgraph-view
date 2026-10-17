# Running the viewer

Everything the skill needs to know about the viewer's command line, the `validate` check, ports, network access and stopping. Each statement here is what the viewer's code does at this release.

## The command

```sh
npx --yes github:ivanv33/depgraph-view#v0.3.1 play
```

Replace `play` with the plan folder or the plan's `.yaml` path, and run it from the folder that contains `play/`, or pass the plan folder's full path. Keep the `#v0.3.1` pin: it is the release whose loader enforces the format this skill teaches. `--yes` stops npx from waiting on an install prompt in a non-interactive shell.

The usage, as `--help` prints it:

```text
usage: depgraph-view <path> [--port N] [--host ADDR] [--open] [--no-watch]
       depgraph-view validate <path> [--json]

  <path>       a plan YAML file, or a folder holding it
  --port N     serve on port N (0-65535); without it the first free port from 4310
  --host ADDR  bind ADDR (default 127.0.0.1); 0.0.0.0 serves the whole network
  --open       open the page in the default browser
  --no-watch   serve the graph as loaded, without following file changes
  validate     load the plan once and exit, serving nothing: problems on stderr,
               a summary on stdout; exit 0 clean, 1 with warnings, 2 refused
  --json       with validate, print the summary as one JSON object
  -h, --help   show this help
```

The first run downloads the viewer from GitHub and builds it, which can take a minute or more: wait until it prints a URL or exits. Later runs reuse npx's cache and start in a second or two. The viewer needs Node 20.19 or newer; if `node --version` is older, tell the user rather than trying anyway.

## What it prints

- stdout: one URL per line, such as `http://127.0.0.1:4311/`. The first is the one to give the user (and the one `--open` opens). More than one appears only with `--host 0.0.0.0` or `--host ::` on a machine with several IPv4 network addresses.
- stderr: one `warning: <message>` line per load warning, printed once at start. Each is in the warnings table of `references/format.md`.
- stderr, when the plan is refused or the server cannot start: one line `depgraph-view: <message>`, then exit `1`. The message is in the refusals table of `references/format.md`.

Run it in the background so the session stays free, and read the URL from its output. It serves until stopped.

Where the output goes: use the session tool's own background-run feature when it has one; it keeps stdout, stderr and the stop control. Otherwise redirect stdout and stderr, and save `$!` (the npx pid), to files in one scratch place of the session's own: its scratch directory if it has one, else a fresh `mktemp -d`. Never put them inside the plan folder, and never in fixed-name files under `/tmp`. Name that place to the user once, and delete nothing in it.

## The check: `validate`

```sh
npx --yes github:ivanv33/depgraph-view#v0.3.1 validate play
```

`validate` loads the plan once with the viewer's own loader and exits. It binds no port, opens no browser and follows no files, so it needs no background run, no scratch files and no stopping: run it in the foreground and read its exit code and output.

- Exit `0`: the plan loads with no warnings. stdout is one line, `<name>: N steps, M links, no warnings`, with the plan's `name`, its step count and its `needs` links.
- Exit `1`: the plan loads, with warnings. stderr has one `warning: <message>` line per warning, the same lines the viewer prints at start, and the stdout line ends `N warnings` (`1 warning` for one).
- Exit `2`: the plan is refused, the path is not found, the folder holds no plan file, or the command line is wrong. stderr has one line, `depgraph-view: <message>` (for a wrong command line, the message and the usage), and stdout is empty.

Exit `1` with no summary line on stdout is npx itself failing (install, build, Node too old), not plan warnings: read its real output before judging the plan.

Every message is in the tables of `references/format.md`. With `--json`, stdout is one JSON object instead of the summary line, `{"name": ..., "steps": N, "links": M, "warnings": [...], "errors": [...]}`, where a refused plan has `name` `null` and its message in `errors`; stderr is the same either way. A plan folder that is itself named `validate` is passed as `./validate`.

A serving run with `--no-watch --port 0` still loads the plan, but it serves until stopped: use it only to show a snapshot, never to check.

## Live reload

Without `--no-watch`, the viewer follows the plan file, every card and every step's folder. On each change it loads the plan again and the open page updates by itself, so after edits there is no restart; tell the user the page will update.

A reload prints nothing to the terminal. What it found shows on the page:

- the warnings list, collapsed in the page's bottom-left corner as `N warnings`, carries the same messages as the `warning:` lines;
- a red banner at the top is a reload that was refused: the page keeps showing the last plan that loaded, and the banner's text is the refusal message.

To read the same from the session while the viewer runs on port N (here and below, use the host and port from the printed URL; `127.0.0.1` does not reach a viewer bound to one specific address such as `--host 192.168.1.20`):

```sh
curl -s --max-time 5 http://127.0.0.1:N/api/graph
```

returns JSON whose `warnings` array is the current list, whose `plan.name` is the plan's `name` and whose `generatedAt` is when that plan loaded. A reload runs 150 ms after the last change, and a refused reload does not change the JSON (it still holds the last plan that loaded, warnings and all). So after an edit, wait until `generatedAt` changes before trusting `warnings`, and check `/events` for a refusal. To see a refusal:

```sh
curl -s --max-time 2 http://127.0.0.1:N/events
```

prints an `event: error` line followed by `data: {"message":"<refusal>"}` when the last reload was refused, and nothing after `retry: 1000` when it was not. This request stays open, so `--max-time` ends it; the timeout is expected.

## Reusing a viewer

Before starting a second viewer, check whether this session already started one for this plan and it still answers; if so, give the user its URL again. A running viewer follows the files, so it already shows the latest plan.

## Ports

- Without `--port`, the viewer takes the first free port from 4310 upward, so the URL may say 4311 or 4312. Always read the port from the printed URL; never assume 4310.
- With `--port N`, that port is used as is. If it is taken, the viewer prints `depgraph-view: port N is in use` and exits `1`.
- Then check whether what holds port N is already this plan's viewer:

  ```sh
  curl -s --max-time 5 http://127.0.0.1:N/api/graph
  ```

  If it answers with JSON whose `plan.name` equals the YAML's `name`, it is this plan's viewer: give the user `http://127.0.0.1:N/`. Otherwise (no answer, other content, or another plan's name), ask the user whether to drop `--port` and let the viewer pick, or to name another port.
- Never stop a process the session did not start, whatever holds the port.

## Network access: `--host`

By default the viewer binds `127.0.0.1`, so only this machine can open it, and it refuses (403) any request whose Host header is not `127.0.0.1`, `localhost` or `[::1]`.

Use `--host` only when the user asks to open the plan from another device:

- `--host 0.0.0.0` (or `--host ::`) serves every network interface and prints one URL per IPv4 network address of the machine (not counting loopback), or `http://127.0.0.1:N/` when there is none, also for `--host ::`. A specific address (`--host 192.168.1.20`) binds only that one and prints that URL.
- Any host other than `127.0.0.1`, `localhost`, `::1` or `[::1]` makes the viewer print `warning: serving on <host>; ...` to stderr. For `--host 0.0.0.0` it reads:

  ```text
  warning: serving on 0.0.0.0; anyone who can reach this port can read the plan and every node folder
  ```

  With such a bind the Host check is off: anyone who can reach the port can read the plan, every card and every file in every step's folder.
- Tell the user that in plain words before starting, and start only once they confirm.
- Never use `--host` for `validate`; it takes no `--host`.

## Exit codes

For `validate`, see "The check: `validate`": `0` clean, `1` with warnings, `2` refused or a usage error. For a serving run:

- `0`: stopped cleanly by Ctrl-C, SIGINT or SIGTERM, or `--help` printed the usage.
- `1`: could not start. The plan was refused, the path was not found, the port is in use, or the host could not be bound. The `depgraph-view: <message>` line says which.
- `2`: usage error. No path, two paths, an unknown option, a `--port` value that is not an integer from 0 to 65535, or `--host` without a value. The message and the usage are printed to stderr (with no path, the usage alone).

## Stopping

Stop only a viewer this session started: when the user says they are done, or before the session ends if the user asked for that. Otherwise leave it running and tell the user it is still serving and at which URL.

`npx` runs the viewer as a child process: the process the session started is npx, and the one holding the port is the viewer under it. Sending SIGTERM (or SIGINT, or Ctrl-C) to the npx process stops both, and the viewer exits `0`. Killing npx with SIGKILL (`kill -9`) does not reach the viewer: it keeps serving on the port. So:

1. Stop the background process you started with SIGTERM: `kill <pid>`, or the session tool's own stop control for that process.
2. Wait two seconds, then confirm the port no longer answers and nothing listens on it:

   ```sh
   curl -s --max-time 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:N/
   ```

   ```sh
   lsof -ti tcp:N -sTCP:LISTEN
   ```

   `000` from curl and no output from `lsof` (no listener on the port) mean the port is free. Without `-sTCP:LISTEN`, `lsof` also lists clients, such as a browser tab still connected to the page. Where `lsof` is missing, use `ss -ltnp 'sport = :N'` (no line after the header means no listener), or, if neither exists, take curl's `000` alone.
3. If a listener remains, `lsof -ti tcp:N -sTCP:LISTEN` (or the `pid=` field of `ss -ltnp`) prints its process id. Check it is the viewer this session started (`ps -o command= -p <pid>` shows `depgraph-view` and this plan's path as it was typed, often relative such as `play`, on the port from the URL this session read), and only then `kill <pid>` and repeat step 2. If it is anything else, leave it and tell the user what is on the port.
