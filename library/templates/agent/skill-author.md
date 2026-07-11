---
id: skill-author
title: Author an agent skill
description: Create a portable SKILL.md for Codex / Claude / Cursor / Gemini.
category: agent
tags: [agent, skills, meta]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: strong
variables:
  - name: skill_name
    required: true
  - name: when_to_use
    required: true
  - name: workflow
    required: false
source: Agent Skills standard practice
---

## Goal
Author an Agent Skill named `{{skill_name}}`.

## Trigger description
The skill should activate when: {{when_to_use}}

## Workflow to encode
{{workflow|Step-by-step domain workflow with checks and anti-patterns.}}

## Output
Create:

```text
.agents/skills/{{skill_name}}/SKILL.md
```

With YAML frontmatter:

```yaml
---
name: {{skill_name}}
description: <trigger-tuned description; when to use AND not use>
---
```

## Requirements
- One job per skill; progressive disclosure (keep SKILL.md focused)
- Imperative steps, explicit inputs/outputs
- Scripts only if deterministic tooling is needed
- Compatible with Codex, Claude Code, Cursor, Gemini skill folders
- Include a short “do not” section

## Definition of done
- Valid frontmatter name + description
- Clear activation boundaries
- Usable by an agent without extra tribal knowledge
