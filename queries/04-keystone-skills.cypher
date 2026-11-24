// Which job-specific skill would open the most doors within two moves of $code?
MATCH (me:Occupation {code: $code})-[s:STEP]->(a:Occupation)
OPTIONAL MATCH (a)-[s2:STEP]->(b:Occupation)
WITH me, collect(DISTINCT a) + collect(DISTINCT b) AS reach
UNWIND reach AS t
WITH DISTINCT me, t WHERE t IS NOT NULL AND t <> me
MATCH (t)-[n:NEEDS]->(k:Skill) WHERE n.importance >= 3.25 AND k.kind <> 'essential'
OPTIONAL MATCH (me)-[m:NEEDS]->(k)
WITH k, t, n.level - coalesce(m.level, 0.0) AS deficit WHERE deficit >= 1
RETURN k.name AS skill, k.kind AS kind, count(DISTINCT t) AS jobs_it_unlocks
ORDER BY jobs_it_unlocks DESC LIMIT 8;
