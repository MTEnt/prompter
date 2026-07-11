---
id: write-tests
title: Write tests
description: Risk-based tests for a module or behavior.
category: coding
tags: [coding, testing]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: medium
variables:
  - name: subject
    required: true
  - name: framework
    required: false
    help: e.g. vitest, jest, pytest, cargo test
  - name: risks
    required: false
---

## Goal
Add high-value tests for: {{subject}}

## Framework
{{framework|Detect from repo and match existing style.}}

## Risk focus
{{risks|Happy path, edge cases, error handling, regressions.}}

## Requirements
- Match existing test layout and naming
- Prefer behavior over implementation details
- Include at least one failure/edge case
- Keep tests deterministic (no flaky network/time unless mocked)

## Definition of done
- New/updated tests pass
- Cover the stated risks
- No production code changes unless required for testability (ask first if large)
