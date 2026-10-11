"""Builds speedrun/conjugation/verbs.json from saved Softcatalà (Catalan) and conjugacion.es (Castellano) pages.

Usage: save each verb in conjugation_verbs.py into <dir>/raw as
  ca-<verb>.html  from https://www.softcatala.org/conjugador-de-verbs/verb/<verb>/
  es-<verb>.html  from https://www.conjugacion.es/del/verbo/<verb>.php
then: python3 scripts/build-conjugation.py <dir> speedrun/conjugation/verbs.json
"""
import html, json, re, sys
sys.path.insert(0, __import__("os").path.dirname(__file__)); from conjugation_verbs import VERBS
RAW = sys.argv[1] + '/raw'

def lines_of(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
    t = re.sub(r'<[^>]+>', '\n', t); t = html.unescape(t)
    return [re.sub(r'\s+', ' ', l).strip() for l in t.split('\n') if l.strip()]

CA_TENSES = {'Present','Perfet','Imperfet','Plusquamperfet','Passat simple','Passat perifràstic','Passat anterior',
  'Passat anterior perifràstic','Futur','Futur perfet','Condicional','Condicional perfet'}
def catalan(ca):
    lines = lines_of(f'{RAW}/ca-{ca}.html')
    out = {}; mode = None; tense = None; entries = []
    def flush():
        if mode and tense and entries: out[(mode, tense)] = entries[:]
    for l in lines:
        if l.startswith('Mode '):
            flush(); mode = l[5:]; tense = None; entries = []; continue
        if l in ("Tornar a l'índex", 'Formes no personals'):
            flush(); tense = None; entries = []
            if l == 'Formes no personals': mode = None
            continue
        if mode and l in CA_TENSES:
            flush(); tense = l; entries = []; continue
        if mode and tense:
            if l.startswith('(') and l.endswith(')') and entries: entries[-1] += ' ' + l
            elif l.startswith(',') and entries: entries[-1] += l
            else: entries.append(l)
    flush()
    return out

def ca_pattern(entry):
    """'tinc, tenc (bal.)' -> 'tinc'; 'vas (vares) tenir / tindre' -> '[vas|vares] tenir'; 'teniu, tingueu' -> '[teniu|tingueu]'."""
    entry = re.sub(r'\(([^)]*)\)', lambda m: '(' + m[1].replace(',', ' ') + ')' if '.' in m[1] else m[0], entry)
    entry = re.sub(r'\s*\(cent\.\)', '', entry)  # the Central form: keep it, drop the mark
    alts = [a.strip() for a in entry.split(',')]
    alts = [a for a in alts if a and not re.search(r'\([^)]*\.\s*[^)]*\)', a)]
    forms = []
    for a in alts:
        parts = [p.strip() for p in a.split(' / ')]
        first = parts[0]
        for p in parts:
            if len(p.split()) < len(first.split()):  # 'vaig tenir / tindre': complete the short variant
                p = ' '.join(first.split()[: len(first.split()) - len(p.split())] + p.split())
            forms.append(p)
    # inner '(x)' alternatives: 'vas (vares) tenir' -> 'vas tenir', 'vares tenir'
    expanded = []
    for f in forms:
        m = re.match(r'^(.*?)(\S+) \((\S+)\)(.*)$', f)
        if m: expanded += [f'{m[1]}{m[2]}{m[4]}', f'{m[1]}{m[3]}{m[4]}']
        else: expanded.append(f)
    seen = []
    for f in expanded:
        f = re.sub(r'\s+', ' ', f).strip()
        if f and f not in seen: seen.append(f)
    return seen

def castellano(es):
    s = open(f'{RAW}/es-{es}.html', encoding='utf-8', errors='replace').read()
    out = {}
    for mode_m in re.finditer(r'<h2 class="mode"><span>(.*?)</span></h2>(.*?)(?=<h2 class="mode"|$)', s, flags=re.S):
        mode = mode_m[1]
        for t in re.finditer(r'<h3 class="tempsheader">(.*?)</h3><div class="tempscorps">(.*?)</div>', mode_m[2], flags=re.S):
            rows = [html.unescape(re.sub(r'<[^>]+>', '', r)).strip() for r in t[2].split('<br />')]
            rows = [re.sub(r'\s+', ' ', r) for r in rows if r]
            out[(mode, t[1])] = rows
    return out

PRON_ES = ['yo', 'tú', 'él', 'nosotros', 'vosotros', 'ellos']
def strip_pron(row):
    for p in PRON_ES:
        if row.startswith(p + ' '): return row[len(p) + 1:]
    return row

# id, Catalan source, Castellano source, prompt style, persons, lesson that unlocks it, level
TENSES = [
  ('pres',     ('indicatiu','Present'),          ('Indicativo','Presente'),                    'plain', 'a2-01', 'A2', 'present'),
  ('perif',    ('indicatiu','Passat perifràstic'),('Indicativo','Pretérito perfecto simple'),   'plain', 'a2-21', 'A2', 'passat'),
  ('perfet',   ('indicatiu','Perfet'),           ('Indicativo','Pretérito perfecto compuesto'),'plain', 'a2-23', 'A2', 'perfet'),
  ('imperf',   ('indicatiu','Imperfet'),         ('Indicativo','Pretérito imperfecto'),        'plain', 'a2-26', 'A2', 'imperfet'),
  ('futur',    ('indicatiu','Futur'),            ('Indicativo','Futuro'),                      'plain', 'a2-28', 'A2', 'futur'),
  ('imper',    ('imperatiu','Present'),          ('Imperativo','Imperativo'),                  'imper', 'a2-34', 'A2', 'imperatiu'),
  ('cond',     ('indicatiu','Condicional'),      ('Indicativo','Condicional'),                 'plain', 'b1-11', 'B1', 'condicional'),
  ('plusq',    ('indicatiu','Plusquamperfet'),   ('Indicativo','Pretérito pluscuamperfecto'),  'plain', 'b1-13', 'B1', 'plusquamperfet'),
  ('subj',     ('subjuntiu','Present'),          ('Subjuntivo','Presente'),                    'que',   'b1-14', 'B1', 'subjuntiu present'),
  ('subjimp',  ('subjuntiu','Imperfet'),         ('Subjuntivo','Pretérito imperfecto 1'),      'que',   'b2-01', 'B2', 'subjuntiu imperfet'),
  ('subjperf', ('subjuntiu','Perfet'),           ('Subjuntivo','Pretérito perfecto'),          'que',   'b2-04', 'B2', 'subjuntiu perfet'),
  ('simple',   ('indicatiu','Passat simple'),    ('Indicativo','Pretérito perfecto simple'),   'plain', 'c1-01', 'C1', 'passat simple (literari)'),
]

# Where the source lists a rarer form first.
PREFER = {('tenir', 'imper', 1): 'tingues'}

problems = []
verbs = []
for ca, es in VERBS:
    C = catalan(ca); E = castellano(es)
    forms = {}
    for tid, csrc, esrc, style, lesson, level, label in TENSES:
        crow = C.get(csrc); erow = E.get(esrc)
        if not crow or not erow: problems.append(f'{ca}/{es} {tid}: missing {"ca" if not crow else "es"}'); continue
        if style == 'imper':
            # Catalan imperative lists tu, ell, nosaltres, vosaltres, ells; Castellano adds a leading '-' for yo.
            pairs = [(1, erow[1], crow[0]), (4, erow[4], crow[3])]
        else:
            if len(crow) != 6 or len(erow) != 6: problems.append(f'{ca} {tid}: rows {len(crow)}/{len(erow)}'); continue
            pairs = [(i, strip_pron(erow[i]), crow[i]) for i in range(6)]
        cells = []
        for person, es_form, ca_entry in pairs:
            alts = ca_pattern(ca_entry)
            if tid == 'perif':  # the literary simple past is also right
                simple = C.get(('indicatiu', 'Passat simple'))
                if simple: alts += [a for a in ca_pattern(simple[person]) if a not in alts]
            if not alts: problems.append(f'{ca} {tid} {person}: empty'); continue
            if any(re.search(r'[()\[\]|]', a) for a in alts): problems.append(f'{ca} {tid} {person}: odd {alts}')
            # Display order: the form people actually use first.
            prefer = PREFER.get((ca, tid, person))
            if prefer and prefer in alts: alts = [prefer] + [a for a in alts if a != prefer]
            pattern = alts[0] if len(alts) == 1 else '[' + '|'.join(alts) + ']'
            if style == 'que': pattern = '(que) ' + pattern
            cells.append([person, es_form, pattern])
        forms[tid] = cells
    verbs.append({'ca': ca, 'es': es, 'forms': forms})

data = {
  'reviewed': False,
  'source': 'Catalan forms: Softcatalà conjugator (Central variant; Balearic/Valencian-only forms dropped). Castellano: conjugacion.es.',
  'tenses': [{'id': t[0], 'label': t[6], 'lesson': t[4], 'level': t[5], 'style': t[3]} for t in TENSES],
  'verbs': verbs,
}
json.dump(data, open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
print('verbs', len(verbs), 'forms', sum(len(c) for v in verbs for c in v['forms'].values()))
print('\n'.join(problems) or 'no problems')
