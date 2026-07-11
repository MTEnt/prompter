---
id: dataset-quality
title: Dataset quality audit
description: Lint/validate SFT or DPO JSONL before training.
category: training
tags: [training, data, eval]
targets: [codex, claude, grok, gemini, generic]
defaultTask: training
defaultStrength: medium
variables:
  - name: path
    required: true
  - name: kind
    required: false
    default: sft
---

## Goal
Audit training data at `{{path}}` (kind: {{kind}}).

## Checks
- Schema / required fields
- Empty or near-empty samples
- Leakage into eval/gold
- Label noise / contradiction
- Length outliers
- Format gaming (looks valid, wrong semantics)

## Output
- Severity-ranked issues with counts
- Sample bad rows (ids or excerpts)
- Go / no-go recommendation for training
- Fix script ideas if automation helps
