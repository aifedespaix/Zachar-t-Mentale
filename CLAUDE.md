# Zachar't Mentale — agent instructions

Tauri + React/TypeScript app (not a monorepo). Frontend in `src/`, Rust backend in `src-tauri/`.

## Explore via the knowledge graph first

A graphify knowledge graph exists at `graphify-out/graph.json` (513 nodes, 28 communities, rebuilt from `git rev-parse HEAD`). For any question about architecture, "what calls X", data flow, or "where does Y live" — run `/graphify query "<question>"` before grepping or reading files raw. This applies to subagents too: if you spawn an Explore/general-purpose agent for a codebase question, tell it to check for `graphify-out/graph.json` and query it first instead of walking the tree cold.

Only fall back to raw Read/Grep when the graph doesn't cover it (e.g. reading exact current line numbers to edit, or files added since the last commit).

If files under `src/` or `src-tauri/` changed materially, the graph may be stale — run `graphify update .` (no LLM cost) rather than re-reading everything by hand.

## Course source PDFs are opaque

`.cartes-mentales/**/*.pdf` are raw course sources (10-40MB each) feeding the `transformer-cours-en-carte-mentale` skill — they're gitignored and excluded from `rtk grep`/`rtk read`. Don't Read them directly unless the task is specifically converting that course; the generated `.json` mind maps next to them are the thing to inspect for content.

## RTK is already active

Bash and PowerShell tool calls are auto-rewritten through `rtk` via a PreToolUse hook — you don't need to type `rtk` prefixes yourself. Don't route around it with `rtk proxy`/`rtk run` unless you specifically need unfiltered output for debugging.
