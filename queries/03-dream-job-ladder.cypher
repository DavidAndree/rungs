// Dream-job ladder from $from to $to.
// Candidates: shortest chains over skill-match moves (STEP) and O*NET's curated related occupations (RELATED).
// Ranked by the skill gap of each move plus how close every stepping stone gets you to the goal.
MATCH (me:Occupation {code: $from}), (goal:Occupation {code: $to})
MATCH p = SHORTEST 48 (me)-[:STEP|RELATED]->{1,6}(goal)
WITH goal, p, nodes(p) AS ns
WHERE all(x IN ns WHERE single(y IN ns WHERE y = x))
WITH goal, p, ns, reduce(g = 0.0, r IN relationships(p) | g + r.gap) AS hops
CALL (goal, ns) {
  UNWIND ns[1..-1] AS x
  MATCH (goal)-[n:NEEDS]->(k:Skill) WHERE n.importance >= 2.75
  OPTIONAL MATCH (x)-[m:NEEDS]->(k)
  WITH x, sum(CASE WHEN n.level > coalesce(m.level, 0.0)
                   THEN (n.level - coalesce(m.level, 0.0)) * n.importance / 5 ELSE 0.0 END) AS toGoal
  RETURN coalesce(avg(toGoal), 0.0) AS detour
}
WITH [n IN ns | n.title] AS ladder, [r IN relationships(p) | type(r) + ': ' + coalesce(r.newSkills[0], 'ready')] AS moves,
     hops, hops + 0.8 * detour + 4 * size(ns) AS score
WITH ladder, min(score) AS score, head(collect(moves)) AS moves, min(hops) AS total_gap
RETURN ladder, moves, round(total_gap, 1) AS total_gap
ORDER BY score LIMIT 3;
