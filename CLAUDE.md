

## graphify

This project has a knowledge graph at `graphify-out/` (not tracked in git; build it locally with `graphify extract .`).

**Before exploring code, use graphify first:**
```bash
graphify query "what you want to understand"
graphify path "ComponentA" "ComponentB"
graphify explain "concept"
```

The graph is faster and more accurate than grepping files; it captures cross-file relationships.
After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
