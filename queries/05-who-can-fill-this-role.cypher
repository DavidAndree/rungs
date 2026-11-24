// Reverse view for employers and workforce boards: which jobs feed into $code most easily?
MATCH (src:Occupation)-[s:STEP]->(t:Occupation {code: $code})
RETURN src.title AS feeder_job, src.jobZone AS prep_level, s.gap AS gap, s.newSkills[0..3] AS training_needed
ORDER BY s.gap LIMIT 10;
