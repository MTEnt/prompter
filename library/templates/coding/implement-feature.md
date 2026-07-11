---
id: implement-feature
title: Implement a feature
description: Plan-light implementation brief for coding agents across Codex, Claude Code, Grok, Gemini, Cursor.
category: coding
tags: [coding, feature, implementation]
targets: [codex, claude, grok, gemini, cursor, copilot, generic]
defaultTask: coding
defaultStrength: medium
variables:
  - name: goal
    required: true
    help: What should work when done?
  - name: paths
    required: false
    help: Files or dirs to touch (if known)
  - name: constraints
    required: false
    help: Hard limits, stack, style
  - name: verify
    required: false
    default: Run the project's usual tests/lint if available
source: Prompter original (agent-coding practice)
---

## Goal
{{goal}}

## Scope
Paths (if known): {{paths|discover in repo}}

## Constraints
{{constraints|Match existing project conventions. Minimal diff. No drive-by refactors.}}

## Skills / project rules
If the repo has `AGENTS.md`, `CLAUDE.md`, or `.agents/skills/`, load and follow them. Invoke relevant `$skills` when present.

## Approach
1. Locate the right insertion points in the codebase.
2. Implement the smallest change that fully satisfies the goal.
3. Update tests or docs only if required for correctness.

## Definition of done
- Feature behaves as described in **Goal**
- {{verify}}
- No unrelated files changed
