# Importing skills

A skill is a directory with a `SKILL.md` file. `nib import` also takes single Markdown files. Everything is stored in a catalog, the `.nib/` directory (the commands call it the store). `nib import` writes `--store DIR` if you give it, otherwise `./.nib` in the current directory, and ignores `$NIB_STORE`, so run it from the project root: from a subdirectory it creates a second `.nib` that then shadows the project's for `ask`. Every other command finds the catalog with `--store DIR`, then `$NIB_STORE`, then the nearest `.nib` above the working directory. `nib init claude` always uses `<project>/.nib` and rejects `--store`; choose the project with `--project DIR`.

## What you can import

- **A directory:** `nib import ./skills`. Every directory under it that contains a `SKILL.md` is a skill, named by its front matter `name` (or the directory name).
- **One file or several:** `nib import notes.md style.md`. A file is imported as given, as a skill named after the file.
- **A GitHub repository:** `nib import owner/repo`, optionally with a ref and a subpath: `owner/repo@ref/path/to/skills`. A repository has a namespace (`owner/repo`), its skills are named inside it, and a file has its name.

A GitHub source is read left to right: owner, repository, then an optional `@ref` directly after the repository, then an optional path inside it. So `cloudflare/skills/skills` is the `skills` directory of the `cloudflare/skills` repository at the latest commit, and `cloudflare/skills@5339598/skills` is the same directory pinned to a commit. Leave the path out and the whole repository is imported (up to 2,000 Markdown files, so give a path for a large repository). `nib init claude` takes the same sources and imports them itself.

With no ref, GitHub imports take the latest commit of the default branch and remember which commit that was. A ref can be a branch, a tag or a commit hash; a commit hash (7 to 40 hex characters) pins the source, which then never changes until you import another commit.

```sh
nib import ./skills
```

```output
Imported 5 skills, 5 files, 30 modules (0 oversize) into <project>/.nib
  acme-commit-messages  1 file  6 modules
  acme-error-copy  1 file  6 modules
  acme-incident-report  1 file  6 modules
  acme-release-notes  1 file  6 modules
  acme-sql-style  1 file  6 modules
```

Importing the same file or the same commit again is skipped with a note, so nothing is duplicated. Use `--replace` to replace the whole store with the new import, or `--force` to import anyway.

Limits: 1 MiB per file and 2,000 Markdown files per GitHub import.

## See what you have

```sh
nib list
```

```output
<project>/skills  dir  local
  acme-commit-messages  1 file  6 modules
  acme-error-copy  1 file  6 modules
  acme-incident-report  1 file  6 modules
  acme-release-notes  1 file  6 modules
  acme-sql-style  1 file  6 modules
```

`nib list <query>` matches skill names and source locations, so `nib list sql` finds a skill by name and `nib list owner/repo` finds a namespace. `--json` prints the same as data.

## Update

Local sources are re-read from disk. Floating GitHub sources (no ref or a branch) are re-resolved to the latest commit. Pinned sources do not move.

```sh
nib update --check
```

```output
<project>/skills (local): up to date
(check only: nothing was written)
```

`nib update` with no names refreshes every source; with a skill name it refreshes only that skill; with a source location it refreshes that whole source. Each refresh reports which sections of each skill changed, were added or were removed. `--check` reports and writes nothing, `--force` writes without the unchanged-commit skip, and `--prune` drops skills that disappeared from their source. If a name matches more than one source (for example the same repository at two refs) the command lists the candidates, and `--from <source>` picks one.

## Skills with the same name

Two sources can provide a skill with the same name, for example when a project already holds a skill that you also import from a repository. Both stay searchable: the first keeps its name and the later one is searched as `<name>~2` (then `~3`), and `nib show` and MCP `get` accept those refs. A later copy whose files are identical is searched once. `nib import`, `nib init claude` and `nib list` print a `Conflict:` line for each such name, and `nib remove <name>` for such a name asks you to choose the source with `--from`.

## Remove

`nib remove <name>` removes the source that provides that skill, which removes every skill from the same source. To keep only one skill from a repository, import just its subpath (`owner/repo/skills/one-skill`).

## The catalog file

`.nib/catalog.json` is an implementation detail, not a stable interface. For anyone reading it: each module's `start` and `end` are string indexes (UTF-16 code units) into the file text, and its `bytes` is the UTF-8 length of that span, so the two differ for text with accented letters, symbols or emoji.

## Trust

Imported skills are instructions for your agent, and third-party skills are untrusted. Read what you import, pin GitHub sources to a commit you reviewed, and run `nib update --check` and read what changed before you run `nib update`.
