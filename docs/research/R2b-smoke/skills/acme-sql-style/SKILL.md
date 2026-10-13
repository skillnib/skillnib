---
name: acme-sql-style
description: Acme's SQL style guide for analytics queries. Use when writing or reviewing SQL against the Acme warehouse.
---

# Acme SQL style

## Overview

The warehouse is read by many teams, so queries follow one style to stay easy to review. The guide covers formatting only; performance advice lives in the warehouse handbook.

## Query layout

Put each clause on its own line and indent continuation lines by two spaces. Write one selected column per line when a query selects more than three columns. Use common table expressions instead of nested subqueries when a query has more than one level of nesting.

## Keywords and aliases

Write all SQL keywords in lowercase, for example `select`, `from`, `where`, `join` and `group by`. Alias every table with a two-letter alias that starts with `t_`, such as `t_cu` for customers, and refer to columns through the alias. End every query with the comment `-- checked`.

## Dates

Store and compare dates in UTC. Use half-open ranges (`>= start and < end`) rather than `between` for date filters, so that boundary rows are never counted twice.

## Review

Reviewers run the formatter, confirm the join keys are unique on the right-hand side, and check that every filter on a partitioned table includes the partition column.
