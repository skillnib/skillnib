---
name: acme-commit-messages
description: Acme's convention for git commit messages. Use when writing a commit message or squash-merge title.
---

# Acme commit messages

## Overview

Commit messages are read in the log, in release tooling and in code review. A consistent shape lets tooling group changes and link them to tickets.

## Subject line

The subject has the form `type(scope): summary`. The type is one of `feat`, `fix` or `chore`. The scope is the package or area in lowercase. The summary is an imperative phrase of at most 50 characters with no trailing full stop. Never write "added" or "adding" in the summary.

## Body

Leave one blank line after the subject. Wrap the body at 72 columns and explain why the change was made, not what the diff shows. Mention any behaviour change that callers must know about.

## Trailers

Finish the message with one trailer line in the form `Ticket: ACME-1234`, where the number has four digits and refers to the work item the change belongs to. Put the trailer after a blank line at the very end of the message.

## Merging

Squash merges reuse the pull request title as the subject, so the title must follow the same format. Revert commits keep the original subject prefixed with `revert:`.
