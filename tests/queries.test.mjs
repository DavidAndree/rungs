// Loads docs/graph.json into Relate WASM exactly like the browser worker, then runs every app query.
import fs from 'node:fs';
import init, { RelateDb } from '@relate/relate-wasm';
import { Q } from '../docs/js/queries.js';

const wasm = fs.readFileSync(new URL('../node_modules/@relate/relate-wasm/relate_bg.wasm', import.meta.url));
await init({ module_or_path: wasm });
const db = new RelateDb();
const run = (cy, p) => { const o = JSON.parse(db.execute(cy, p ? JSON.stringify(p) : null)); if (o.error) throw new Error(o.error.message || JSON.stringify(o.error)); return o; };
const g = JSON.parse(fs.readFileSync(new URL('../docs/graph.json', import.meta.url)));
const src = fs.readFileSync(new URL('../docs/js/worker.js', import.meta.url), 'utf8');
const LOAD = [...src.matchAll(/key: '(\w+)'[^\n]*?cypher: '([^']+)'/g)].map((m) => ({ key: m[1], cypher: m[2] }));
for (const idx of ['CREATE INDEX occ_code IF NOT EXISTS FOR (o:Occupation) ON (o.code)', 'CREATE INDEX skill_id IF NOT EXISTS FOR (s:Skill) ON (s.id)', 'CREATE INDEX software_name IF NOT EXISTS FOR (s:Software) ON (s.name)']) run(idx);
const t0 = performance.now();
for (const l of LOAD) for (let k = 0; k < g[l.key].length; k += 2500) run(l.cypher, { rows: g[l.key].slice(k, k + 2500) });
console.log(`loaded ${LOAD.length} statements in ${(performance.now() - t0).toFixed(0)} ms`);

const params = {
  search: { q: 'barista' }, profile: { code: '41-2011.00' }, moves: { code: '41-2011.00', have: [] },
  neighborhood: { code: '41-2011.00' }, routes: { from: '53-7062.00', to: '29-1141.00' },
  keystones: { code: '41-2011.00', have: [] }, job: { code: '13-1031.00' }, skills: {}, stats: {},
};
let failed = 0;
for (const [name, q] of Object.entries(Q)) {
  try {
    const o = run(q.cypher, params[name]);
    const preview = JSON.stringify(o.rows).slice(0, 260);
    console.log(`✔ ${name.padEnd(12)} ${String(o.rows.length).padStart(3)} rows ${(o.elapsed_ms ?? 0).toFixed(1).padStart(7)} ms  ${preview}`);
    if (!o.rows.length && name !== 'skills') { failed++; console.log('   ✘ expected rows'); }
  } catch (e) { failed++; console.log(`✘ ${name}: ${e.message.slice(0, 400)}`); }
}
process.exit(failed ? 1 : 0);
