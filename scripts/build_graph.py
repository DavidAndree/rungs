"""Build the Rungs career graph from O*NET 31.0 into a Relate single-file store.

    python scripts/build_graph.py            # writes data/rungs.rl and docs/graph.json

Graph model
  (:Occupation {code, title, description, jobZone, titles})
  (:Skill {id, name, kind})                 kind: essential | transferable | knowledge
  (:Software {name})                        O*NET "hot technologies"
  (:Occupation)-[:NEEDS {importance, level}]->(:Skill)
  (:Occupation)-[:USES {inDemand}]->(:Software)
  (:Occupation)-[:RELATED {tier, rank}]->(:Occupation)       O*NET's own relatedness
  (:Occupation)-[:STEP {similarity, gap, newSkills}]->(:Occupation)
        a realistic career move: high skill overlap, at most one Job Zone up.
"""
import csv
import json
import math
import os
import shutil
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONET = os.path.join(ROOT, 'data', 'onet')
STORE = os.path.join(ROOT, 'data', 'rungs.rl')
WEB_JSON = os.path.join(ROOT, 'docs', 'graph.json')

MIN_IMPORTANCE = 2.75      # a target skill counts toward the gap at this importance (1–5 scale)
STORE_IMPORTANCE = 2.0     # NEEDS edges stored at or above this, so your current levels are complete
STEPS_PER_OCC = 12         # most-similar outgoing STEP edges per occupation
CLIMBS_PER_OCC = 6         # extra STEP edges to the closest jobs one Job Zone up
MAX_ZONE_JUMP = 1          # a single move never climbs more than one Job Zone
GAP_LEVEL = 1.0            # a skill is "new" if the target needs >= 1 level more


def rows(name):
    with open(os.path.join(ONET, name + '.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def load():
    occ = {r['O*NET-SOC Code']: {'code': r['O*NET-SOC Code'], 'title': r['Title'], 'description': r['Description']}
           for r in rows('occupation_data')}
    for r in rows('job_zones'):
        if r['O*NET-SOC Code'] in occ:
            occ[r['O*NET-SOC Code']]['jobZone'] = int(r['Job Zone'])

    skills = {}
    needs = defaultdict(dict)  # code -> skill_id -> {importance, level}
    for fname, kind in [('essential_skills', 'essential'), ('transferable_skills', 'transferable'), ('knowledge', 'knowledge')]:
        for r in rows(fname):
            code, eid = r['O*NET-SOC Code'], r['Element ID']
            if code not in occ:
                continue
            skills[eid] = {'id': eid, 'name': r['Element Name'], 'kind': kind}
            slot = needs[code].setdefault(eid, {})
            if r['Scale ID'] == 'IM':
                slot['importance'] = float(r['Data Value'])
            elif r['Scale ID'] == 'LV':
                slot['level'] = float(r['Data Value'])

    # Only occupations with full data and a Job Zone take part.
    occ = {c: o for c, o in occ.items() if c in needs and 'jobZone' in o}
    for c in needs:
        needs[c] = {e: v for e, v in needs[c].items() if 'importance' in v and 'level' in v}

    titles = defaultdict(list)
    for r in rows('job_titles'):
        if r['O*NET-SOC Code'] in occ:
            titles[r['O*NET-SOC Code']].append(r['Job Title'])
    for c, o in occ.items():
        o['titles'] = sorted(set(titles[c]), key=len)[:40]

    software = defaultdict(dict)
    for r in rows('software_skills'):
        if r['O*NET-SOC Code'] in occ and r['Hot Technology'] == 'Y':
            software[r['O*NET-SOC Code']][r['Workplace Example']] = r['In Demand'] == 'Y'

    related = [(r['O*NET-SOC Code'], r['Related O*NET-SOC Code'], r['Relatedness Tier'], int(r['Index']))
               for r in rows('related_occupations')
               if r['O*NET-SOC Code'] in occ and r['Related O*NET-SOC Code'] in occ]
    return occ, skills, needs, software, related


def compute_steps(occ, skills, needs):
    """Career moves: cosine similarity of importance×level skill profiles, gap = missing levels."""
    ids = sorted(skills)
    vec = {}
    for c in occ:
        v = [needs[c].get(e, {}).get('importance', 0) * needs[c].get(e, {}).get('level', 0) for e in ids]
        n = math.sqrt(sum(x * x for x in v)) or 1
        vec[c] = [x / n for x in v]
    steps = []
    codes = sorted(occ)
    for a in codes:
        za = occ[a]['jobZone']
        cands = []
        for b in codes:
            if a == b or occ[b]['jobZone'] > za + MAX_ZONE_JUMP:
                continue
            sim = sum(x * y for x, y in zip(vec[a], vec[b]))
            cands.append((sim, b))
        cands.sort(reverse=True)
        # Most similar jobs overall, plus the closest jobs one Job Zone up, so every
        # occupation has upward moves, not just lateral ones.
        chosen = cands[:STEPS_PER_OCC]
        picked = {b for _, b in chosen}
        chosen += [(s, b) for s, b in cands if occ[b]['jobZone'] == za + 1 and b not in picked][:CLIMBS_PER_OCC]
        for sim, b in chosen:
            gap, new = transition(a, b, skills, needs)
            steps.append({'from': a, 'to': b, 'similarity': round(sim, 4), 'gap': gap,
                          'climb': occ[b]['jobZone'] - za, 'newSkills': new})
    return steps


def transition(a, b, skills, needs):
    """Skill gap of moving from job a to job b: missing levels on b's important skills, weighted by importance."""
    gap = 0.0
    new = []
    for e, need in needs[b].items():
        if need['importance'] < MIN_IMPORTANCE:
            continue
        deficit = need['level'] - needs[a].get(e, {}).get('level', 0)
        if deficit > 0:
            gap += deficit * need['importance'] / 5
        if deficit >= GAP_LEVEL:
            new.append((deficit * need['importance'], skills[e]['name']))
    new.sort(reverse=True)
    return round(gap, 2), [n for _, n in new[:6]]


def batches(items, n=500):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def main():
    t0 = time.time()
    occ, skills, needs, software, related = load()
    print(f'loaded {len(occ)} occupations, {len(skills)} skills in {time.time() - t0:.1f}s')
    steps = compute_steps(occ, skills, needs)
    print(f'computed {len(steps)} STEP edges in {time.time() - t0:.1f}s')

    need_rows = [{'code': c, 'id': e, 'importance': v['importance'], 'level': v['level']}
                 for c in occ for e, v in needs[c].items() if v['importance'] >= STORE_IMPORTANCE]
    sw_names = sorted({s for c in software for s in software[c]})
    use_rows = [{'code': c, 'name': s, 'inDemand': d} for c in software for s, d in software[c].items()]
    # O*NET's analyst-curated related occupations (primary tiers only) also carry a gap, so
    # dream-job routes can pivot into a new field the way career changers really do.
    rel_rows = []
    for a, b, t, i in related:
        if t == 'Supplemental':
            continue
        gap, new = transition(a, b, skills, needs)
        rel_rows.append({'a': a, 'b': b, 'tier': t, 'rank': i, 'gap': gap,
                         'climb': occ[b]['jobZone'] - occ[a]['jobZone'], 'newSkills': new})
    occ_rows = [{k: o[k] for k in ('code', 'title', 'description', 'jobZone', 'titles')} for o in occ.values()]

    # Same payload drives the browser (WASM) load, so both surfaces hold the identical graph.
    os.makedirs(os.path.dirname(WEB_JSON), exist_ok=True)
    payload = {'source': 'O*NET 31.0 Database, U.S. Department of Labor/ETA, CC BY 4.0',
               'occupations': occ_rows, 'skills': list(skills.values()), 'software': sw_names,
               'needs': need_rows, 'uses': use_rows, 'related': rel_rows, 'steps': steps}
    with open(WEB_JSON, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    print(f'wrote {WEB_JSON} ({os.path.getsize(WEB_JSON) / 1e6:.1f} MB)')

    import relate
    if os.path.exists(STORE):
        shutil.rmtree(STORE) if os.path.isdir(STORE) else os.remove(STORE)
    db = relate.connect(STORE)
    for stmt in load_statements():
        name, cypher, data = stmt(payload)
        for chunk in batches(data):
            db.execute(cypher, {'rows': chunk})
        print(f'  {name}: {len(data)}')
    if hasattr(db, 'close'):
        db.close()
    print(f'wrote {STORE} in {time.time() - t0:.1f}s')


def load_statements():
    """Cypher used by BOTH the Python build and the browser loader (docs/js/worker.js mirrors these)."""
    return [
        lambda p: ('index Occupation.code', 'CREATE INDEX occ_code IF NOT EXISTS FOR (o:Occupation) ON (o.code)', [{}]),
        lambda p: ('index Skill.id', 'CREATE INDEX skill_id IF NOT EXISTS FOR (s:Skill) ON (s.id)', [{}]),
        lambda p: ('index Software.name', 'CREATE INDEX software_name IF NOT EXISTS FOR (s:Software) ON (s.name)', [{}]),
        lambda p: ('occupations', 'UNWIND $rows AS r CREATE (:Occupation {code: r.code, title: r.title, description: r.description, jobZone: r.jobZone, titles: r.titles})', p['occupations']),
        lambda p: ('skills', 'UNWIND $rows AS r CREATE (:Skill {id: r.id, name: r.name, kind: r.kind})', p['skills']),
        lambda p: ('software', 'UNWIND $rows AS r CREATE (:Software {name: r})', p['software']),
        lambda p: ('NEEDS', 'UNWIND $rows AS r MATCH (o:Occupation {code: r.code}), (s:Skill {id: r.id}) CREATE (o)-[:NEEDS {importance: r.importance, level: r.level}]->(s)', p['needs']),
        lambda p: ('USES', 'UNWIND $rows AS r MATCH (o:Occupation {code: r.code}), (s:Software {name: r.name}) CREATE (o)-[:USES {inDemand: r.inDemand}]->(s)', p['uses']),
        lambda p: ('RELATED', 'UNWIND $rows AS r MATCH (a:Occupation {code: r.a}), (b:Occupation {code: r.b}) CREATE (a)-[:RELATED {tier: r.tier, rank: r.rank, gap: r.gap, climb: r.climb, newSkills: r.newSkills}]->(b)', p['related']),
        lambda p: ('STEP', 'UNWIND $rows AS r MATCH (a:Occupation {code: r.from}), (b:Occupation {code: r.to}) CREATE (a)-[:STEP {similarity: r.similarity, gap: r.gap, climb: r.climb, newSkills: r.newSkills}]->(b)', p['steps']),
    ]


if __name__ == '__main__':
    sys.exit(main())
