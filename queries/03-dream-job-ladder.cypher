// Shortest chains of realistic moves from $from to $to (default: Cashiers -> Software Developers).
MATCH (me:Occupation {code: $from}), (goal:Occupation {code: $to})
MATCH p = SHORTEST 16 (me)-[:STEP]->{1,6}(goal)
WITH p, nodes(p) AS ns
WHERE all(x IN ns WHERE single(y IN ns WHERE y = x))
RETURN [n IN ns | n.title] AS ladder,
       [r IN relationships(p) | r.newSkills[0..2]] AS learn_at_each_rung,
       round(reduce(g = 0.0, r IN relationships(p) | g + r.gap), 1) AS total_gap
ORDER BY total_gap + 5 * size(ladder) LIMIT 3;
