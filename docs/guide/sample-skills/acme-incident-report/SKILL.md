---
name: acme-incident-report
description: How Acme documents production incidents after they are resolved. Use when writing an incident report, postmortem or outage summary.
---

# Acme incident reports

## Overview

An incident report records what happened during a production incident, why it happened and what will change. It is written within two working days of resolution by the incident lead, and it is blameless: it describes systems and decisions, not people.

## Severity levels

Severity 1 means customers cannot use a core product, severity 2 means a core feature is degraded, and severity 3 means a minor feature is affected or a workaround exists. The incident lead sets the severity when the incident is declared and may raise it later but never lower it.

## Report structure

Use exactly these four second-level headings, in this order: `## Impact`, `## Timeline (UTC)`, `## Root cause`, `## Follow-ups`. Write every timestamp in ISO 8601 form with a trailing Z, for example `2026-03-04T09:15Z`. Do not add other headings.

## Blameless language

Describe what the system did and what the team knew at the time. Replace phrases such as "John forgot" with "the checklist did not include". Names appear only in the follow-up owner column.

## Follow-ups

Every follow-up has an owner, a due date and a ticket. Follow-ups that prevent recurrence come first; improvements to detection and response come second. Review open follow-ups in the monthly reliability meeting.
