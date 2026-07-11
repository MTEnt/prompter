---
id: deep-research
title: Deep research
description: Sourced research brief with claims, confidence, and open questions.
category: research
tags: [research, analysis]
targets: [codex, claude, grok, gemini, generic]
defaultTask: research
defaultStrength: medium
variables:
  - name: question
    required: true
  - name: constraints
    required: false
---

## Question
{{question}}

## Constraints
{{constraints|Prefer primary sources; note date and confidence.}}

## Method
1. Clarify scope in one line
2. Gather sources (web/tools as allowed)
3. Synthesize; separate fact vs inference
4. List disagreements / unknowns

## Output format
- **Answer** (executive)
- **Key findings** (bullets with sources)
- **Tradeoffs / alternatives**
- **Open questions**
- **References**

Do not invent citations. If unknown, say unknown.
