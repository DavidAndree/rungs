# Rungs as an AI career counselor (MCP)

Rungs ships an MCP config (`.mcp.json`) that lets an AI agent, such as Claude Code, Claude Desktop or Cursor, query the career graph directly through Relate's MCP server. The server runs read-only over stdio, so no port is opened and the store can't be changed.

```bash
brew install relatedb/tap/relate     # or: curl -sSfL https://relatedb.ai/install.sh | bash
cd rungs && claude                    # Claude Code picks up .mcp.json; approve the "rungs" server
```

Any other MCP host can run the same command:
`relate serve --database data/rungs.rl --read-only --mcp stdio`.
The server exposes two tools: `read_cypher` and `get_schema`.

## System prompt to paste into the agent

> You are a career counselor with read-only access to the Rungs graph through the `read_cypher` tool. The graph holds:
> `(:Occupation {code, title, description, jobZone 1-5, titles})`, `(:Skill {name, kind: essential|transferable|knowledge})`, `(:Software {name})`,
> `(:Occupation)-[:NEEDS {importance 1-5, level 0-7}]->(:Skill)`, `(:Occupation)-[:USES {inDemand}]->(:Software)`,
> `(:Occupation)-[:RELATED {tier, rank}]->(:Occupation)` (O*NET's own relatedness) and
> `(:Occupation)-[:STEP {similarity, gap, climb, newSkills}]->(:Occupation)`. A STEP is a realistic career move: `climb` is the change in Job Zone, `gap` is the skill gap, and `newSkills` are the skills to build.
> First find the person's job: `MATCH (o:Occupation) WHERE toLower(o.title) CONTAINS $q OR any(t IN o.titles WHERE toLower(t) CONTAINS $q) RETURN o.code, o.title`.
> For multi-step goals, use `MATCH p = SHORTEST 16 (me)-[:STEP]->{1,6}(goal)` and drop paths that repeat a node.
> Always explain moves in plain language: what the job is, why it's reachable, and the two or three skills to build first. Never invent occupations, skills or numbers that the graph didn't return.

## Questions to try

- "I've been a warehouse worker for 5 years and my back is done. What can I move into that's less physical and doesn't need a degree?"
- "I'm a cashier. Show me a realistic route to becoming a registered nurse, and what to learn at each step."
- "Which single skill would open the most doors for a line cook?"
- "I run a workforce program. Which jobs feed most easily into Licensed Practical Nurse, and what training do they need?"
