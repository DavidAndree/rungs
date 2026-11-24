import { boot, query, on, log, status } from './db.js?v=9';
import { ZONES } from './queries.js?v=9';
import { createNetwork } from './viz.js?v=9';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kind = (c) => (c > 0 ? 'up' : c < 0 ? 'down' : 'same');
const readiness = (gap) => Math.max(4, Math.min(99, Math.round(100 - gap * 2.2)));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { code: null, goal: null, have: new Set(store.get('rungs:have', [])), filter: 'all', moves: [], selected: null };
let net = null;

/* ---------------- engine status ---------------- */
on((m) => {
  if (m.type === 'progress') {
    $('#load-label').textContent = m.label;
    $('#load-pct').textContent = `${m.pct}%`;
    $('#load-bar').style.width = `${m.pct}%`;
    if (m.rels) $('#load-sub').textContent = `${m.rels.toLocaleString()} relationships built in this tab so far. No server, no sign-up.`;
    $('#engine-text').textContent = `Relate · loading ${m.pct}%`;
  } else if (m.type === 'stage' && m.stage === 'search') {
    $('#search').placeholder = 'Your current or last job: e.g. cashier, barista, line cook';
  } else if (m.type === 'loaded') {
    $('#engine').classList.add('ok');
    $('#engine-text').textContent = `Relate · ${(m.rels / 1000).toFixed(1)}k relationships in-browser`;
    $('#load-label').textContent = 'Graph ready';
    $('#load-pct').textContent = `${(m.ms / 1000).toFixed(1)}s`;
    $('#load-sub').textContent = `${m.nodes.toLocaleString()} nodes and ${m.rels.toLocaleString()} relationships, built by Relate (WebAssembly) in ${(m.ms / 1000).toFixed(1)}s.`;
    setTimeout(() => $('#loader').classList.add('done'), 2200);
  } else if (m.type === 'fatal') {
    $('#engine-text').textContent = 'Relate failed to start';
    $('#load-label').textContent = 'Could not start the graph engine';
    $('#load-sub').textContent = `${m.error}. Try a recent Chrome, Edge, Firefox or Safari.`;
  } else if (m.type === 'log') {
    $('#hood-count').textContent = log.length;
    if (!$('#hood').hidden) renderHood();
  }
});

/* ---------------- search (used twice: your job and your goal) ---------------- */
function attachSearch(input, list, onChoose) {
  let items = []; let active = -1; let timer = 0; let seq = 0;
  const box = input.closest('.search');
  const close = () => { list.hidden = true; box.setAttribute('aria-expanded', 'false'); active = -1; };
  const paint = () => {
    list.innerHTML = items.length
      ? items.map((r, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === active}" data-i="${i}">
          <div><b>${esc(r.title)}</b>${r.matched && r.matched.toLowerCase() !== r.title.toLowerCase() ? `<small>matches “${esc(r.matched)}”</small>` : ''}</div>
          <span class="z">${ZONES[r.zone]?.short ?? ''}</span></li>`).join('')
      : '<li class="none">No match yet. Try a simpler word like “nurse” or “driver”.</li>';
    list.hidden = false; box.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `${list.id}-${active}` : '');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      const rows = await query('search', { q });
      if (my !== seq) return;
      items = rows; active = rows.length ? 0 : -1; paint();
    }, 110);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  function choose(r) { close(); input.value = r.title; onChoose(r.code); }
}

/* ---------------- dashboard ---------------- */
async function openJob(code, { push = true } = {}) {
  state.code = code; state.selected = null;
  if (push) history.pushState(null, '', `#/job/${code}${state.goal ? `/goal/${state.goal}` : ''}`);
  $('#hero').hidden = true; $('#how').hidden = true; $('#dash').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#me-title').textContent = 'Loading…';
  const [neigh] = await query('neighborhood', { code });
  $('#me-title').textContent = neigh.centerTitle;
  $('#me-zone').textContent = ZONES[neigh.centerZone]?.long ?? '';
  net ??= createNetwork($('#net'), { onPick: pickMove, onExplore: (c) => openJob(c), tip });
  net.update(neigh);
  await Promise.all([renderProfile(), renderMoves(), renderKeystones()]);
  if (state.goal && state.goal !== code) renderRoutes(); else { state.goal = null; $('#ladder').innerHTML = '<p class="empty">Set a goal above, or press “Set as goal” on any move below.</p>'; }
}

async function renderProfile() {
  const [p] = await query('profile', { code: state.code });
  $('#me-aka').textContent = p.aka?.length ? `Also called: ${p.aka.join(' · ')}` : '';
  $('#fingerprint').innerHTML = p.skills.filter((s) => s.name).slice(0, 8).map((s, i) => `
    <li data-kind="${s.kind}"><span>${esc(s.name)}</span><small>lvl ${s.level.toFixed(1)}</small>
      <span class="meter"><i style="width:${Math.min(100, (s.level / 7) * 100)}%;animation-delay:${i * 60}ms"></i></span></li>`).join('');
}

async function renderMoves() {
  state.moves = await query('moves', { code: state.code, have: [...state.have] });
  paintMoves();
}

function paintMoves() {
  const f = state.filter;
  const list = state.moves.filter((m) => f === 'all' || (f === 'up' ? m.climb > 0 : m.climb === 0));
  const up = state.moves.filter((m) => m.climb > 0).length;
  $('#moves-sub').textContent = `· ${state.moves.length} realistic moves, ${up} step${up === 1 ? '' : 's'} up`;
  $('#moves').innerHTML = list.map((m, i) => {
    const k = kind(m.climb);
    const badge = k === 'up' ? `↑ ${ZONES[m.zone]?.short}` : k === 'down' ? 'Less prep' : 'Same level';
    const r = readiness(m.gap);
    return `<article class="move${state.selected === m.code ? ' sel' : ''}" data-code="${m.code}" style="animation-delay:${Math.min(i, 12) * 35}ms">
      <div class="move-top"><h4>${esc(m.title)}</h4><span class="badge ${k}">${badge}</span></div>
      <div class="ready"><span>Ready</span><span class="meter"><i style="width:${r}%"></i></span><b>${r}%</b></div>
      <div class="learn">${m.learn.length ? m.learn.map((s) => `<span class="tag">${esc(s)}</span>`).join('') : '<span class="tag ok">No big new skills: apply now</span>'}
        ${m.tools.map((t) => `<span class="tag tool">${esc(t)}</span>`).join('')}</div>
      <div class="move-actions"><button class="btn small" data-act="goal">Set as goal</button><button class="btn small ghost" data-act="explore">Explore from here →</button></div>
    </article>`;
  }).join('') || '<p class="empty">No moves in this view.</p>';
}

async function renderKeystones() {
  const rows = await query('keystones', { code: state.code, have: [...state.have] });
  $('#keystones').innerHTML = rows.map((k) => `
    <li><span class="k-n">${k.upward}</span><div><b>${esc(k.skill)}</b><small>opens ${k.upward} step-up moves · ${k.unlocks} total</small></div>
      <button class="btn small ghost" data-have="${esc(k.skill)}" title="Count this skill as one you already have">I have it</button></li>`).join('') || '<li><small>You already cover the skills that matter most nearby.</small></li>';
}

async function renderRoutes() {
  const wrap = $('#ladder');
  wrap.innerHTML = '<p class="empty">Relate is comparing up to 48 candidate paths…</p>';
  const rows = await query('routes', { from: state.code, to: state.goal });
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty">No route within six realistic moves. That usually means a different field entirely; try a goal closer to your skills, or a stepping-stone job first.</p>';
    net.route([]); return;
  }
  wrap.innerHTML = `<div class="routes">${rows.map((r, i) => `
    <div class="route${i === 0 ? ' best' : ''}">
      <div class="route-head"><b>${i === 0 ? 'Best route' : `Route ${i + 1}`}</b><span>${r.rungs.length - 1} move${r.rungs.length === 2 ? '' : 's'} · gap ${r.total}</span></div>
      <ol class="ladder">${r.rungs.map((n, j) => `
        <li class="rung${j === 0 ? ' start' : ''}${j === r.rungs.length - 1 ? ' goal' : ''}" style="animation-delay:${j * 90}ms">
          <b>${esc(n.title)}</b><span class="z">${j === 0 ? `You are here · ${ZONES[n.zone]?.short}` : `${ZONES[n.zone]?.short} · ${r.moves[j - 1].via === 'RELATED' ? 'O*NET related job' : 'skill match'}`}</span>
          ${j > 0 ? `<div class="learn">${(r.moves[j - 1].learn || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="tag ok">Ready</span>'}</div>` : ''}
        </li>`).join('')}</ol>
    </div>`).join('')}</div>`;
  net.route(rows[0].rungs.map((n) => n.code));
}

function pickMove(code) {
  state.selected = code;
  net.select(code);
  document.querySelectorAll('.move').forEach((el) => el.classList.toggle('sel', el.dataset.code === code));
  const el = document.querySelector(`.move[data-code="${CSS.escape(code)}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else { state.filter = 'all'; setTab('all'); paintMoves(); }
}

function setGoal(code) {
  state.goal = code;
  history.replaceState(null, '', `#/job/${state.code}/goal/${code}`);
  renderRoutes();
  $('#goal-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- "skills I already have" ---------------- */
async function renderHave() {
  const rows = await query('skills');
  const groups = { essential: 'Basic skills', transferable: 'Cross-functional skills', knowledge: 'Knowledge areas' };
  $('#have-groups').innerHTML = Object.entries(groups).map(([k, label]) => `
    <div class="have-group"><h4>${label}</h4><div class="pick">${rows.filter((r) => r.kind === k).map((r) =>
      `<button aria-pressed="${state.have.has(r.name)}" data-skill="${esc(r.name)}">${esc(r.name)}</button>`).join('')}</div></div>`).join('');
}
function toggleHave(name, force) {
  const on = force ?? !state.have.has(name);
  on ? state.have.add(name) : state.have.delete(name);
  store.set('rungs:have', [...state.have]);
  $('#have-count').textContent = state.have.size;
  document.querySelectorAll(`[data-skill="${CSS.escape(name)}"]`).forEach((b) => b.setAttribute('aria-pressed', on));
  clearTimeout(toggleHave.t);
  toggleHave.t = setTimeout(() => { renderMoves(); renderKeystones(); }, 150);
}

/* ---------------- under the hood ---------------- */
function highlight(c) {
  return esc(c)
    .replace(/\b(MATCH|OPTIONAL|WHERE|WITH|RETURN|ORDER BY|LIMIT|CALL|UNWIND|AS|AND|OR|NOT|IN|CASE|WHEN|THEN|ELSE|END|DESC|SHORTEST|DISTINCT|CONTAINS|STARTS WITH|IS NULL|IS NOT NULL|collect|count|sum|reduce|coalesce|round|size|toLower|nodes|relationships)\b/g, '<span class="kw">$1</span>')
    .replace(/(:[A-Z][A-Za-z]+)/g, '<span class="rel">$1</span>')
    .replace(/(\$[a-z]+)/g, '<span class="par">$1</span>');
}
function renderHood() {
  $('#hood-stats').textContent = status.loaded
    ? `Relate (WebAssembly) holds ${status.nodes?.toLocaleString()} nodes and ${status.rels.toLocaleString()} relationships in this tab, built in ${(status.ms / 1000).toFixed(1)}s.`
    : 'Relate is still building the graph in this tab…';
  $('#hood-log').innerHTML = log.map((e) => `<li>
    <div class="h"><b>${e.name}</b><span>${e.error ? 'error' : `${e.rows} row${e.rows === 1 ? '' : 's'} · ${e.ms != null ? e.ms.toFixed(1) : '?'} ms`}</span></div>
    <p>${esc(e.about)}</p>
    <pre>${highlight(e.cypher)}</pre>
    <p class="fine" style="padding:0 12px 10px">params: <code>${esc(JSON.stringify(e.params))}</code></p></li>`).join('') || '<li><p style="padding:12px">Search for a job to see the queries.</p></li>';
}

/* ---------------- tooltip ---------------- */
const tipEl = $('#tip');
const tip = {
  show(e, d) {
    tipEl.innerHTML = d.level ? `<b>${esc(d.title)}</b>${ZONES[d.zone]?.short} · ${kind(d.climb) === 'up' ? 'step up' : kind(d.climb) === 'down' ? 'less prep' : 'same level'} · gap ${Math.round(d.gap)}` : `<b>${esc(d.title)}</b>You are here`;
    tipEl.hidden = false; tip.move(e);
  },
  move(e) { tipEl.style.left = `${Math.min(innerWidth - 270, e.clientX + 14)}px`; tipEl.style.top = `${e.clientY + 14}px`; },
  hide() { tipEl.hidden = true; },
};

/* ---------------- hero illustration ---------------- */
function heroArt() {
  const svg = $('#hero-svg');
  const c = [210, 230];
  const ring = [['Shift lead', 'up', 90, 120], ['Bank teller', 'same', 300, 110], ['Claims clerk', 'up', 340, 250], ['Receptionist', 'same', 300, 360], ['Bookkeeper', 'up', 110, 350], ['Server', 'same', 60, 230]];
  const far = [['Claims adjuster', 'up', 380, 40], ['Office manager', 'up', 30, 60]];
  let html = '';
  ring.forEach(([, , x, y]) => { html += `<line class="e" x1="${c[0]}" y1="${c[1]}" x2="${x}" y2="${y}"/>`; });
  html += `<line class="e hot" x1="${c[0]}" y1="${c[1]}" x2="340" y2="250"/><line class="e hot" x1="340" y1="250" x2="380" y2="40"/><line class="e" x1="90" y1="120" x2="30" y2="60"/>`;
  [...ring, ...far].forEach(([t, k, x, y], i) => {
    html += `<g class="float" style="animation-delay:${i * -0.7}s"><circle class="n ${k}" cx="${x}" cy="${y}" r="${k === 'up' ? 9 : 7}"/><text x="${x + 14}" y="${y + 4}">${t}</text></g>`;
  });
  html += `<circle class="n me" cx="${c[0]}" cy="${c[1]}" r="20"/><text x="${c[0]}" y="${c[1] + 40}" text-anchor="middle" style="font-weight:600;fill:var(--ink)">You: cashier</text>`;
  svg.innerHTML = html;
}

/* ---------------- events ---------------- */
function setTab(f) {
  state.filter = f;
  document.querySelectorAll('#move-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.f === f));
}

function bind() {
  attachSearch($('#search'), $('#search-list'), (code) => openJob(code));
  attachSearch($('#goal'), $('#goal-list'), (code) => setGoal(code));
  $('#quick').addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) openJob(b.dataset.code); });
  addEventListener('keydown', (e) => { if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); ($('#dash').hidden ? $('#search') : $('#goal')).focus(); } });

  $('#move-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { setTab(b.dataset.f); paintMoves(); } });
  $('#moves').addEventListener('click', (e) => {
    const card = e.target.closest('.move'); if (!card) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'goal') setGoal(card.dataset.code);
    else if (act === 'explore') openJob(card.dataset.code);
    else { state.selected = card.dataset.code; net.select(card.dataset.code); document.querySelectorAll('.move').forEach((el) => el.classList.toggle('sel', el === card)); }
  });
  $('#keystones').addEventListener('click', (e) => { const b = e.target.closest('[data-have]'); if (b) toggleHave(b.dataset.have, true); });

  $('#btn-have').addEventListener('click', async () => {
    const p = $('#have-panel'); p.hidden = !p.hidden; $('#btn-have').setAttribute('aria-expanded', !p.hidden);
    if (!p.hidden && !$('#have-groups').children.length) await renderHave();
  });
  $('#have-groups').addEventListener('click', (e) => { const b = e.target.closest('[data-skill]'); if (b) toggleHave(b.dataset.skill); });
  $('#have-count').textContent = state.have.size;

  $('#btn-change').addEventListener('click', goHome);
  $('#home').addEventListener('click', (e) => { e.preventDefault(); goHome(); });

  $('#btn-hood').addEventListener('click', () => { const h = $('#hood'); h.hidden = !h.hidden; $('#btn-hood').setAttribute('aria-expanded', !h.hidden); if (!h.hidden) renderHood(); });
  $('#hood-close').addEventListener('click', () => { $('#hood').hidden = true; $('#btn-hood').setAttribute('aria-expanded', 'false'); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#hood').hidden = true; });

  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; try { localStorage.setItem('rungs:theme', next); } catch {}
  });
  addEventListener('popstate', route);
}

function goHome() {
  history.pushState(null, '', '#');
  state.code = null; state.goal = null;
  $('#dash').hidden = true; $('#hero').hidden = false; $('#how').hidden = false;
  $('#search').value = ''; $('#search').focus();
}

function route() {
  const m = location.hash.match(/^#\/job\/([\d.-]+)(?:\/goal\/([\d.-]+))?/);
  if (m) { state.goal = m[2] || null; openJob(m[1], { push: false }); } else if (state.code) goHome();
}

heroArt();
bind();
boot();
route();
