---
id: agents-md-writer
title: Write AGENTS.md
description: Project instruction file for multi-agent compatibility.
category: agent
tags: [agent, agents-md, meta]
targets: [codex, claude, grok, gemini, cursor, copilot, generic]
defaultTask: writing
defaultStrength: medium
variables:
  - name: project
    required: true
  - name: stack
    required: false
  - name: commands
    required: false
---

## Goal
Draft a practical `AGENTS.md` for **{{project}}**.

## Include sections
1. Project one-liner
2. Setup / build / test commands: {{commands|discover from repo}}
3. Code style & conventions ({{stack|detect stack}})
4. Architecture pointers (key dirs)
5. Do / don't for agents
6. PR / commit expectations
7. Secrets & safety

## Rules
- Keep it short enough to load every session; link out for deep docs.
- Prefer commands that actually work in this repo.
- Compatible with Codex, Claude (via import/symlink), Cursor, Copilot where possible.
