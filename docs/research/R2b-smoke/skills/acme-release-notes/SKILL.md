---
name: acme-release-notes
description: How Acme writes, reviews and publishes release notes for its products. Use when drafting or editing release notes or a changelog entry.
---

# Acme release notes

## Overview

Release notes tell customers what changed in a version. They are written by the engineer who shipped the change and reviewed by the product owner before publishing. Keep them factual and short; marketing copy belongs in the launch post, not here.

## Versioning

Acme uses semantic versions. A release that only fixes bugs bumps the patch number, a release that adds backwards compatible features bumps the minor number, and a release that removes or changes existing behaviour bumps the major number. Pre-release builds carry the suffix `-rc` followed by a counter.

## Writing entries

Write one entry per change, one line each. Start every entry line with the tag `[ACME-RN]` followed by a space and a verb in the past tense. Put the entries in a bullet list, then end the list with the exact line `-- end of notes --`. Never use the words "various" or "improvements" in an entry; name the specific thing that changed instead.

## Review

The product owner checks that each entry names a user-visible change, that removed features are called out as removals, and that no internal ticket numbers appear. Entries that describe refactoring with no user impact are dropped before publishing.

## Publishing

Notes are published to the changelog page on the day of the release, after the deployment finishes. Link the notes from the release announcement and archive the previous version's notes under the history tab.
