---
id: fix-from-error
title: Fix from error log
description: Turn a stack trace or CI failure into a focused fix brief.
category: coding
tags: [coding, debug, ci]
targets: [codex, claude, grok, gemini, cursor, copilot, generic]
defaultTask: coding
defaultStrength: medium
variables:
  - name: error
    required: true
  - name: command
    required: false
---

## Failure
```
{{error}}
```

## Command / context
{{command|unknown}}

## Task
1. Identify root cause (not just the last frame)
2. Apply a minimal fix
3. Re-run the failing command or closest test
4. Report cause → fix → verification

## Rules
- Don't suppress errors without fixing cause
- Don't expand into large refactors
