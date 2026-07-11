---
id: debug-systematic
title: Systematic debug
description: Reproduce → observe → hypothesize → test → fix loop for hard bugs.
category: coding
tags: [coding, debug, diagnosis]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: strong
variables:
  - name: symptom
    required: true
  - name: context
    required: false
    help: OS, version, recent changes, logs
  - name: repro
    required: false
source: Prompter original (diagnose / scientific debug pattern)
---

## Symptom
{{symptom}}

## Context
{{context|unknown — inspect repo and environment}}

## Reproduction
{{repro|Try to find a minimal repro; write it down before fixing.}}

## Method (follow strictly)
1. **Reproduce** (or state why not)
2. **Observe** — logs, stack, failing test, bisect signals
3. **Hypotheses** — ranked, falsifiable
4. **Probe** — one experiment at a time
5. **Localize** — file/function
6. **Fix** — minimal
7. **Verify** — regression test if possible
8. **Cleanup** — remove debug noise

## Output
- Root cause (confidence %)
- Fix summary + code changes
- How you verified
- Residual risks
