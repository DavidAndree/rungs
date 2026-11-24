// What is in the Rungs graph?
MATCH (n) RETURN labels(n)[0] AS label, count(*) AS nodes ORDER BY nodes DESC;
MATCH ()-[r]->() RETURN type(r) AS relationship, count(*) AS edges ORDER BY edges DESC;
