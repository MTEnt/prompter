---
id: improve-this-prompt
title: Meta: improve this prompt
description: Second-order prompt: ask the model to rewrite a weak prompt (when not using Prompter local engine).
category: meta
tags: [meta, prompt-engineering]
targets: [codex, claude, grok, gemini, generic]
defaultTask: general
defaultStrength: medium
variables:
  - name: raw
    required: true
  - name: target
    required: false
    default: a coding agent
---

Rewrite the following into a high-quality prompt for {{target}}.

Requirements for your rewrite:
- Preserve intent
- Add structure: goal, context, constraints, output format, definition of done
- Remove filler; use imperative language
- Output **only** the improved prompt

Original:
---
{{raw}}
---
