---
id: explain-codebase
title: Explain codebase area
description: Onboarding-style explanation of a subsystem with file map.
category: coding
tags: [coding, docs, onboarding]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: research
defaultStrength: medium
variables:
  - name: area
    required: true
  - name: audience
    required: false
    default: a strong engineer new to this repo
---

## Goal
Explain {{area}} for {{audience}}.

## Deliverable structure
1. **Purpose** of this area
2. **Entry points** (commands, routes, main modules)
3. **Data / control flow** (short)
4. **Key files** table (path → role)
5. **Extension points** (how to change safely)
6. **Gotchas**

## Rules
- Ground claims in real files; quote paths.
- Prefer accuracy over completeness.
- Flag uncertainty explicitly.
