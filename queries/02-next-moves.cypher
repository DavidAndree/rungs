// Realistic next moves from a job ($code, default: Cashiers), easiest first.
// Run: relate query -d data/rungs.rl --read-only --param 'code="41-2011.00"' < queries/02-next-moves.cypher
MATCH (me:Occupation {code: $code})-[s:STEP]->(t:Occupation)
RETURN t.title AS move,
       CASE WHEN s.climb > 0 THEN 'step up' WHEN s.climb < 0 THEN 'less prep' ELSE 'same level' END AS direction,
       round(s.similarity * 100) AS match_pct, s.gap AS gap, s.newSkills[0..3] AS learn
ORDER BY s.gap LIMIT 10;
