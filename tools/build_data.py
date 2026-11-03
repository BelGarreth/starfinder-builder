import argparse
import html
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

import prereq

ROOT = Path(__file__).resolve().parent.parent
REPO_URL = 'https://github.com/foundryvtt-starfinder/foundryvtt-starfinder.git'
SPARSE_DIRS = [
    'src/items/races', 'src/items/racial-features', 'src/items/themes', 'src/items/theme-features',
    'src/items/classes', 'src/items/class-features', 'src/items/feats', 'src/items/spells', 'src/items/equipment',
]
AON = 'https://www.aonsrd.com/'
SUMMARY_LIMIT = 300
ITEM_SUMMARY_LIMIT = 160
CLASS_SUMMARY_LIMIT = 220

RACES = ['android', 'human', 'kasatha', 'lashunta', 'shirren', 'vesk', 'ysoki', 'dwarf', 'elf', 'gnome',
         'half-elf', 'halfling', 'half-orc']
CLASSES = ['envoy', 'mechanic', 'mystic', 'operative', 'solarian', 'soldier', 'technomancer']
ITEM_TYPES = {'weapon', 'shield', 'upgrade', 'fusion', 'augmentation', 'technological', 'magic', 'hybrid',
              'equipment', 'consumable', 'ammunition', 'goods', 'container', 'weaponAccessory'}

UUID_LABELLED = re.compile(r'@\w+\[[^\]]*\]\{([^}]*)\}')
UUID_BARE = re.compile(r'@\w+\[[^\]]*\]')
ROLL_LABELLED = re.compile(r'\[\[[^\]]*\]\]\{([^}]*)\}')
ROLL_BARE = re.compile(r'\[\[/\w+\s+([^\]]*?)\]\]')
LABEL_PARAGRAPH = re.compile(r'<(p|h\d)>\s*(?:@Icon\[[^\]]*\])?\s*&gt;.*?</\1>', re.S)
BLOCK_END = re.compile(r'</p>|</li>|<br\s*/?>|<hr\s*/?>|</h\d>', re.I)
TAG = re.compile(r'<[^>]*>')
SENTENCE_BREAK = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"“(])')
RACIAL_LINK = re.compile(r'@UUID\[Compendium\.sfrpg\.racial-features\.Item\.(\w+)\]')
THEME_LINK = re.compile(r'@UUID\[Compendium\.sfrpg\.theme-features\.Item\.(\w+)\]')
LEVEL_REQ = re.compile(r'^(\d+)(?:st|nd|rd|th) Level')
PREREQ = re.compile(r'Prerequisites?\s*(?:</\w+>)*\s*:?\s*(?:</\w+>)*\s*(.*?)(?:</p>|<br|<strong>|<hr)', re.S)
TYPE_PAREN = re.compile(r'\s*\((?:combat|teamwork|combat teamwork)\)', re.I)
BENEFIT = re.compile(r'Benefits?\s*(?:</\w+>)*\s*:?\s*(?:</\w+>)*\s*')


def fetch_foundry(sha, dest):
    dest = Path(dest)
    if not (dest / '.git').exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'clone', '--filter=blob:none', '--sparse', REPO_URL, str(dest)], check=True)
        subprocess.run(['git', '-C', str(dest), 'sparse-checkout', 'set', '--no-cone', *[d + '/' for d in SPARSE_DIRS]], check=True)
    head = subprocess.run(['git', '-C', str(dest), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    if head != sha:
        subprocess.run(['git', '-C', str(dest), 'fetch', '--filter=blob:none', 'origin', sha], check=True)
        subprocess.run(['git', '-C', str(dest), 'checkout', '--detach', sha], check=True)
    return dest / 'src' / 'items'


def plain(markup):
    text = UUID_LABELLED.sub(r'\1', LABEL_PARAGRAPH.sub('', markup or ''))
    text = UUID_BARE.sub('', text)
    text = ROLL_LABELLED.sub(r'\1', text)
    text = ROLL_BARE.sub(r'\1', text)
    text = TAG.sub(' ', BLOCK_END.sub(' ', text))
    text = html.unescape(text).replace('<', 'less than ')
    text = re.sub(r'\s+', ' ', text).strip()
    return re.sub(r'\s+([.,;:!?])', r'\1', text)


def summarize(markup, limit=SUMMARY_LIMIT):
    text = plain(markup)
    out = ''
    for sentence in SENTENCE_BREAK.split(text):
        candidate = f'{out} {sentence}'.strip()
        if len(candidate) > limit:
            break
        out = candidate
    if out:
        return out
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(' ', 1)[0].rstrip(' .,;:')
    return cut + '…'


def load_dir(path):
    out = {}
    for f in sorted(Path(path).glob('*.json')):
        data = json.loads(f.read_text(encoding='utf-8'))
        if isinstance(data, dict) and isinstance(data.get('system'), dict):
            out[f.stem] = data
    return out


def description(item):
    return item['system'].get('description', {}).get('value', '')


def aon(page, name):
    return f'{AON}{page}.aspx?ItemName={quote(name)}'


def aon_search(name):
    return f'{AON}Search.aspx?Query={quote(name)}'


def modifiers(system):
    keys = ('name', 'type', 'effectType', 'valueAffected', 'modifier', 'modifierType', 'condition', 'notes')
    return [{k: m.get(k) for k in keys} for m in system.get('modifiers', []) if m.get('enabled')]


def split_name(name):
    match = re.match(r'^(.*?)\s*\((.*)\)\s*$', name)
    if match:
        return match.group(1), match.group(2)
    return name, None


def slug_base(slug):
    return slug.split('_(')[0]


def compact(nested):
    out = {}
    for key, row in (nested or {}).items():
        cleaned = {k: v for k, v in (row or {}).items() if v is not None}
        if cleaned:
            out[key] = cleaned
    return out


def true_keys(mapping):
    return [k for k, v in (mapping or {}).items() if v]


def traits_for_race(base, variant, markup, id_to_slug, by_name):
    linked = []
    for feature_id in RACIAL_LINK.findall(markup):
        slug = id_to_slug.get(feature_id)
        if slug and slug not in linked:
            linked.append(slug)
    if linked:
        return linked
    base_key = base.casefold()
    tokens = [t.casefold() for t in re.split(r'[\s,]+', variant or '') if t]
    found = []
    for slug, requirement in by_name.values():
        req = requirement.casefold()
        if req == base_key or (req.startswith(base_key + ' ') and any(t in req for t in tokens)):
            found.append(slug)
    return found


def bonus_flag(item):
    return {'bonus': True} if prereq.BONUS.search(plain(description(item))) else {}


def build_features(racial, theme):
    features = {}
    for slug, item in racial.items():
        if item['type'] != 'feat':
            continue
        features[slug] = {
            'name': item['name'], 'kind': 'race', 'requirements': item['system'].get('requirements', ''),
            'level': None, 'aon': aon_search(item['name']), 'src': item['system'].get('source', ''),
            'summary': summarize(description(item)), 'modifiers': modifiers(item['system']),
            **bonus_flag(item),
        }
    for slug, item in theme.items():
        if item['type'] != 'feat':
            continue
        req = item['system'].get('requirements', '')
        level = LEVEL_REQ.match(req)
        key = slug if slug not in features else f'theme-{slug}'
        features[key] = {
            'name': item['name'], 'kind': 'theme', 'requirements': req,
            'level': int(level.group(1)) if level else None, 'aon': aon_search(item['name']),
            'src': item['system'].get('source', ''), 'summary': summarize(description(item)),
            'modifiers': modifiers(item['system']), **bonus_flag(item),
        }
    return features


CLASS_REQ = re.compile(r'\b(' + '|'.join(CLASSES) + r')\b', re.I)
OTHER_CLASS_REQ = re.compile(r'vanguard|witchwarper|biohacker|evolutionist|nanocyte|precog', re.I)
MIN_LEVEL = re.compile(r'(\d+)(?:st|nd|rd|th)?\s+(?:level|lvl|technique)|level\s+(\d+)', re.I)
LINEAGE_LABEL = re.compile(r'^\s*<p>\s*(?:&gt;)*\s*(?:<span>)?\s*@UUID\[Compendium\.sfrpg\.(classes|class-features)\.Item\.(\w+)\]\{([^}]*)\}\s*(?:</span>)?\s*</p>')
LINEAGE = {
    'operative exploit': ('operative', 'exploit'), 'stellar revelation': ('solarian', 'revelation'),
    'zenith revelation': ('solarian', 'zenithRevelation'), 'magic hack': ('technomancer', 'hack'),
    'technomantic talent': ('technomancer', 'technomanticTalent'), 'gear boost': ('soldier', 'gearBoost'),
    'fighting style': ('soldier', 'fightingStyle'), 'mechanic trick': ('mechanic', 'mechanicTrick'),
    'exocortex mods (ex)': ('mechanic', 'exocortexMod'), 'connection': ('mystic', 'connection'),
    'envoy improvisation': ('envoy', 'improvisation'), 'expertise talent': ('envoy', 'expertiseTalent'),
    'specialization': ('operative', 'specialization'), 'solar manifestation (su)': ('solarian', 'manifestation'),
}
LINEAGE.update({c: (c, None) for c in CLASSES})
LINEAGE.update({f'{c}, enhanced': (c, None) for c in CLASSES})
OPTION_TIERS = {'fightingStyle': [1, 5, 9, 13, 17], 'connection': [1, 3, 6, 9, 12, 15, 18]}
SPECIALIZATION_TIERS = {'exploit': 5, 'power': 11}
HEADING_LINK = re.compile(r'<h\d>\s*@UUID\[Compendium\.sfrpg\.class-features\.Item\.(\w+)\]')
STRONG_LINK = re.compile(r'<strong>\s*@UUID\[Compendium\.sfrpg\.class-features\.Item\.(\w+)\]')
SPEC_EXPLOIT = re.compile(r'Specialization Exploit(?:\s|:|</?strong>)*@UUID\[Compendium\.sfrpg\.class-features\.Item\.(\w+)\]')
ASSOCIATED = re.compile(r'Associated Skills?(?:\s|:|</?strong>)*(.*?)(?:\.(?=\s|<)|</p>)', re.S)
NEED_LINK = re.compile(r'@UUID\[Compendium\.sfrpg\.([\w-]+)\.(?:Item\.)?(?:JournalEntry\.)?(?:[\w]+\.JournalEntryPage\.)?([\w#-]+)\]\{([^}]*)\}')
NEED_SENTENCE = re.compile(r'\b(?:you|your exocortex) must (?:have|be|know)\b(.*?)\bto (?:choose|learn|select|take)(?: or use)? (?:this|it)\b', re.I)
NEED_LEVEL = re.compile(r'(?:at least )?(\d+)(?:st|nd|rd|th) level', re.I)
NEED_CLASS_SKILL = re.compile(r'^(.+?) as a class skill$', re.I)
NEED_NOISE = re.compile(
    r"\b(?:envoy|mechanic|stellar|magic|operative|alternate|class|species|option of the artificial "
    r"intelligence class feature|improvisations?|epiphan(?:y|ies)|exploits?|tricks?|revelations?|hacks?|gear boosts?|abilit(?:y|ies)|features?|"
    r"traits?|mods?)\b", re.I)
STELLAR_TYPE = re.compile(r'@Icon\[type:(graviton|photon)\]|fully (graviton|photon)-attuned')
EXTRA_CLASS_FEATURES = {'stellar_mode_(su)': 'solarian'}
REPEATABLE = re.compile(r'(?:select|choose|take|learn|gain)\s+(?:this|it)[^.]{0,40}(?:more than once|multiple times)|each subsequent time you (?:choose|select|take) this', re.I)


def class_lineage(slug, class_features, by_id, class_ids, memo=None, seen=()):
    memo = {} if memo is None else memo
    if slug in memo:
        return memo[slug]
    if slug in seen:
        return None
    match = LINEAGE_LABEL.match(description(class_features[slug]))
    out = None
    if match:
        collection, target, label = match.groups()
        named = LINEAGE.get(label.strip().casefold())
        if collection == 'classes':
            cls_slug = class_ids.get(target, '')
            out = {'cls': cls_slug.removesuffix('_enhanced') or (named or (None,))[0], 'category': None,
                   'parent': None, 'enhanced': cls_slug.endswith('_enhanced')}
        else:
            parent = by_id.get(target)
            up = class_lineage(parent, class_features, by_id, class_ids, memo, seen + (slug,)) if parent else None
            if up:
                out = {'cls': up['cls'], 'category': named[1] if named else None, 'parent': parent, 'enhanced': up['enhanced']}
            elif named:
                out = {'cls': named[0], 'category': named[1], 'parent': parent, 'enhanced': False}
    memo[slug] = out
    return out


def min_level(req):
    level = MIN_LEVEL.search(req)
    return int(level.group(1) or level.group(2)) if level else None


def associated_skills(markup):
    match = ASSOCIATED.search(markup)
    if not match:
        return []
    names = UUID_LABELLED.findall(match.group(1)) or re.split(r',|\band\b', plain(match.group(1)))
    keys = [prereq.SKILL_KEYS.get(n.strip().casefold()) for n in names]
    return [k for k in keys if k]


def class_feature_record(item, cls, lineage):
    req = item['system'].get('requirements', '') or ''
    markup = description(item)
    rec = {
        'name': item['name'], 'kind': 'class', 'cls': cls, 'category': lineage['category'] if lineage else None,
        'enhanced': 'enhanced' in req.lower() or bool(lineage and lineage['enhanced']),
        'minLevel': min_level(req), 'requirements': req,
        'level': None, 'aon': aon_search(item['name']), 'src': item['system'].get('source', ''),
        'summary': summarize(markup, CLASS_SUMMARY_LIMIT), 'modifiers': modifiers(item['system']),
        **bonus_flag(item),
    }
    if lineage and lineage['parent']:
        rec['parent'] = lineage['parent']
    if REPEATABLE.search(plain(markup)):
        rec['repeatable'] = True
    if rec['category'] == 'specialization':
        rec['skillFocus'] = associated_skills(markup)
    stellar = STELLAR_TYPE.search(markup)
    if stellar and rec['category'] in ('revelation', 'zenithRevelation'):
        rec['stellarType'] = stellar.group(1) or stellar.group(2)
    return rec


def build_class_features(class_features, features, classes=None):
    feats = {s: i for s, i in class_features.items() if i['type'] == 'feat' or s in EXTRA_CLASS_FEATURES}
    by_id = {i['_id']: s for s, i in feats.items()}
    class_ids = {i['_id']: s for s, i in (classes or {}).items()}
    memo = {}
    raw = {}
    for slug, item in feats.items():
        req = item['system'].get('requirements', '') or ''
        named = CLASS_REQ.search(req)
        lineage = class_lineage(slug, feats, by_id, class_ids, memo)
        if slug in EXTRA_CLASS_FEATURES:
            lineage = lineage or {'cls': EXTRA_CLASS_FEATURES[slug], 'category': None, 'parent': None, 'enhanced': False}
        if lineage and lineage['cls'] not in CLASSES:
            continue
        if (not named and not lineage) or (not named and OTHER_CLASS_REQ.search(req)):
            continue
        raw[slug] = class_feature_record(item, lineage['cls'] if lineage else named.group(1).lower(), lineage)
        grants = option_grants(raw[slug]['category'], description(item), by_id)
        if grants:
            raw[slug]['grants'] = grants
    for slug, rec in list(raw.items()):
        for granted in [g for tier in rec.get('grants', {}).values() for g in tier]:
            if granted not in raw:
                orphan = {'cls': rec['cls'], 'category': None, 'parent': slug, 'enhanced': rec['enhanced']}
                raw[granted] = class_feature_record(feats[granted], rec['cls'], orphan)
    key_of = {}
    for slug in raw:
        key_of[slug] = slug if slug not in features and slug not in key_of.values() else f'class-{slug}'
    out = {}
    for slug, rec in raw.items():
        if rec.get('parent'):
            rec['parent'] = key_of.get(rec['parent'])
            if rec['parent'] is None:
                del rec['parent']
        for tier, slugs in rec.get('grants', {}).items():
            rec['grants'][tier] = [key_of[g] for g in slugs]
        out[key_of[slug]] = rec
    index = name_index({**features, **out})
    ids = {i: key_of[s] for i, s in by_id.items() if s in key_of}
    for slug, rec in raw.items():
        if rec['category']:
            attach_needs(rec, description(feats[slug]), ids, index)
    return out


def prune_needs(features):
    for rec in features.values():
        if 'needs' not in rec:
            continue
        kept = []
        for need in rec['needs']:
            options = need if isinstance(need, list) else [need]
            if all(o in features for o in options):
                kept.append(need)
            else:
                rec.setdefault('needsText', []).append('Requires ' + ' or '.join(options))
        if kept:
            rec['needs'] = kept
        else:
            del rec['needs']


def name_key(name):
    return re.sub(r'\s*\([^)]*\)', '', name.replace('’', "'")).strip().casefold()


def name_index(records):
    index = {}
    for key, rec in sorted(records.items()):
        index.setdefault(name_key(rec['name']), []).append((key, rec.get('cls')))
    return index


def resolve_need(part, ids, index, cls):
    found = [ids[i] for i in re.findall(r'\x00([\w#-]+)\x00', part) if i in ids]
    if found:
        return found
    for label in re.findall(r'\x01([^\x01]*)\x01', part):
        part = part.replace('\x01' + label + '\x01', label)
    name = re.sub(r'\s+', ' ', NEED_NOISE.sub(' ', re.sub(r'\x00[\w#-]+\x00', ' ', part))).strip(" ,.'").casefold()
    name = re.sub(r'^(?:(?:the|an?|both|selected)\s+)+', '', name)
    hits = sorted(index.get(name_key(name), []), key=lambda h: h[1] != cls)
    if hits and hits[0][1] is None:
        return [h[0] for h in hits if h[1] is None]
    return [h[0] for h in hits[:1]]


def attach_needs(rec, markup, ids, index):
    marked = NEED_LINK.sub(lambda m: f'\x00{m.group(2)}\x00\x01{m.group(3)}\x01', markup)
    text = re.sub(r'\s+', ' ', html.unescape(TAG.sub(' ', marked)))
    needs, texts = [], []
    for sentence in re.split(r'(?<=[.!?])\s+', text):
        match = NEED_SENTENCE.search(sentence)
        if not match or re.search(r'\brank', match.group(1)):
            continue
        shown = re.sub(r'\x00[\w#-]+\x00\x01([^\x01]*)\x01', r'\1', sentence).strip()
        phrase = re.sub(r'\([^()\x00]*\)', ' ', match.group(1)).strip()
        level = NEED_LEVEL.search(phrase)
        if level:
            rec['minLevel'] = max(rec['minLevel'] or 0, int(level.group(1)))
            phrase = NEED_LEVEL.sub('', phrase).strip()
            phrase = re.sub(r'^(?:and\s+)?(?:have\s+)?', '', phrase).strip()
            if not phrase:
                continue
        skill = NEED_CLASS_SKILL.match(re.sub(r'\x00[\w#-]+\x00|\x01', '', phrase).strip())
        if skill and prereq.SKILL_KEYS.get(skill.group(1).strip().casefold()):
            rec.setdefault('needsClassSkill', []).append(prereq.SKILL_KEYS[skill.group(1).strip().casefold()])
            continue
        if re.search(r'\bneither\b', phrase, re.I):
            texts.append(shown)
            continue
        listed = re.search(r'\(([^()]*\x00[^()]*)\)', re.sub(r'\((?:ex|su|sp)\)', '', match.group(1), flags=re.I))
        any_of = bool(listed) or bool(re.search(r'\bor\b', phrase))
        source = listed.group(1) if listed else phrase
        parts = [p for p in re.split(r',|\band\b|\bor\b|\(|\)', source) if p.strip(' \x00\x01')]
        resolved = [resolve_need(p, ids, index, rec['cls']) for p in parts]
        if not resolved or not all(resolved):
            texts.append(shown)
            continue
        if any_of:
            options = [o for r in resolved for o in r]
            needs.append(options if len(options) > 1 else options[0])
        else:
            needs.extend(r if len(r) > 1 else r[0] for r in resolved)
    if needs:
        rec['needs'] = needs
    if texts:
        rec['needsText'] = texts


def option_grants(category, markup, by_id):
    grants = {}
    if category in OPTION_TIERS:
        linked = [by_id[i] for i in HEADING_LINK.findall(markup) if i in by_id]
        for tier, slug in zip(OPTION_TIERS[category], linked):
            grants[str(tier)] = [slug]
    if category == 'specialization':
        exploit = SPEC_EXPLOIT.search(markup)
        if exploit and exploit.group(1) in by_id:
            grants[str(SPECIALIZATION_TIERS['exploit'])] = [by_id[exploit.group(1)]]
        powers = [by_id[i] for i in STRONG_LINK.findall(markup) if i in by_id and (not exploit or i != exploit.group(1))]
        if powers:
            grants[str(SPECIALIZATION_TIERS['power'])] = powers[:1]
    return grants


def load_core_traits(path, all_features):
    core = json.loads(Path(path).read_text(encoding='utf-8'))
    for base in RACES:
        if base not in core:
            raise ValueError(f'race_traits.json is missing base race {base}')
        slugs = list(core[base]['core']) + [s for group in core[base].get('byVariant', {}).values() for s in group]
        for slug in slugs:
            if slug not in all_features:
                raise ValueError(f'race_traits.json: {base} names unknown feature {slug}')
    return core


def core_traits_for(core, base, variant):
    entry = core[base]
    tokens = {t.casefold() for t in re.split(r'[\s,]+', variant or '') if t}
    out = list(entry['core'])
    for key, group in entry.get('byVariant', {}).items():
        if key in tokens:
            out += [s for s in group if s not in out]
    return out


def build_races(items, racial, core):
    id_to_slug = {i['_id']: s for s, i in racial.items() if i['type'] == 'feat'}
    by_name = {s: (s, i['system'].get('requirements', '')) for s, i in racial.items() if i['type'] == 'feat'}
    races = {}
    for slug, item in items.items():
        base, variant = split_name(item['name'])
        if base.casefold() not in RACES:
            continue
        s = item['system']
        core_traits = core_traits_for(core, slug_base(slug), variant)
        linked = traits_for_race(base, variant, description(item), id_to_slug, by_name)
        races[slug] = {
            'name': item['name'], 'base': slug_base(slug), 'variant': variant, 'size': s.get('size', 'medium'),
            'hp': s.get('hp', {}).get('value'), 'abilityMods': s.get('abilityMods', {}).get('parts', []),
            'coreTraits': core_traits, 'altTraits': [t for t in linked if t not in core_traits],
            'aon': aon('Races', base), 'src': s.get('source', ''), 'summary': summarize(description(item)),
            'modifiers': modifiers(s),
        }
    return races


def build_themes(items, theme_features, features):
    id_to_slug = {i['_id']: s for s, i in theme_features.items() if i['type'] == 'feat'}
    key_for = {}
    for key, feature in features.items():
        if feature['kind'] == 'theme':
            key_for[key.removeprefix('theme-')] = key
    themes = {}
    for slug, item in items.items():
        s = item['system']
        linked = []
        for feature_id in THEME_LINK.findall(description(item)):
            feature_slug = id_to_slug.get(feature_id)
            key = key_for.get(feature_slug)
            if key and key not in linked:
                linked.append(key)
        if not linked:
            linked = [k for k, f in features.items() if f['kind'] == 'theme' and f['requirements'].endswith(f' - {item["name"]}')]
        themes[slug] = {
            'name': item['name'], 'ability': s.get('abilityMod', {}).get('ability'),
            'mod': s.get('abilityMod', {}).get('mod'), 'skill': s.get('skill'), 'features': linked,
            'aon': aon('Themes', item['name']), 'src': s.get('source', ''), 'summary': summarize(description(item)),
        }
    return themes


def build_classes(items):
    classes = {}
    for slug, item in items.items():
        base_slug = slug.removesuffix('_enhanced')
        if base_slug not in CLASSES:
            continue
        s = item['system']
        base_name = split_name(items[base_slug]['name'])[0] if base_slug in items else item['name']
        classes[slug] = {
            'name': item['name'], 'slug': slug, 'bab': s['bab'], 'fort': s['fort'], 'ref': s['ref'], 'will': s['will'],
            'hp': s['hp']['value'], 'sp': s['sp']['value'], 'ranks': s['skillRanks']['value'], 'kas': s['kas'],
            'csk': true_keys(s.get('csk')),
            'prof': {'armor': s.get('proficiencies', {}).get('armor', {}), 'weapon': s.get('proficiencies', {}).get('weapon', {})},
            'caster': bool(s.get('isCaster')), 'spellAbility': s.get('spellAbility', ''),
            'spellsKnown': compact(s.get('spellsKnown')), 'spellsPerDay': compact(s.get('spellsPerDay')),
            'bonusSpellsPerDay': compact(s.get('bonusSpellsPerDay')),
            'enhancedOf': base_slug if slug.endswith('_enhanced') else None,
            'aon': aon('Classes', base_name), 'src': s.get('source', ''), 'summary': summarize(description(item)),
        }
    return classes


def prereq_text(item):
    s = item['system']
    text = s.get('requirements') or ''
    if not text:
        match = PREREQ.search(description(item))
        text = match.group(1) if match else ''
    return plain(text)


def build_feats(items, features=None, prereq_overrides=None):
    feat_slugs = {TYPE_PAREN.sub('', i['name']).strip().casefold().replace('-', ' '): s for s, i in items.items()}
    feature_slugs = {f['name'].casefold(): k for k, f in (features or {}).items()}
    overrides = prereq_overrides or {}
    feats = {}
    for slug, item in items.items():
        s = item['system']
        markup = description(item)
        benefit = BENEFIT.search(markup)
        text = prereq_text(item)
        parsed = overrides[slug]['prereq'] if slug in overrides else prereq.parse_prereq(text, feat_slugs, prereq.SKILL_KEYS, feature_slugs)
        feats[slug] = {
            'name': item['name'], 'combat': bool(s.get('details', {}).get('combat')), 'prereqText': text,
            'prereq': parsed, 'modifiers': modifiers(s), 'aon': aon('Feats', item['name']), 'src': s.get('source', ''),
            'summary': summarize(markup[benefit.end():] if benefit else markup), **bonus_flag(item),
        }
    return feats


def build_spells(items):
    spells = {}
    for slug, item in items.items():
        s = item['system']
        allowed = s.get('allowedClasses', {})
        spells[slug] = {
            'name': item['name'], 'level': s.get('level'), 'school': s.get('school', ''),
            'allowedClasses': {k: bool(allowed.get(k)) for k in ('myst', 'tech', 'precog', 'wysh')},
            'modifiers': modifiers(s), 'aon': aon('SpellDisplay', item['name']), 'src': s.get('source', ''),
            'summary': summarize(description(item)),
        }
    return spells


def number(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def storage_amount(system, subtype):
    return sum((entry.get('amount') or 0) for entry in system.get('container', {}).get('storage', []) if entry.get('subtype') == subtype)


def weapon_block(s):
    rng = s.get('range', {})
    units = rng.get('units', '')
    properties = []
    for key, prop in (s.get('properties') or {}).items():
        if prop.get('value'):
            properties.append(f"{key} {prop['extension']}".strip() if prop.get('extension') else key)
    return {
        'type': s.get('weaponType'), 'category': s.get('weaponCategory'),
        'damage': [{'formula': p.get('formula', ''), 'types': true_keys(p.get('types'))} for p in s.get('damage', {}).get('parts', [])],
        'crit': s.get('critical', {}).get('effect', ''),
        'range': f"{rng.get('value')} {units}".strip() if units not in ('', 'none', None) and rng.get('value') else '',
        'properties': properties, 'special': s.get('special', ''),
    }


def build_items(items):
    out = {}
    for slug, item in items.items():
        kind = item['type']
        if kind not in ITEM_TYPES:
            continue
        s = item['system']
        rec = {
            'name': item['name'], 'type': kind, 'level': number(s.get('level')), 'price': number(s.get('price')),
            'bulk': str(s.get('bulk', '')), 'aon': aon_search(item['name']), 'src': s.get('source', ''),
        }
        armor = s.get('armor')
        if kind == 'equipment' and armor and armor.get('type'):
            rec['armor'] = {k: armor.get(k) for k in ('type', 'eac', 'kac', 'dex', 'acp', 'speedAdjust')}
            rec['slots'] = storage_amount(s, 'armorUpgrade')
        if kind == 'weapon':
            rec['weapon'] = weapon_block(s)
            rec['slots'] = storage_amount(s, 'fusion')
        if kind == 'shield':
            rec['slots'] = storage_amount(s, 'fusion')
        if kind == 'upgrade':
            rec['slotCost'] = s.get('slots')
        if kind == 'fusion':
            rec['fusionLevel'] = number(s.get('level'))
        if kind == 'augmentation':
            rec['augSystem'] = s.get('system')
            rec['augType'] = s.get('type')
        rec['modifiers'] = modifiers(s)
        rec['summary'] = summarize(description(item), ITEM_SUMMARY_LIMIT)
        out[slug] = rec
    return out


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def effect_values(overrides):
    return {slug: entry['effects'] for slug, entry in overrides.items() if not entry.get('replace')}


def apply_replacements(feats, features, overrides):
    for slug, entry in overrides.items():
        if not entry.get('replace'):
            continue
        if slug.startswith('feature:'):
            target = features.get(slug.removeprefix('feature:'))
        else:
            target = feats.get(slug) or features.get(slug)
        if target is None:
            raise ValueError(f'effect override {slug} replaces modifiers on an unknown record')
        target['modifiers'] = entry['modifiers']
        target['modifiersReplaced'] = True


LEVELS = [str(n) for n in range(1, 21)]
ENTRY_KINDS = ('fixed', 'choice', 'fixedOf', 'bonusFeat', 'skillPick', 'abilityPick')


def apply_min_levels(features, table):
    for slug, level in table.items():
        if slug.startswith('_'):
            continue
        if slug not in features:
            raise ValueError(f'class_progressions.json _minLevels names unknown feature {slug}')
        features[slug]['minLevel'] = level


def expand_pool(pool, cls, features):
    if not isinstance(pool, dict) or 'category' not in pool:
        return pool
    exclude = set(pool.get('exclude', []))
    banned = set(pool.get('excludeNeeds', []))
    return sorted(k for k, f in features.items()
                  if f['kind'] == 'class' and f['cls'] == cls and f['category'] == pool['category']
                  and k not in exclude and (pool.get('enhanced') or not f['enhanced'])
                  and not (banned and needs_any(k, banned, features)))


def needs_any(slug, banned, features, seen=None):
    seen = set() if seen is None else seen
    if slug in seen:
        return False
    seen.add(slug)
    for need in features.get(slug, {}).get('needs', []):
        options = need if isinstance(need, list) else [need]
        if all(o in banned or needs_any(o, banned, features, seen) for o in options):
            return True
    return False


def check_entry(entry, cls, where, features, feats, choice_ids):
    kinds = [k for k in ENTRY_KINDS if k in entry]
    if len(kinds) != 1:
        raise ValueError(f'{where}: entry must have exactly one of {ENTRY_KINDS}: {entry}')
    if 'fixed' in entry and entry['fixed'] not in features:
        raise ValueError(f'{where}: unknown feature {entry["fixed"]}')
    if 'choice' in entry:
        pool = entry['pool']
        if isinstance(pool, dict):
            if pool.get('poolOf') not in choice_ids:
                raise ValueError(f'{where}: poolOf names unknown choice {pool.get("poolOf")}')
        else:
            if not pool:
                raise ValueError(f'{where}: choice {entry["choice"]} has an empty pool')
            for slug in pool:
                if slug not in features:
                    raise ValueError(f'{where}: pool of {entry["choice"]} names unknown feature {slug}')
                if entry.get('distinct') and not features[slug].get(entry['distinct']):
                    raise ValueError(f'{where}: {slug} has no {entry["distinct"]} for choice {entry["choice"]}')
    if 'fixedOf' in entry and entry['fixedOf'] not in choice_ids:
        raise ValueError(f'{where}: fixedOf names unknown choice {entry["fixedOf"]}')
    if 'bonusFeat' in entry and isinstance(entry.get('pool'), list):
        for slug in entry['pool']:
            if slug not in feats:
                raise ValueError(f'{where}: bonus feat pool names unknown feat {slug}')
    if 'skillPick' in entry:
        for key in entry.get('from', []):
            if key not in prereq.SKILL_KEYS.values():
                raise ValueError(f'{where}: unknown skill {key}')


def build_progressions(source, features, feats):
    apply_min_levels(features, source.get('_minLevels', {}))
    out = {}
    for cls in CLASSES:
        if cls not in source:
            raise ValueError(f'class_progressions.json is missing class {cls}')
        prog = source[cls]
        missing = [n for n in LEVELS if n not in prog.get('levels', {})]
        if missing:
            raise ValueError(f'class_progressions.json: {cls} lacks levels {", ".join(missing)}')
        blocks = {'levels': prog['levels']}
        if 'enhanced' in prog:
            blocks['enhanced'] = prog['enhanced']['levels']
        choice_ids = {e['choice'] for block in blocks.values() for entries in block.values() for e in entries if 'choice' in e}
        built = {}
        for name, block in blocks.items():
            levels = {}
            for n, entries in block.items():
                if n not in LEVELS:
                    raise ValueError(f'class_progressions.json: {cls} has unknown level {n}')
                expanded = []
                for entry in entries:
                    e = dict(entry)
                    if 'choice' in e:
                        e['pool'] = expand_pool(e['pool'], cls, features)
                    check_entry(e, cls, f'{cls} {name} {n}', features, feats, choice_ids)
                    expanded.append(e)
                levels[n] = expanded
            built[name] = levels
        out[cls] = {'levels': built['levels']}
        if 'enhanced' in built:
            out[cls]['enhanced'] = {'levels': built['enhanced']}
    return out


def build(src, sha=None, built=None, core_path=ROOT / 'tools' / 'race_traits.json',
          prereq_path=ROOT / 'tools' / 'prereq_overrides.json', effects_path=ROOT / 'tools' / 'effect_overrides.json',
          progressions_path=ROOT / 'tools' / 'class_progressions.json'):
    src = Path(src)
    racial = load_dir(src / 'racial-features')
    theme = load_dir(src / 'theme-features')
    features = build_features(racial, theme)
    class_items = load_dir(src / 'classes')
    class_features = build_class_features(load_dir(src / 'class-features'), features, class_items)
    races = build_races(load_dir(src / 'races'), racial, load_core_traits(core_path, features))
    themes = build_themes(load_dir(src / 'themes'), theme, features)
    used = {t for r in races.values() for t in r['coreTraits'] + r['altTraits']} | {f for t in themes.values() for f in t['features']}
    feats = build_feats(load_dir(src / 'feats'), features, load_json(prereq_path))
    emitted = {**{k: v for k, v in features.items() if k in used}, **class_features}
    prune_needs(emitted)
    effect_overrides = load_json(effects_path)
    apply_replacements(feats, emitted, effect_overrides)
    progressions = build_progressions(load_json(progressions_path), emitted, feats)
    return {
        'meta': {'foundrySha': sha, 'built': built},
        'races': races,
        'themes': themes,
        'classes': build_classes(class_items),
        'feats': feats,
        'features': emitted,
        'spells': build_spells(load_dir(src / 'spells')),
        'items': build_items(load_dir(src / 'equipment')),
        'progressions': progressions,
        'overrides': {'effects': effect_values(effect_overrides)},
    }


PARTS = {
    'core': ('meta', 'races', 'themes', 'classes', 'feats', 'features', 'progressions', 'overrides'),
    'spells': ('spells',),
    'items': ('items',),
}
INDEX_JS = (
    "module.exports = Object.assign({}, require('./core.js'), require('./spells.js'), require('./items.js'));\n"
)


def write_part_js(part, path):
    body = json.dumps(part, separators=(',', ':'), ensure_ascii=False)
    text = (
        '(function(root){\n'
        f'  const part = {body};\n'
        "  if (typeof module !== 'undefined') module.exports = part; else root.SFDATA = Object.assign(root.SFDATA || {}, part);\n"
        '})(this);\n'
    )
    Path(path).write_text(text, encoding='utf-8')


def write_data_dir(data, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, keys in PARTS.items():
        write_part_js({k: data[k] for k in keys}, out_dir / f'{name}.js')
    (out_dir / 'index.js').write_text(INDEX_JS, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sha', default=(ROOT / 'tools' / 'foundry.lock').read_text().strip())
    parser.add_argument('--out', default=str(ROOT / 'data'))
    args = parser.parse_args()
    src = fetch_foundry(args.sha, ROOT / '.cache' / 'foundry')
    data = build(src, sha=args.sha, built=date.today().isoformat())
    failed = prereq.check_coverage(data)
    if failed:
        print(f'coverage gate failed for {len(failed)} entries:', file=sys.stderr)
        for slug in failed:
            print(f'  {slug}', file=sys.stderr)
        sys.exit(1)
    write_data_dir(data, args.out)


if __name__ == '__main__':
    main()
