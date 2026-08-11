---
name: query-agent
description: Use when needing to analyze human review verdicts to improve manifest authoring.
category: studio
---

# Query Agent Skill

The `query-agent.mjs` is a read-only CLI tool used to consult accumulated human review verdicts. This allows AI agents to identify what makes a render "good" or "bad" and avoid repeating mistakes.

## Usage

All commands require the `--db` flag to point to the review database.
**Database Path:** `studio/server/db/reviews.db`

### 1. Analyze Aggregate Patterns
Use this to see category averages and the most common tags in good vs. bad renders.
```bash
node studio/server/query-agent.mjs --db studio/server/db/reviews.db patterns
```

### 2. Find Successful Examples
List renders that received a "good" verdict to identify patterns to emulate.
```bash
node studio/server/query-agent.mjs --db studio/server/db/reviews.db good
```
*Optional flags:* `--limit N`, `--min-score N`, `--category KEY`

### 3. Analyze Failures
List renders that received a "bad" verdict to identify pitfalls to avoid.
```bash
node studio/server/query-agent.mjs --db studio/server/db/reviews.db bad
```
*Optional flags:* `--limit N`, `--max-score N`, `--category KEY`

### 4. Search for Specific Issues
Search for keywords in the notes or tags (e.g., "composition", "font", "color").
```bash
node studio/server/query-agent.mjs --db studio/server/db/reviews.db search <keyword>
```

### 5. Inspect a Specific Project
Get all reviews for a specific project ID.
```bash
node studio/server/query-agent.mjs --db studio/server/db/reviews.db project <projectId>
```

## Pitfalls & Tips
- **DB Path**: The tool defaults to `./review-tool-data/reviews.db`, which is often incorrect. Always explicitly provide `--db studio/server/db/reviews.db`.
- **JSON Output**: Use the `--json` flag if you need to programmatically process the results.
- **Verification**: After applying a "good" pattern, search for similar keywords in the "bad" renders to ensure you haven't accidentally introduced a different known issue.
