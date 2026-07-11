---
id: prompt-library-entry
title: Meta — draft a library template
description: Create a new Prompter template in frontmatter+markdown form.
category: meta
tags: [meta, library]
targets: [codex, claude, grok, gemini, generic]
defaultTask: writing
defaultStrength: medium
variables:
  - name: purpose
    required: true
---

## Goal
Draft a new Prompter library template for: {{purpose}}

## Output format
A single markdown file with YAML frontmatter:

```yaml
---
id: kebab-case-id
title: Human title
description: One line
category: coding|design|training|research|writing|agent|meta
tags: [a, b]
targets: [codex, claude, grok, gemini, cursor, generic]
defaultTask: coding
defaultStrength: medium
variables:
  - name: example
    required: true
    help: ...
---
```

Body uses `{{variables}}` and optional `{{var|default}}`.

## Rules
- Multi-tool friendly (not locked to one vendor)
- Clear required vs optional vars
- Include definition of done when task is agentic
