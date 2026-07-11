---
id: code-review
title: Code review
description: Structured review with severity, security awareness, and actionable fixes.
category: coding
tags: [coding, review, security]
targets: [codex, claude, grok, gemini, cursor, copilot, generic]
defaultTask: coding
defaultStrength: strong
variables:
  - name: scope
    required: true
    help: PR, branch, paths, or paste description
  - name: focus
    required: false
    default: correctness, security, maintainability, performance
source: Prompter original (inspired by security-review culture)
---

## Goal
Review {{scope}} for {{focus}}.

## Output format
1. **Summary** (3–6 lines)
2. **Findings** ordered by severity: `blocker` | `major` | `minor` | `nit`
   - For each: location, issue, why it matters, concrete fix
3. **Questions / assumptions**
4. **Optional patches** only if clearly helpful (do not rewrite the world)

## Rules
- Prefer evidence from the actual code; do not invent files.
- Call out OWASP-style issues when relevant (injection, authz, secrets, unsafe defaults).
- Separate style nits from real defects.
- If something looks fine, say what you checked—not empty praise.
