# The plan format, exactly

These are the rules the viewer's loader applies, and every message it prints with its cause and fix. The examples are fictional.

## Finding the plan file

The viewer takes one path, a file or a folder.

- A file whose name ends `.yaml` or `.yml` is the plan, wherever it sits.
- A file whose name ends `.json` is refused: JSON plans are no longer read. Any other file is refused as not a plan file. A path that does not exist is refused as not found.
- For a folder, only the files directly in it count (not subfolders), and names starting with `.` are skipped. Extensions are case-sensitive: `.YAML` does not count.
  1. `<folder>.yaml`, named after the folder, is the plan, even when other `.yaml` files sit next to it.
  2. Otherwise the folder's only `.yaml` file is the plan. Two or more are refused.
  3. With no `.yaml` file: `<folder>.json`, or any `.json` file holding an object with a `nodes` list, is refused as an old JSON plan; else `.yml` files are refused with a hint to name the file on the command line or rename it to `.yaml` (a `.yml` plan is read only when the path names it); else the folder is refused as holding no plan.

The plan folder is the folder that holds the plan file. Every path in the plan is relative to it. A byte-order mark at the start of the plan file or of a card is ignored.

## The top level

The plan file is YAML 1.2, read with unique keys: the same key twice in one mapping refuses the file. Its top level is a mapping (an empty file is refused the same way as a list):

- `name`: required, a string. Missing, bare (`name:`) or a list is refused; a number or boolean (`name: 2027`) is refused with a hint to quote it.
- `nodes`: required, a mapping from step id to step. `nodes: {}` and a bare `nodes:` are both an empty plan. Missing, or written as a list (`- buy-flour`), is refused.
- Any other top-level key is ignored with a warning.

## A step

Each key under `nodes` is a step id, and its value is empty (`buy-flour:` or `buy-flour: {}`) or a mapping. Anything else, such as a list or a word, is refused. The keys of a step:

- `needs`: the ids this step needs, as a YAML list: `[a, b]`, or one `- a` per line. A bare `needs:` or `needs: []` means none. Each item must be a string (quote one that reads as a number). An id listed twice counts once, and the order does not matter. An item that names no step in the plan is dropped with a warning; an item naming the step itself, or needs that form a loop, refuse the plan.
- `md`: the step's card, a string path. Default `nodes/<id>.context/<id>.md`. A bare `md:` or a non-string is refused.
- `dir`: the step's folder, a string path, whose files the viewer lists. Default `nodes/<id>.context` when the step has no `md`; with `md` and no `dir`, the folder is the one that holds the md file. A bare `dir:` or a non-string is refused.
- The seven card keys (`title`, `description`, `status`, `tags`, `due`, `priority`, `hold`) are accepted here with no warning, but the card wins over them key by key (see Cards).
- Any other key is ignored with a warning.

## Ids

An id matches `^[a-z0-9][a-z0-9-]*$`: lower-case letters, digits and hyphens, not starting with a hyphen. Each id appears once; a repeated id is a repeated key, which refuses the file.

An id that YAML reads as something other than a string is refused. When quoting it would make a valid id (a number such as `2027`, or `true`), the message says to quote it; otherwise (`1.5`) it asks for a string. Quote it as a key and in every `needs` list that names it:

```yaml
name: Kitchen refit
nodes:
  "2027": {}
  order-cabinets: {needs: ["2027"]}
```

A `needs` item is not checked against the id pattern; it is only looked up. One that matches no step (`Buy-Flour` for `buy-flour`) is dropped with the unknown dependency warning.

## Cards

A card is a markdown file. Frontmatter is optional: it opens with `---` as the very first line and closes at the next line that is `---` (spaces or tabs may follow either). A file that does not start with `---` has no frontmatter; all of it is the body and every key takes its default. An opening `---` with no closing line refuses the plan.

The frontmatter is YAML 1.2 with unique keys, and must be a mapping (an empty block is fine). The seven keys:

| Key | Value | Absent means |
| --- | --- | --- |
| `title` | text; a number or boolean is read as text | the id |
| `description` | text; a number or boolean is read as text | empty |
| `status` | `todo`, `doing`, `done` or `blocked` | `todo` |
| `tags` | a list of strings (`[set, paint]`) | no tags |
| `due` | a real calendar date written `YYYY-MM-DD` (`2027-02-30` is refused) | no due date |
| `priority` | `low`, `normal` or `high` | `normal` |
| `hold` | text of 1 to 200 characters, counted after every run of whitespace (newlines included) becomes one space and the ends are trimmed | not held |

- A key with no value (bare `hold:`, or `null` or `~`) counts as absent and takes its default. This holds even when the YAML step gives that key a value: the card's empty key hides it.
- `hold: ""` is not absent: it is an empty hold and is refused with `hold must be 1-200 characters`.
- A key in the card wins over the same key on the YAML step.
- Any other frontmatter key is ignored with no warning.
- The body below the closing `---` is the text the viewer shows.

Card errors of the value kind (a wrong `title`, `description`, `status`, `tags`, `due`, `priority` or `hold`), across every card, are collected and printed as one message joined with `; `, together with any step that needs itself. A cycle is reported only when there is no other such error. A card that cannot be read at all (frontmatter not closed, not a mapping, or not valid YAML) stops the load at that card, so fix it and run again to see the rest.

## Paths and folders

`md` and `dir` are relative to the plan folder.

- A path that leaves the plan folder, by `..`, an absolute path elsewhere, or a symlink whose target is outside, drops the step with a warning.
- A given `md` that does not exist, or is not a file, drops the step with a warning.
- A missing default card keeps the step with a warning: it shows its id as the title and every default.
- A given `dir` that does not exist, or is not a folder, keeps the step with a warning and no files.
- A step's files are every file below its folder, in subfolders too, skipping `.git` and `node_modules` folders and anything whose real path leaves the step's folder. The first 500, sorted by path, are listed; more gives a warning.
- Only the YAML makes a step. A folder under `nodes/` that no step names is not read, and neither is anything else in the plan folder, such as `deleted/`.
- A dropped step is not in the plan, so each `needs` item naming it is dropped with the unknown dependency warning.

## Where messages appear

At startup, a refused plan prints `depgraph-view: <message>` on stderr and exits with code 1. A plan that loads prints its URLs on stdout and each warning as `warning: <message>` on stderr; the page also lists the warnings in a collapsed list in its bottom-left corner. While the viewer watches the files, a change that breaks the plan shows the message in a banner on the page, which keeps showing the last plan that loaded; after a good reload the page's warnings list is the current one (stderr lines are printed only at startup).

A YAML syntax error in the plan file is prefixed with the file's name (`kitchen.yaml: `); every message about one step or card starts `node "<id>": `. The tables give each message exactly as printed after `depgraph-view: ` or `warning: `. In them, `<...>` stands for a name, an id or a list, and `L`, `C` and `N` stand for numbers.

## Refusals

| Message | Cause | Fix |
| --- | --- | --- |
| `graph must be a mapping` | The file's top level is not a mapping (a list, a word, or an empty file). | Rewrite it as `name:` and `nodes:`. |
| `name must be a string` | `name` is missing, bare, or a list or mapping. | Add `name: <title>` at the top. |
| `name must be a string: quote it as "<name>"` | `name` reads as a number or boolean (`name: 2027`). | Quote it, as the message shows. |
| `nodes must be a mapping` | `nodes` is missing, or written as a list (`- buy-flour`). | Write `nodes:` with one `<id>: {}` line per step under it. |
| `id "<id>" does not match ^[a-z0-9][a-z0-9-]*$` | An id has capitals, underscores, spaces or other characters (`Buy_Flour`). | Lower-case it with hyphens only, and rename it everywhere it is named. |
| `node id <id> is not a string: quote it as "<id>"` | An id reads as a number or boolean (`2027: {}`). | Quote the key, and every `needs` item that names it. |
| `node id must be a string such as dig-beds` | An id is not text and quoting it would not make a valid id (`1.5: {}`). | Choose an id that matches the pattern. |
| `<file>: Map keys must be unique at line L, column C` | The same id, or the same key, twice in the plan file. | Merge the two into one. |
| `node "<id>": must be a mapping or empty` | A step's value is a list or text (`buy-flour: [knead]`). | Write `{}` or `{needs: [...]}`. |
| `node "<id>": needs must be a list` | `needs` without brackets (`needs: buy-flour`). | Write `needs: [buy-flour]`. |
| `node "<id>": needs must be a list of ids` | A `needs` item is a list or a mapping. | Flatten it to ids. |
| `node "<id>": needs item <id> is not a string: quote it as "<id>"` | A `needs` item reads as a number or boolean (`needs: [2027]`). | Quote it. |
| `node "<id>": needs item must be a string such as dig-beds` | A `needs` item is not text and quoting it would not make a valid id (`needs: [1.5]`). | Name an existing step's id. |
| `node "<id>": md must be a string` | `md` is bare, a number, a list or a mapping. | Quote the path, or remove `md` to use the default. |
| `node "<id>": dir must be a string` | `dir` is bare, a number, a list or a mapping. | Quote the path, or remove `dir` to use the default. |
| `node "<id>": depends on itself` | The step's own id is in its `needs`. | Remove it. |
| `cycle: <first> -> <next> -> <first>` | The needs form a loop; the message lists it, ending where it starts. | Ask the user which link is wrong and unlink it. Never guess. |
| `node "<id>": title must be a string` | `title` is a list or a mapping. | Write the title as text. |
| `node "<id>": description must be a string` | `description` is a list or a mapping. | Write the description as text. |
| `node "<id>": invalid status "<status>"` | `status` is not one of the four (`status: started`). | Use `todo`, `doing`, `done` or `blocked`; ask if the meaning is unclear. |
| `node "<id>": tags must be an array of strings` | `tags` is a word (`tags: shopping`) or a list with a number in it. | Write `tags: [shopping]`; quote numeric tags. |
| `node "<id>": due must be a date YYYY-MM-DD` | `due` is in another form, or the day does not exist (`2027-02-30`). | Ask the user for the date and write it `YYYY-MM-DD`. |
| `node "<id>": invalid priority "<priority>"` | `priority` is not one of the three (`priority: urgent`). | Use `low`, `normal` or `high`; ask if the meaning is unclear. |
| `node "<id>": hold must be 1-200 characters` | `hold` is empty (`hold: ""`), over 200 characters, or not text. | Shorten it, or remove the key to clear the hold. |
| `node "<id>": frontmatter is not closed` | The card opens with `---` but has no closing `---` line. | Add the closing line. |
| `node "<id>": frontmatter must be a mapping` | The frontmatter is a list or a single word. | Rewrite it as `key: value` lines. |
| `node "<id>": Map keys must be unique at line L, column C` | The same key twice in one card. | Keep one. |
| `node "<id>": Nested mappings are not allowed in compact mappings at line L, column C` | An unquoted value with `: ` in it (`title: Shop: flour and yeast`). | Quote the value. |
| `not found: <path>` | The path given to the viewer does not exist. | Point it at the plan folder or the plan file. |
| `<file>: not a plan file (expected .yaml or .yml)` | The path names a file that is not `.yaml`, `.yml` or `.json`. | Point it at the plan folder or the `.yaml` file. |
| `<path>: expected exactly one .yaml file at the top of the folder, found N: <files>` | The folder has several `.yaml` files and none is named after the folder. | Name the plan file on the command line, or rename the plan file after its folder. |
| `<path>: expected a .yaml plan file at the top of the folder, found none` | The folder has no `.yaml` file at its top. | Point the viewer at the folder that holds the plan, or start a plan there. |
| `<path>: expected a .yaml plan file at the top of the folder, found none; <files> found: name the file explicitly or rename it to .yaml` | The folder has only `.yml` files. | Name the `.yml` file on the command line, or rename it to `.yaml`. |
| `<name>.json: JSON graph files are no longer read; rewrite it as <name>.yaml (see README "From graph.json")` | The path is, or the folder holds, an old JSON plan. | Tell the user; convert it only if they ask. |
| `<file>: cannot be read (<code>)` | The plan file exists but cannot be read (`<code>` is the system's error code, such as `EACCES`). | Tell the user; the file's permissions are theirs to fix. |
| `port N is in use` | `--port N` was given and that port is taken. | See `viewer.md`. |

Any other message after `<file>: ` or `node "<id>": ` is the YAML parser's own, about invalid YAML in the plan file or that card; most name the line and column. Read that spot: quoting the value fixes most.

## Warnings

The plan loads, but each warning is still something to fix before calling the plan done.

| Message | Cause | Fix |
| --- | --- | --- |
| `unknown top-level key "<key>" ignored` | A top-level key other than `name` and `nodes`. | Remove it. |
| `node "<id>": unknown key "<key>" ignored` | A step key outside `needs`, `md`, `dir` and the seven card keys; usually a typo (`need:`). | Correct it, or move the value into the card. |
| `node "<id>": no md file` | The step has no card at the default path. | Write `nodes/<id>.context/<id>.md`. |
| `node "<id>": md not found` | The given `md` path does not exist or is not a file; the step is dropped. | Fix the path, or remove `md` to use the default. |
| `node "<id>": md is outside the folder` | The card's path, given or default, leaves the plan folder (by `..`, an absolute path or a symlink); the step is dropped. | Move the card into the plan folder and point `md` at it. |
| `node "<id>": dir is outside the folder` | The step's folder, given or default, leaves the plan folder (by `..`, an absolute path or a symlink); the step is dropped. | Move the folder into the plan folder and point `dir` at it. |
| `node "<id>": dir not found` | The given `dir` does not exist or is not a folder; the step shows no files. | Create the folder, or remove `dir`. |
| `node "<id>": unknown dependency "<id>" dropped` | A `needs` item names no step in the plan, or a step that was dropped. | Add that step, correct the id, or remove it from `needs`. |
| `node "<id>": more than 500 files, list cut` | The step's folder holds more than 500 files; the first 500 are listed. | Tell the user; nothing in the plan to fix. |
