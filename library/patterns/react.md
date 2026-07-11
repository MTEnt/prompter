---
id: react
title: ReAct (reason + act)
summary: Interleave reasoning with tool actions for research and debugging.
tags: [pattern, agents, tools]
---

# Pattern: ReAct

Loop:

1. **Thought** — what you need next  
2. **Action** — tool/command  
3. **Observation** — result  
4. Repeat until solved; then **Final answer**

Tell the agent: do not invent observations; only use real tool output.
