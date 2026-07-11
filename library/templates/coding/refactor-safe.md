---
id: refactor-safe
title: Safe refactor
description: Behavior-preserving refactor with sequencing and tests.
category: coding
tags: [coding, refactor]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: medium
variables:
  - name: target
    required: true
    help: What to refactor
  - name: smell
    required: false
    help: Why (duplication, coupling, naming…)
  - name: verify
    required: false
    default: existing tests must stay green
---

## Goal
Safely refactor: {{target}}

## Motivation
{{smell|Improve clarity and maintainability without behavior change.}}

## Rules
- Preserve behavior unless explicitly expanding scope.
- Prefer small, reviewable commits/steps.
- No drive-by feature work.
- {{verify}}

## Plan then execute
1. Characterize current behavior (tests or checklist)
2. Sequence transforms (extract, rename, move, simplify)
3. Apply one step at a time
4. Re-verify after each meaningful step
