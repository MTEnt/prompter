---
id: technical-doc
title: Technical documentation
description: Clear docs for operators/developers.
category: writing
tags: [writing, docs]
targets: [codex, claude, grok, gemini, generic]
defaultTask: writing
defaultStrength: medium
variables:
  - name: topic
    required: true
  - name: audience
    required: false
    default: developers
  - name: format
    required: false
    default: markdown
---

## Goal
Write {{format}} documentation about **{{topic}}** for **{{audience}}**.

## Structure
1. Overview
2. Prerequisites
3. Steps / API / usage
4. Examples
5. Troubleshooting
6. References

## Style
- Active voice, short paragraphs
- Copy-pasteable commands
- No fake version numbers
- Call out breaking changes
