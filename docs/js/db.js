// Main-thread client for the Relate worker. Every query is logged for the "Under the hood" drawer.
import { Q } from './queries.js?v=9';

const worker = new Worker(new URL('./worker.js?v=9', import.meta.url), { type: 'module' });
const pending = new Map();
const listeners = new Set();
let seq = 0;
export const log = [];
export const status = { stages: new Set(), loaded: false, rels: 0, ms: 0 };

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'result') {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    const entry = { name: p.name, about: Q[p.name].about, cypher: Q[p.name].cypher, params: p.params, ms: m.ms, rows: m.rows?.length ?? 0, error: m.error, at: new Date() };
    log.unshift(entry); if (log.length > 60) log.pop();
    emit({ type: 'log', entry });
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.rows);
    return;
  }
  if (m.type === 'stage') status.stages.add(m.stage);
  if (m.type === 'loaded') Object.assign(status, { loaded: true, rels: m.rels, ms: m.ms, nodes: m.nodes });
  emit(m);
};
worker.onerror = (e) => emit({ type: 'fatal', error: e.message || 'Worker failed to start' });

function emit(m) { for (const fn of listeners) fn(m); }
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function boot() {
  worker.postMessage({ type: 'boot', graphUrl: new URL('../graph.json?v=9', import.meta.url).href });
}

export function query(name, params = {}) {
  const q = Q[name];
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, name, params });
    worker.postMessage({ type: 'query', id, cypher: q.cypher, params, needs: q.needs });
  });
}
