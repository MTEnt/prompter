---
id: chain-of-thought
title: Chain of thought (structured)
summary: Ask for stepwise reasoning without forcing useless verbosity.
tags: [pattern, reasoning]
---

# Pattern: Structured chain of thought

Prefer:

> Reason step by step **internally**, then give a concise answer. Show a short **reasoning outline** only when useful (tradeoffs, debug, math).

For coding agents, replace free-form CoT with:

1. Hypothesis  
2. Evidence  
3. Action  
4. Verification
