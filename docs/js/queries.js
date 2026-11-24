// Every question Rungs asks, as Cypher against the Relate graph. Shown verbatim in the
// "Under the hood" drawer and mirrored in /queries for the CLI and MCP.

export const Q = {
  search: {
    needs: 'search',
    about: 'Find an occupation by its official title or any of ~54,000 alternate job titles.',
    cypher: `MATCH (o:Occupation)
WITH o, toLower(o.title) AS t, [x IN o.titles WHERE toLower(x) CONTAINS $q] AS hits
WHERE t CONTAINS $q OR size(hits) > 0
RETURN o.code AS code, o.title AS title, o.jobZone AS zone, hits[0] AS matched,
       CASE WHEN t STARTS WITH $q THEN 0 WHEN t CONTAINS $q THEN 1 ELSE 2 END AS rank
ORDER BY rank, size(o.title)
LIMIT 8`,
  },

  profile: {
    needs: 'skills',
    about: 'Your skill fingerprint: what your current job already trains you in.',
    cypher: `MATCH (me:Occupation {code: $code})
OPTIONAL MATCH (me)-[n:NEEDS]->(k:Skill)
WITH me, k, n ORDER BY n.importance * n.level DESC
RETURN me.title AS title, me.description AS description, me.jobZone AS zone,
       me.titles[0..6] AS aka,
       collect({name: k.name, kind: k.kind, importance: n.importance, level: n.level})[0..10] AS skills`,
  },

  moves: {
    needs: 'skills',
    about: 'Next rungs: every career move one STEP away, with the gap recomputed live from YOUR skills (including ones you marked "I already have").',
    cypher: `MATCH (me:Occupation {code: $code})-[s:STEP]->(t:Occupation)
CALL (me, t) {
  MATCH (t)-[n:NEEDS]->(k:Skill) WHERE n.importance >= 2.75
  OPTIONAL MATCH (me)-[m:NEEDS]->(k)
  WITH k, n, CASE WHEN k.name IN $have THEN n.level ELSE coalesce(m.level, 0.0) END AS mine
  WITH k, n, n.level - mine AS deficit
  WHERE deficit > 0
  WITH k, n, deficit ORDER BY deficit * n.importance DESC
  RETURN sum(deficit * n.importance / 5) AS gap,
         [x IN collect(CASE WHEN deficit >= 1 THEN k.name END) WHERE x IS NOT NULL] AS learn
}
CALL (me, t) {
  OPTIONAL MATCH (t)-[u:USES]->(sw:Software) WHERE NOT (me)-[:USES]->(sw)
  WITH sw, u ORDER BY u.inDemand DESC
  RETURN [x IN collect(sw.name) WHERE x IS NOT NULL][0..4] AS tools
}
RETURN t.code AS code, t.title AS title, t.jobZone AS zone, s.climb AS climb,
       round(s.similarity * 100) AS match, round(gap, 1) AS gap, learn[0..5] AS learn, tools
ORDER BY gap
LIMIT 24`,
  },

  neighborhood: {
    needs: 'moves',
    about: 'The network around you: direct moves, and the best moves from each of those.',
    cypher: `MATCH (me:Occupation {code: $code})-[s1:STEP]->(a:Occupation)
WITH me, a, s1 ORDER BY s1.gap LIMIT 14
OPTIONAL MATCH (a)-[s2:STEP]->(b:Occupation) WHERE b <> me
WITH me, a, s1, b, s2 ORDER BY s2.gap
WITH me, a, s1, collect({code: b.code, title: b.title, zone: b.jobZone, gap: s2.gap, climb: s2.climb})[0..3] AS next
RETURN me.code AS center, me.title AS centerTitle, me.jobZone AS centerZone,
       collect({code: a.code, title: a.title, zone: a.jobZone, gap: s1.gap, climb: s1.climb, next: next}) AS ring`,
  },

  routes: {
    needs: 'full',
    about: 'Dream-job ladder: candidate chains over skill-match moves (STEP) and O*NET\'s curated related occupations (RELATED), ranked by the skills each move needs plus how close every stepping stone gets you to the goal.',
    cypher: `MATCH (me:Occupation {code: $from}), (goal:Occupation {code: $to})
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
WITH [n IN ns | {code: n.code, title: n.title, zone: n.jobZone}] AS rungs,
     [r IN relationships(p) | {gap: r.gap, learn: r.newSkills[0..3], via: type(r)}] AS moves,
     hops, hops + 0.8 * detour + 4 * size(ns) AS score
WITH rungs, min(score) AS score, head(collect(moves)) AS moves, min(hops) AS total
RETURN rungs, moves, round(total, 1) AS total
ORDER BY score
LIMIT 3`,
  },

  keystones: {
    needs: 'skills',
    about: 'Keystone skills: the job-specific skills (not basics like reading or speaking) that unlock the most moves within two steps, weighted toward moves that climb.',
    cypher: `MATCH (me:Occupation {code: $code})-[s:STEP]->(a:Occupation)
OPTIONAL MATCH (a)-[s2:STEP]->(b:Occupation)
WITH me, collect(DISTINCT {t: a, up: s.climb}) + collect(DISTINCT {t: b, up: s.climb + coalesce(s2.climb, 0)}) AS reach
UNWIND reach AS r
WITH me, r.t AS t, max(r.up) AS up WHERE t IS NOT NULL AND t <> me
MATCH (t)-[n:NEEDS]->(k:Skill) WHERE n.importance >= 3.25 AND k.kind <> 'essential' AND NOT k.name IN $have
OPTIONAL MATCH (me)-[m:NEEDS]->(k)
WITH k, t, up, n.level - coalesce(m.level, 0.0) AS deficit
WHERE deficit >= 1
RETURN k.name AS skill, k.kind AS kind, count(DISTINCT t) AS unlocks,
       count(DISTINCT CASE WHEN up > 0 THEN t END) AS upward
ORDER BY upward * 2 + unlocks DESC
LIMIT 6`,
  },

  job: {
    needs: 'full',
    about: 'Details for one occupation, including O*NET\'s own related occupations.',
    cypher: `MATCH (o:Occupation {code: $code})
OPTIONAL MATCH (o)-[r:RELATED]->(rel:Occupation) WHERE r.tier = 'Primary-Short'
WITH o, rel ORDER BY r.rank
RETURN o.title AS title, o.description AS description, o.jobZone AS zone, o.titles[0..8] AS aka,
       collect(rel.title)[0..5] AS related`,
  },

  skills: {
    needs: 'skills',
    about: 'All 68 O*NET skills and knowledge areas, for the "I already have…" picker.',
    cypher: `MATCH (k:Skill) RETURN k.name AS name, k.kind AS kind ORDER BY k.kind, k.name`,
  },

  stats: {
    needs: 'full',
    about: 'What is in the graph.',
    cypher: `MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC`,
  },
};

export const ZONES = {
  1: { short: 'Little prep', long: 'Little or no preparation needed' },
  2: { short: 'Some prep', long: 'Some preparation: high school, short training' },
  3: { short: 'Medium prep', long: 'Medium preparation: vocational training or associate degree' },
  4: { short: 'Considerable prep', long: 'Considerable preparation: usually a bachelor\'s degree' },
  5: { short: 'Extensive prep', long: 'Extensive preparation: graduate degree' },
};
