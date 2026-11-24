// Ego network of career moves, drawn with d3-force. Center = your job, ring 1 = direct STEP
// moves (closer = smaller skill gap), ring 2 = the best moves from each of those.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const kind = (climb) => (climb > 0 ? 'up' : climb < 0 ? 'down' : 'same');
const short = (t, n = 26) => {
  let s = t.split(/,| and | or /)[0].trim();
  if (s.length > n) s = s.slice(0, n - 1).trimEnd() + '…';
  return s;
};

export function createNetwork(el, { onPick, onExplore, tip }) {
  const svg = d3.select(el).append('svg').attr('role', 'img').attr('aria-label', 'Network of career moves from your job');
  const root = svg.append('g');
  const guides = root.append('g');
  const linkG = root.append('g');
  const nodeG = root.append('g');
  let sim = null;
  let state = { nodes: [], links: [] };
  let selected = null;
  let routeCodes = new Set();
  let routeEdges = new Set();

  svg.call(d3.zoom().scaleExtent([0.5, 2.5]).on('zoom', (e) => root.attr('transform', e.transform)));

  function size() { const r = el.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500 }; }

  function update(data) {
    const { w, h } = size();
    svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
    const R1 = Math.min(w, h) * 0.3; const R2 = Math.min(w, h) * 0.46;
    const nodes = [{ id: data.center, title: data.centerTitle, zone: data.centerZone, level: 0, fx: 0, fy: 0 }];
    const links = [];
    const seen = new Set([data.center]);
    const maxGap = Math.max(1, ...data.ring.map((r) => r.gap));
    data.ring.forEach((r, i) => {
      const a = (i / data.ring.length) * Math.PI * 2 - Math.PI / 2;
      const dist = R1 * (0.62 + 0.5 * (r.gap / maxGap));
      seen.add(r.code);
      nodes.push({ id: r.code, title: r.title, zone: r.zone, gap: r.gap, climb: r.climb, level: 1, angle: a, dist, x: Math.cos(a) * dist, y: Math.sin(a) * dist });
      links.push({ source: data.center, target: r.code, level: 1 });
    });
    data.ring.forEach((r, i) => {
      const a = (i / data.ring.length) * Math.PI * 2 - Math.PI / 2;
      (r.next || []).forEach((n, j) => {
        if (!n.code) return;
        if (!seen.has(n.code)) {
          seen.add(n.code);
          const aa = a + (j - 1) * 0.16;
          nodes.push({ id: n.code, title: n.title, zone: n.zone, gap: n.gap, climb: (r.climb || 0) + (n.climb || 0), level: 2, angle: aa, dist: R2, x: Math.cos(aa) * R2, y: Math.sin(aa) * R2 });
        }
        links.push({ source: r.code, target: n.code, level: 2 });
      });
    });

    guides.selectAll('circle').data([R1 * 0.85, R2]).join('circle').attr('class', 'ring-guide').attr('r', (d) => d);

    // Keep positions of nodes that survive a re-focus so the graph morphs instead of jumping.
    const old = new Map(state.nodes.map((n) => [n.id, n]));
    nodes.forEach((n) => { const o = old.get(n.id); if (o && n.level) { n.x = o.x; n.y = o.y; } });
    state = { nodes, links };

    const link = linkG.selectAll('line').data(links, (d) => `${d.source}->${d.target}`);
    link.exit().transition().duration(250).style('opacity', 0).remove();
    const linkEnter = link.enter().append('line').attr('class', (d) => `link l${d.level}`).style('opacity', 0);
    linkEnter.transition().duration(500).style('opacity', null);
    const linkAll = linkEnter.merge(link);

    const node = nodeG.selectAll('g.node').data(nodes, (d) => d.id);
    node.exit().transition().duration(250).style('opacity', 0).remove();
    const nodeEnter = node.enter().append('g').attr('tabindex', 0).attr('role', 'button').style('opacity', 0);
    nodeEnter.append('circle');
    nodeEnter.append('text');
    nodeEnter.transition().duration(500).delay((d) => d.level * 120).style('opacity', 1);
    const nodeAll = nodeEnter.merge(node)
      .attr('class', (d) => `node l${d.level} ${d.level ? kind(d.climb) : 'center'}${routeCodes.has(d.id) ? ' route' : ''}${selected === d.id ? ' sel' : ''}`)
      .attr('aria-label', (d) => d.level ? `${d.title}, ${kind(d.climb) === 'up' ? 'a step up' : kind(d.climb) === 'down' ? 'less preparation' : 'same level'}. Gap ${Math.round(d.gap)}.` : `Your job: ${d.title}`);
    nodeAll.select('circle').attr('r', (d) => (d.level === 0 ? 22 : d.level === 1 ? 7 + 9 * (1 - Math.min(1, d.gap / maxGap)) : 5));
    nodeAll.select('text')
      .text((d) => (d.level === 0 ? short(d.title, 30) : short(d.title, d.level === 1 ? 26 : 20)))
      .attr('text-anchor', (d) => (d.level === 0 ? 'middle' : Math.cos(d.angle) >= 0 ? 'start' : 'end'))
      .attr('dx', (d) => (d.level === 0 ? 0 : Math.cos(d.angle) >= 0 ? 12 : -12))
      .attr('dy', (d) => (d.level === 0 ? 42 : 4));

    nodeAll
      .on('pointerenter', (e, d) => { hover(d.id, true); tip.show(e, d); })
      .on('pointermove', (e) => tip.move(e))
      .on('pointerleave', (e, d) => { hover(d.id, false); tip.hide(); })
      .on('click', (e, d) => { if (d.level) onPick(d.id); })
      .on('dblclick', (e, d) => { if (d.level) onExplore(d.id); })
      .on('keydown', (e, d) => { if (e.key === 'Enter' && d.level) onExplore(d.id); else if (e.key === ' ' && d.level) { e.preventDefault(); onPick(d.id); } });

    sim?.stop();
    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).strength(0.04))
      .force('charge', d3.forceManyBody().strength((d) => (d.level === 0 ? -400 : -90)))
      .force('collide', d3.forceCollide().radius((d) => (d.level === 0 ? 40 : d.level === 1 ? 22 : 12)))
      .force('radial', d3.forceRadial((d) => d.dist || 0).strength((d) => (d.level ? 0.6 : 0)))
      .alpha(0.9).alphaDecay(0.04)
      .on('tick', () => {
        linkAll.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y)
          .classed('route', (d) => routeEdges.has(`${d.source.id}->${d.target.id}`));
        nodeAll.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });
  }

  function hover(id, on) {
    linkG.selectAll('line').classed('on', (d) => on && (d.source.id === id || d.target.id === id));
  }

  function select(id) {
    selected = id;
    nodeG.selectAll('g.node').classed('sel', (d) => d.id === id);
  }

  function route(codes) {
    routeCodes = new Set(codes);
    routeEdges = new Set(codes.slice(1).map((c, i) => `${codes[i]}->${c}`));
    nodeG.selectAll('g.node').classed('route', (d) => routeCodes.has(d.id));
    linkG.selectAll('line').classed('route', (d) => routeEdges.has(`${d.source.id}->${d.target.id}`));
  }

  addEventListener('resize', () => { if (state.nodes.length) { const { w, h } = size(); svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`); } });
  return { update, select, route };
}
