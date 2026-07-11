---
id: definition-of-done
title: Definition of done
summary: Explicit success criteria and verification commands.
tags: [pattern, quality]
---

# Pattern: Definition of done

Always end agent briefs with:

- **Deliverable** (what exists when finished)
- **Verification** (commands/tests/manual checks)
- **Out of scope** (what not to do)

Example:

```
## Definition of done
- [ ] Feature works for the described path
- [ ] `npm test` / `cargo test` passes
- [ ] No unrelated refactors
```
