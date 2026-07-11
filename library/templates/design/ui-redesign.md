---
id: ui-redesign
title: UI redesign / polish
description: Frontend design brief with anti-slop constraints for coding agents.
category: design
tags: [design, frontend, ui]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: design
defaultStrength: strong
variables:
  - name: surface
    required: true
    help: Page/component to improve
  - name: direction
    required: false
    help: Aesthetic direction
  - name: constraints
    required: false
---

## Goal
Improve UI for: {{surface}}

## Visual direction
{{direction|Distinctive, intentional, product-grade. Not generic AI SaaS.}}

## Constraints
{{constraints|Preserve brand tokens and behavior unless redesign is explicit.}}

## Anti-patterns (avoid)
- Inter/Roboto-only defaults, purple gradients, nested card grids
- Gray text on colored backgrounds, emoji-as-icons, bounce easing
- Cluttered heroes, weak brand hierarchy

## If skills exist
Load frontend/design skills (e.g. `$gpt-taste`, `$frontend-design`, `$impeccable`) and follow them.

## Definition of done
- Clear hierarchy on mobile + desktop
- Accessible contrast and focus states
- Complete CSS/markup. No placeholders
- Matches direction without breaking core UX
