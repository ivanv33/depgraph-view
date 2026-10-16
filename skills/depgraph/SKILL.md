---
name: depgraph
description: >-
  Build, change and show dependency plans for the depgraph-view viewer: a plan folder holding one YAML file that lists each step and the steps it needs, plus one markdown card per step. Use this skill whenever the user wants to lay out a goal, project or roadmap as steps with dependencies; start a new plan; add, link, unlink, rename or delete a step; mark a step todo, doing, done or blocked; set a step's title, tags, due date, priority or hold; check a plan for cycles, bad ids or missing cards; or says "show me the plan", "open the graph" or "run the viewer", even if they never say depgraph. Also use it whenever a folder holds a YAML file with a nodes mapping next to a nodes folder of .context folders. Not for prose implementation plans, task lists without dependencies, or package dependency graphs.
license: MIT
compatibility: Node 20.19 or newer and npx; the first viewer run downloads and builds the viewer from GitHub.
---

# depgraph plans

A depgraph plan is a folder of plain files: one YAML file listing the steps and what each one needs, and one markdown card per step. The viewer reads them and draws the plan as a layered graph. This skill writes and changes those files so the viewer loads them with no warnings, then runs the viewer to check and show the plan.

You record the steps the user gives, or the steps you and the user agree on. You do not invent steps, dates, owners, priorities or descriptions: leave out what the user did not say.

Two references sit next to this file. Read `references/format.md` before writing any value you are unsure of, and whenever the viewer prints an error or a `warning:` line: it has every rule and a table of every message with its fix. Read `references/viewer.md` before running the viewer with options (`--port`, `--host`, `--open`) or after a run fails.

## The shape

A plan is a folder. In it, one YAML file named after the folder (`play/play.yaml`) holds `name:` and `nodes:`. Each key under `nodes` is a step id, and its value says what the step needs. Each step's card is `nodes/<id>.context/<id>.md`: its frontmatter holds the step's fields and its body is the text the viewer shows. The step's folder, `nodes/<id>.context/`, is where the step's files go; the viewer lists them.

```text
play/
  play.yaml
  nodes/
    choose-play.context/choose-play.md
    book-hall.context/book-hall.md
    ...
```

`play/play.yaml`, the example this skill uses throughout (fictional):

```yaml
# Spring school play
name: Spring school play
nodes:
  choose-play: {}
  book-hall: {}
  hold-auditions: {needs: [choose-play]}
  cast-roles: {needs: [hold-auditions]}
  build-set: {needs: [choose-play, book-hall]}
  sew-costumes: {needs: [cast-roles]}
  rehearse: {needs: [cast-roles, build-set]}
  opening-night: {needs: [rehearse, sew-costumes]}
```

"A needs B" means B must be finished before A can start; the viewer draws B upstream of A. Every phrasing maps to this one direction: "A depends on B", "do B before A", "A after B" and "B blocks A" all write `a: {needs: [b]}`. When a request does not say which way ("link the hall and the set"), ask before writing.

The YAML holds only `name`, `nodes` and each step's `needs` (plus `md` or `dir` where a step already has them). Everything else about a step lives in its card.

## The card

Every card starts from this template:

```markdown
---
title: Sew the costumes
description: Twelve costumes from the cast list.
status: todo
tags: [costumes]
---
Fabric is in the art room. Measure each cast member first.
```

With the optional keys, written only when the user gave them:

```markdown
---
title: Paint the backdrop
description: Night sky for act two.
status: todo
tags: [set, paint]
due: 2027-03-01
priority: high
hold: Which scenes need it depends on the final script cut.
---
```

Rules for every card:

- Write keys in this order: `title`, `description`, `status`, `tags`, `due`, `priority`, `hold`. The same order in every card makes them easy to read and diff.
- Always write `title` (without it the viewer shows the id) and `status` (`todo`, `doing`, `done` or `blocked`).
- Write `description` and `tags` even when empty (`description: ""`, `tags: []`), so every card has the same shape.
- Write `due`, `priority` and `hold` only when set.
- Write no other keys. The viewer ignores unknown keys without any warning, so the value would silently vanish; put extra information in the body instead, where the viewer shows it.
- The body is markdown. Relative links and images resolve against the step's folder, so a file dropped in `nodes/<id>.context/` is linked as `[plan](seating.png)`.

## Quoting

The frontmatter and the plan file are YAML. Double-quote a value (escaping `"` and `\` inside it) when it:

- contains `: ` or ` #`;
- starts with any of `- ? : , [ ] { } # & * ! | > ' " % @` or a backtick;
- is empty (`description: ""`);
- would read as something other than text: a number (`2027`, `1e3`, `0.5`), a date-looking string in a title, or a word such as `yes`, `no`, `on`, `off`, `true`, `false`, `null` or `~`.

The viewer reads YAML 1.2, where `yes` is text, but other tools that open the cards read YAML 1.1, where it is a boolean; quoting keeps both readers agreeing. Leave `due` plain (`due: 2027-03-01`): the viewer wants the text and checks it is a real date. Tags follow the same rule inside the brackets (`tags: ["2027", props]`), because a numeric tag rejects the card. When unsure, quote.

A card with the quoted cases:

```markdown
---
title: "Act one: the storm"
description: "yes"
status: doing
tags: ["2027", props]
due: 2027-02-15
---
The title holds `: `, the description is a word YAML 1.1 reads as a boolean, and the first tag is a number, so all three are quoted. The date stays plain.
```

## Operations

Every operation starts the same way: find the plan file, read the YAML and the cards the change touches, and make targeted edits to the lines involved. Never regenerate the YAML from scratch: that loses the user's comments, order and layout. Keep steps roughly in dependency order (a step below the ones it needs); it reads well, though the viewer does not care.

Finding the plan file: a path ending `.yaml` or `.yml` is the plan; a folder's plan is `<folder>.yaml`, else its only top-level `.yaml` file. Dot-files do not count. The exact rules are in `references/format.md`.

Making an id from a title: lower-case it, turn every run of characters outside `a-z0-9` into one `-`, trim `-` from the ends, and keep it to a few words (`Sew the costumes` becomes `sew-costumes`; dropping filler words is fine). If the id is taken, append `-2`, `-3`. Avoid ids that are only digits; if the user insists, quote them everywhere (`"2027": {}`, `needs: ["2027"]`), because unquoted they read as numbers and the plan is refused.

### Start a plan

1. Ask where. The default is a new folder in the current directory, named from the plan's name the same way as ids.
2. If the folder already holds a `.yaml` plan file, do not start a second one there; offer to work on that plan instead.
3. Create `<folder>/<folder>.yaml` with `name:` and `nodes:`. Quote the name if it reads as a number (`name: "2027"`).
4. If the user gave steps, add each one as in "Add a step". Create `nodes/` only through the cards it holds.

### Add a step

1. Choose the id and check it is unused.
2. Check every id it needs exists. If one does not, add that step first, with the user's agreement.
3. Add one line under `nodes:`: `<id>: {}` or `<id>: {needs: [a, b]}`.
4. Write `nodes/<id>.context/<id>.md` from the template, with the user's title and only the fields they gave.

Write the step and its card together: a step without a card loads with the warning `no md file`.

### Link

"A needs B":

1. Both ids must exist and differ.
2. Refuse a link that would make a cycle: follow B's needs, and their needs in turn; if you reach A, the link would close a loop. Say which path and ask the user what they meant. The viewer refuses a plan with a cycle.
3. Add `b` to A's needs: `a: {needs: [b]}`, or extend an existing list in place.
4. If A already needs B, change nothing and say so.

### Unlink

1. Remove the id from the step's needs list.
2. An emptied list becomes `<id>: {}`.
3. If the link does not exist, change nothing and say so.

### Rename a step

From `old` to `new`:

1. Check `new` is a valid id and unused.
2. In the YAML, rename the key and replace `old` in every `needs` list. Replace whole items only, never substrings: renaming `set` must not touch `build-set`.
3. When the step uses the default layout (no `md` and no `dir` keys), move `nodes/old.context/` to `nodes/new.context/` and, inside it, `old.md` to `new.md`. When the step names `md` or `dir`, leave those files where they are; the paths do not contain the id.
4. Search the other cards' bodies for relative links into `../old.context/` and tell the user about each one; fix them if they ask.
5. Tell the user that viewer links ending `?step=old` stop selecting the step.

While the viewer watches, it may show a warning between these edits; the final state must load clean.

### Delete a step

1. Remove its line from the YAML and its id from every `needs` list.
2. If the step had both needs and dependents, ask whether its dependents should take over its needs (so `opening-night` still waits on what the deleted step waited on) or simply lose the link. Do not choose silently.
3. Never remove files. Move the step's default folder `nodes/<id>.context/` to `deleted/<id>.context/` at the plan's root, appending `-2`, `-3` if that name is taken, and tell the user where it went. Nothing is lost, and because `deleted/` sits outside `nodes/`, the id can be reused cleanly.
4. A step with a given `md` or `dir` keeps its files where they are; say so.

### Edit a card

Edit the key in the card's frontmatter; never add it to the YAML, because the card wins over the YAML and two copies of one field confuse everyone. If the YAML step already carries that key (someone wrote it there), tell the user the card now wins and offer to remove the YAML copy. If the card has no frontmatter yet, add a block at the top.

Valid values, and how to clear each:

- `title`, `description`: text, quoted by the rules above. Clearing `title` makes the viewer show the id; prefer a real title.
- `status`: `todo`, `doing`, `done` or `blocked`. "Started" or "in progress" is `doing`; "finished" is `done`; "stuck" or "waiting on someone" is `blocked`. The viewer shows a `todo` step as Ready when everything it needs is `done`, and as Waiting otherwise; never write "ready" or "waiting".
- `tags`: a bracketed list of strings. Add or remove items and keep the rest.
- `due`: a real date `YYYY-MM-DD`, and only one the user gave. Convert "next Friday" against today's date and confirm it with the user. Clear by removing the key.
- `priority`: `low` or `high`. "Normal" is written by removing the key (`normal` is accepted but means the same as absent).
- `hold`: 1 to 200 characters saying what must be known before the step can be broken into smaller steps; the viewer counts held steps in its legend as On hold. It is not `blocked`: a held step is a stage not yet planned in detail, a blocked one is stuck. Clear it by removing the key, never by writing an empty value (that rejects the card).
- The body: free markdown below the closing `---`. Leave the frontmatter untouched when editing the body.

### Check the plan

Check after every batch of edits, before saying the work is done, and before showing the plan.

First, a reading pass while you edit, because it is cheap and catches mistakes before anything runs:

- every id matches `^[a-z0-9][a-z0-9-]*$` and appears once;
- every `needs` item names a step in the plan, and not the step itself;
- the edit you just made closes no loop;
- every step has its card at the default path (or at its given `md`);
- every card's frontmatter has only the seven keys, with valid values.

Then the authoritative check: the viewer's own loader, run once without watching and on a port the OS picks. Run it in the background, from the folder that holds the plan:

```sh
npx --yes github:ivanv33/depgraph-view#v0.2.1 play --no-watch --port 0
```

- If it exits with code 1, its stderr line (`depgraph-view: <message>`) is the refusal. Look it up in `references/format.md`, fix it, and run again.
- If it prints a URL, the plan loaded. Any `warning:` lines on stderr are still to fix; the same table has each one.
- Then stop the process you started.

`--port 0` avoids every port clash, and `--no-watch` keeps it from following the files. The first run downloads and builds the viewer, which takes about a minute; later runs start in a second or two. `--yes` stops npx from waiting on an install prompt in a non-interactive shell.

When the user asked to see the plan, the check and the showing are one run: start the viewer as below; if it exits 1, fix and start again; if it prints warnings, fix them while it runs (it reloads by itself).

## Showing the plan

```sh
npx --yes github:ivanv33/depgraph-view#v0.2.1 play
```

- Run it in the background so the session stays free. It prints the URL on stdout and serves until stopped. Give the user the URL, read from that output.
- Pass `--open` only when the user is at this machine and wants the browser opened.
- The viewer follows the files and reloads the page on every change, so after edits there is no restart; tell the user the page will update.
- Before starting a second viewer, check whether you already started one for this plan, and reuse it.
- Without `--port`, the viewer takes the first free port from 4310 upward, so the URL may say 4311 or 4312. Always read the port from the printed URL; never assume 4310. With `--port N`, a taken port is an error (`depgraph-view: port N is in use`, exit 1); `references/viewer.md` says how to handle it.
- Use `--host` only when the user asks to open the plan from another device. It serves the plan to the network: anyone who can reach the port can read the plan and every step's folder. Repeat that warning to the user in plain words before starting, and never use `--host` for the check run.
- Stop only a viewer you started: when the user says they are done, or before the session ends if the user asked for that; otherwise leave it running and say so. Never stop a process you did not start.
- The viewer needs Node 20.19 or newer; if `node --version` is older, tell the user rather than trying anyway.

Exit codes, stopping and confirming the port is free, and the network details are in `references/viewer.md`.

## Never

- Never write a `.json` plan, or convert one, unless the user asks: the viewer refuses JSON plans.
- Never write keys outside the seven in a card, or outside `needs` (plus existing `md` and `dir`) on a step in the YAML: unknown card keys vanish without a warning.
- Never write the seven card keys into the YAML: the card wins, so a later card edit silently overrides the YAML copy.
- Never write an id outside `^[a-z0-9][a-z0-9-]*$`, and never leave a numeric-looking id or needs item unquoted: the viewer refuses both.
- Never write `needs` without brackets: `needs: book-hall` is refused, `needs: [book-hall]` loads.
- Never delete files: a deleted step's folder moves to `deleted/<id>.context/` at the plan root, so nothing is lost and the id can be reused.
- Never edit, create or move anything outside the plan folder: the user pointed you at that folder and nothing else.
- Never invent a due date, priority, hold or description: leave out what the user did not give.
- Never break a cycle by picking a link to drop: ask, because only the user knows which link is wrong.
- Never use `--host` unless the user asked for network access, and never stop a process you did not start: one exposes the plan, the other may be someone else's work.
- Never say a plan is done while the viewer's check prints an error or a warning: the check is the only proof the viewer accepts it.
