---
id: pr-description
title: PR description
description: Clear PR summary for humans and review bots.
category: coding
tags: [coding, git, docs]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: writing
defaultStrength: light
variables:
  - name: changes
    required: true
  - name: why
    required: false
  - name: test_plan
    required: false
---

## Summary
{{changes}}

## Why
{{why|Ship value / fix issue / unblock work.}}

## Test plan
{{test_plan|- [ ] Relevant tests run
- [ ] Manual check of primary path}}

## Notes for reviewers
- Risk areas
- Anything intentionally deferred
