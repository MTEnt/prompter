---
id: multi-step-mission
title: Multi-step agent mission
description: Long-horizon task with checkpoints for any coding agent.
category: agent
tags: [agent, orchestration, mission]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: strong
variables:
  - name: mission
    required: true
  - name: checkpoints
    required: false
  - name: stop_when
    required: false
    default: Mission goals met and verification passes
---

## Mission
{{mission}}

## Checkpoints
{{checkpoints|1) Discover 2) Plan 3) Implement 4) Verify 5) Summarize}}

## Operating rules
- Work in small verified steps; don't claim done without checks
- Prefer tools/tests over speculation
- Keep a running list of decisions and blockers
- If blocked >15 minutes, surface the blocker with options

## Stop when
{{stop_when}}

## Final report
- What changed (paths)
- How verified
- Follow-ups
