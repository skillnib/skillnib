# Importing skills

A skill is a directory with a `SKILL.md` file. `nib import` also takes single Markdown files. Everything is stored in a catalog, `.nib/` in the current directory (or wherever `--store`, `$NIB_STORE` or the nearest `.nib` above you points).

## What you can import

- **A directory:** `nib import ./skills`. Every directory under it that contains a `SKILL.md` is a skill, named by its front matter `name` (or the directory name).
- **One file or several:** `nib import notes.md style.md`. A file is imported as given, as a skill named after the file.
- **A GitHub repository:** `nib import owner/repo`, optionally with a ref and a subpath: `owner/repo@ref/path/to/skills`. A repository has a namespace (`owner/repo`), its skills are named inside it, and a file has its name.

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

## Remove

`nib remove <name>` removes the source that provides that skill, which removes every skill from the same source. To keep only one skill from a repository, import just its subpath (`owner/repo/skills/one-skill`).

## Trust

Imported skills are instructions for your agent, and third-party skills are untrusted. Read what you import, pin GitHub sources to a commit you reviewed, and run `nib update --check` and read what changed before you run `nib update`.
