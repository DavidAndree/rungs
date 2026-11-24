// Relate (WebAssembly) runs here, off the main thread, so the page stays smooth while
// ~76,000 relationships load. The main thread talks to it with {id, cypher, params} messages.
import init, { RelateDb } from 'https://cdn.jsdelivr.net/npm/@relate/relate-wasm@1.2.0/relate.js';

let db = null;
const ready = new Set();
const waiting = [];

function run(cypher, params) {
  const out = JSON.parse(db.execute(cypher, params ? JSON.stringify(params) : null));
  if (out.error) throw new Error(out.error.message || JSON.stringify(out.error));
  return out;
}

// The same statements as scripts/build_graph.py, so the browser holds the identical graph.
const LOAD = [
  { stage: 'search', label: 'Indexing occupations', key: 'occupations', cypher: 'UNWIND $rows AS r CREATE (:Occupation {code: r.code, title: r.title, description: r.description, jobZone: r.jobZone, titles: r.titles})' },
  { stage: 'moves', label: 'Linking career moves', key: 'steps', cypher: 'UNWIND $rows AS r MATCH (a:Occupation {code: r.from}), (b:Occupation {code: r.to}) CREATE (a)-[:STEP {similarity: r.similarity, gap: r.gap, climb: r.climb, newSkills: r.newSkills}]->(b)' },
  { stage: 'skills', label: 'Adding skills', key: 'skills', cypher: 'UNWIND $rows AS r CREATE (:Skill {id: r.id, name: r.name, kind: r.kind})' },
  { stage: 'skills', label: 'Connecting skill requirements', key: 'needs', cypher: 'UNWIND $rows AS r MATCH (o:Occupation {code: r.code}), (s:Skill {id: r.id}) CREATE (o)-[:NEEDS {importance: r.importance, level: r.level}]->(s)' },
  { stage: 'full', label: 'Adding in-demand software', key: 'software', rowsOf: (g) => g.software, cypher: 'UNWIND $rows AS r CREATE (:Software {name: r})' },
  { stage: 'full', label: 'Connecting software', key: 'uses', cypher: 'UNWIND $rows AS r MATCH (o:Occupation {code: r.code}), (s:Software {name: r.name}) CREATE (o)-[:USES {inDemand: r.inDemand}]->(s)' },
  { stage: 'full', label: 'Adding O*NET related occupations', key: 'related', cypher: 'UNWIND $rows AS r MATCH (a:Occupation {code: r.a}), (b:Occupation {code: r.b}) CREATE (a)-[:RELATED {tier: r.tier, rank: r.rank, gap: r.gap, climb: r.climb, newSkills: r.newSkills}]->(b)' },
];

async function boot(graphUrl) {
  const t0 = performance.now();
  post({ type: 'progress', label: 'Starting Relate (WebAssembly)', pct: 2 });
  await init();
  db = new RelateDb();
  for (const idx of [
    'CREATE INDEX occ_code IF NOT EXISTS FOR (o:Occupation) ON (o.code)',
    'CREATE INDEX skill_id IF NOT EXISTS FOR (s:Skill) ON (s.id)',
    'CREATE INDEX software_name IF NOT EXISTS FOR (s:Software) ON (s.name)',
  ]) run(idx);

  post({ type: 'progress', label: 'Downloading the O*NET career graph', pct: 6 });
  const g = await (await fetch(graphUrl)).json();
  const total = LOAD.reduce((s, l) => s + g[l.key].length, 0);
  let done = 0; let rels = 0;
  for (let i = 0; i < LOAD.length; i++) {
    const step = LOAD[i];
    const rows = g[step.key];
    for (let k = 0; k < rows.length; k += 2500) {
      const out = run(step.cypher, { rows: rows.slice(k, k + 2500) });
      rels += out.stats?.relationships_created || 0;
      done += Math.min(2500, rows.length - k);
      post({ type: 'progress', label: step.label, pct: 8 + Math.round((done / total) * 92), rels });
    }
    const next = LOAD[i + 1];
    if (!next || next.stage !== step.stage) markReady(step.stage);
  }
  post({ type: 'loaded', ms: Math.round(performance.now() - t0), rels, nodes: g.occupations.length + g.skills.length + g.software.length });
}

function markReady(stage) {
  ready.add(stage);
  post({ type: 'stage', stage });
  for (let i = waiting.length - 1; i >= 0; i--) {
    if (ready.has(waiting[i].needs)) { const w = waiting.splice(i, 1)[0]; answer(w.msg); }
  }
}

function answer({ id, cypher, params }) {
  try {
    const out = run(cypher, params);
    post({ type: 'result', id, rows: out.rows, ms: out.elapsed_ms ?? out.execute_ms ?? null });
  } catch (e) {
    post({ type: 'result', id, error: e.message });
  }
}

function post(m) { self.postMessage(m); }

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'boot') boot(m.graphUrl).catch((err) => post({ type: 'fatal', error: err.message }));
  else if (m.type === 'query') {
    if (db && ready.has(m.needs || 'full')) answer(m);
    else waiting.push({ needs: m.needs || 'full', msg: m });
  }
};
