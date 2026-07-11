---
id: lora-sft-plan
title: LoRA / SFT training plan
description: End-to-end fine-tune plan for agents (data → train → eval).
category: training
tags: [training, lora, sft, ml]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: training
defaultStrength: strong
variables:
  - name: base_model
    required: true
  - name: data_path
    required: true
  - name: method
    required: false
    default: QLoRA SFT
  - name: hardware
    required: false
    default: single GPU / Mac MLX as available
---

## Goal
Plan and (if asked) run **{{method}}** on **{{base_model}}** using data at `{{data_path}}`.

## Hardware
{{hardware}}

## Non-negotiables
- Do **not** train on held-out gold/eval sets unless explicitly overridden
- Prefer adapters (LoRA/QLoRA/MLX LoRA) over full FT
- Record hyperparams, data manifest, output adapter path

## Required plan sections
1. Data validation (format, size, split)
2. Method choice (LoRA vs QLoRA vs MLX) + rank/alpha/targets
3. Train config path (use project templates if present)
4. Eval plan (metrics + held-out set)
5. Risks (overfit, template mismatch, VRAM)

## Skills
If present: `$chalad-training`, `$lora`, `$qlora`, `$mlx`, `$trl-training`, `$huggingface-llm-trainer`.

## Definition of done
- Written plan with concrete commands
- Or a completed run with adapter + eval summary
