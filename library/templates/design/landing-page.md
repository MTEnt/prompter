---
id: landing-page
title: Landing page brief
description: Marketing/landing composition with narrative and restraint.
category: design
tags: [design, landing, marketing]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: design
defaultStrength: strong
variables:
  - name: product
    required: true
  - name: audience
    required: false
  - name: promise
    required: false
---

## Goal
Build/improve a landing page for **{{product}}**.

## Audience
{{audience|primary buyers / users}}

## Promise
{{promise|one clear value proposition}}

## Narrative structure
1. Hero: brand, promise, CTA, one dominant visual
2. Support: one concrete proof/feature
3. Detail: product depth
4. Final CTA

## Hard rules
- Brand first on branded pages
- No hero card soup / stat strips by default
- Two typefaces max, one accent by default
- Real copy, not lorem
- Responsive + accessible

## Output
Working page/section code in the project’s stack, ready to open in a browser.
