import json
import re
from pathlib import Path

ABILITIES = {'str': 'str', 'strength': 'str', 'dex': 'dex', 'dexterity': 'dex', 'con': 'con', 'constitution': 'con',
             'int': 'int', 'intelligence': 'int', 'wis': 'wis', 'wisdom': 'wis', 'cha': 'cha', 'charisma': 'cha'}
SKILL_KEYS = {
    'acrobatics': 'acr', 'athletics': 'ath', 'bluff': 'blu', 'computers': 'com', 'culture': 'cul', 'diplomacy': 'dip',
    'disguise': 'dis', 'engineering': 'eng', 'intimidate': 'int', 'life science': 'lsc', 'medicine': 'med',
    'mysticism': 'mys', 'perception': 'per', 'physical science': 'phs', 'piloting': 'pil', 'profession': 'pro', 'sense motive': 'sen',
    'sleight of hand': 'sle', 'stealth': 'ste', 'survival': 'sur',
}
CLASS_SLUGS = ['envoy', 'mechanic', 'mystic', 'operative', 'solarian', 'soldier', 'technomancer']
RACE_BASES = ['android', 'human', 'kasatha', 'lashunta', 'shirren', 'vesk', 'ysoki', 'dwarf', 'elf', 'gnome',
              'half-elf', 'halfling', 'half-orc']
PROFICIENCY_GROUPS = {
    'basic melee weapons', 'advanced melee weapons', 'small arms', 'longarms', 'heavy weapons', 'sniper weapons',
    'grenades', 'light armor', 'heavy armor', 'powered armor', 'shields',
}

ABILITY_NAME = '|'.join(sorted(ABILITIES, key=len, reverse=True))
CLASS_NAME = '|'.join(CLASS_SLUGS)
ORDINAL = r'(\d+)(?:st|nd|rd|th)?'
TYPE_SUFFIX = re.compile(r'\s*\((?:combat|teamwork|combat teamwork)\)', re.I)
ABILITY_A = re.compile(rf'^({ABILITY_NAME})\s+(\d+)$', re.I)
ABILITY_B = re.compile(rf'^(\d+)\s+({ABILITY_NAME})$', re.I)
BAB = re.compile(r'^(?:base attack bonus\s*\+?(\d+)|\+?(\d+)\s+BAB)$', re.I)
CLASS_LEVEL = re.compile(rf'^({CLASS_NAME}) level\s+{ORDINAL}$', re.I)
LEVEL = re.compile(rf'^(?:character level\s+{ORDINAL}|level\s+{ORDINAL}|{ORDINAL} level)$', re.I)
RANKS = re.compile(r'^(.+?)\s+(\d+)\s+ranks?$', re.I)
PROFICIENCY = re.compile(r'^proficiency\s+(?:in|with)\s+(.+)$', re.I)
SPECIES_TRAIT = re.compile(r'^(.+?)\s+species trait$', re.I)


def split_top(text, separators):
    parts, depth, cur = [], 0, ''
    for ch in text:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(depth - 1, 0)
        if ch in separators and depth == 0:
            parts.append(cur.strip())
            cur = ''
        else:
            cur += ch
    parts.append(cur.strip())
    return [p for p in parts if p]


def normalize(text):
    text = re.sub(r'^\s*prerequisites?\s*:\s*', '', (text or '').strip(), flags=re.I)
    return text.strip().rstrip('.').strip()


def parse_atom(clause, feat_slugs, feature_slugs):
    clause = clause.strip().rstrip('.').strip()
    if m := ABILITY_A.match(clause):
        return {'k': 'ability', 'a': ABILITIES[m.group(1).lower()], 'min': int(m.group(2))}
    if m := ABILITY_B.match(clause):
        return {'k': 'ability', 'a': ABILITIES[m.group(2).lower()], 'min': int(m.group(1))}
    if m := BAB.match(clause):
        return {'k': 'bab', 'min': int(m.group(1) or m.group(2))}
    if m := CLASS_LEVEL.match(clause):
        return {'k': 'classLevel', 'cls': m.group(1).lower(), 'min': int(m.group(2))}
    if m := LEVEL.match(clause):
        return {'k': 'level', 'min': int(next(g for g in m.groups() if g))}
    if m := PROFICIENCY.match(clause):
        group = m.group(1).strip().lower()
        return {'k': 'proficiency', 'group': group} if group in PROFICIENCY_GROUPS else None
    if m := SPECIES_TRAIT.match(clause):
        slug = (feature_slugs or {}).get(m.group(1).strip().casefold())
        return {'k': 'feature', 'feature': slug} if slug else None
    if clause.casefold() in RACE_BASES:
        return {'k': 'race', 'race': clause.casefold()}
    name = re.sub(r'\s+feat$', '', TYPE_SUFFIX.sub('', clause).strip(), flags=re.I).casefold()
    slug = feat_slugs.get(name) or feat_slugs.get(name.replace('-', ' '))
    return {'k': 'feat', 'feat': slug} if slug else None


def skill_key(name, skill_names):
    name = re.sub(r'\s*\(.*?\)', '', name.strip()).strip()
    name = re.sub(r'^appropriate\s+', '', name, flags=re.I)
    return skill_names.get(name.casefold())


def parse_ranks(clause, skill_names):
    m = RANKS.match(clause.strip().rstrip('.'))
    if not m:
        return None
    checks = []
    for name in re.split(r'\s+or\s+', m.group(1)):
        key = skill_key(name, skill_names)
        if not key:
            return None
        checks.append({'k': 'ranks', 'skill': key, 'min': int(m.group(2))})
    return checks[0] if len(checks) == 1 else {'k': 'any', 'of': checks}


def parse_clause(clause, feat_slugs, skill_names, feature_slugs):
    if ranks := parse_ranks(clause, skill_names):
        return ranks
    options = re.split(r'\s+or\s+', clause)
    if len(options) == 1:
        return parse_atom(clause, feat_slugs, feature_slugs)
    checks = []
    for option in options:
        check = parse_ranks(option, skill_names) or parse_atom(option, feat_slugs, feature_slugs)
        if not check:
            return None
        checks.append(check)
    return {'k': 'any', 'of': checks}


def fold_any(items, feat_slugs, skill_names, feature_slugs):
    shared = RANKS.match(items[-1].strip().rstrip('.'))
    if shared:
        keys = [skill_key(i, skill_names) for i in items[:-1]] + [skill_key(shared.group(1), skill_names)]
        if all(skill_key(i, skill_names) for i in items[:-1]):
            if all(keys):
                return {'k': 'any', 'of': [{'k': 'ranks', 'skill': k, 'min': int(shared.group(2))} for k in keys]}
            return None
    checks = [parse_clause(i, feat_slugs, skill_names, feature_slugs) for i in items]
    return None if any(c is None for c in checks) else {'k': 'any', 'of': checks}


def expand_proficiency(items):
    out = []
    for item in items:
        m = PROFICIENCY.match(item.strip().rstrip('.'))
        if not m:
            out.append(item)
            continue
        joiner = ' or ' if ' or ' in m.group(1) else ' and '
        groups = [g.strip() for g in re.split(r'\s+or\s+|\s+and\s+', m.group(1).replace('light and heavy armor', 'light armor and heavy armor'))]
        if len(groups) > 1 and all(g in PROFICIENCY_GROUPS for g in groups):
            out += [f'proficiency in {g}' for g in groups] if joiner == ' and ' else [' or '.join(f'proficiency in {g}' for g in groups)]
        else:
            out.append(item)
    return out


def parse_group(group, feat_slugs, skill_names, feature_slugs):
    items = expand_proficiency(split_top(group, {','}))
    if len(items) > 1 and re.match(r'or\s', items[-1], re.I):
        items[-1] = items[-1][3:].strip()
        folded = fold_any(items, feat_slugs, skill_names, feature_slugs)
        return None if folded is None else [folded]
    checks = [parse_clause(i, feat_slugs, skill_names, feature_slugs) for i in items]
    return None if any(c is None for c in checks) else checks


def parse_prereq(text, feat_slugs, skill_names, feature_slugs=None):
    text = normalize(text)
    if not text:
        return {'all': []}
    checks = []
    for group in split_top(text, {';'}):
        parsed = parse_group(group, feat_slugs, skill_names, feature_slugs)
        if parsed is None:
            return None
        checks += parsed
    return {'all': checks}


def load_overrides(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


BONUS_TARGETS = (
    'AC|EAC|KAC|Energy Armor Class|Kinetic Armor Class|Fortitude|Reflex|Will|saving throws|initiative|'
    'Stamina Points|Hit Points|speed|attack rolls|damage|saves|(?:any )?saving throws?|(?:their |your |all )?checks?|Acrobatics|Athletics|Bluff|Computers|Culture|Diplomacy|'
    'Disguise|Engineering|Intimidate|Life Science|Medicine|Mysticism|Perception|Physical Science|Piloting|'
    'Profession|Sense Motive|Sleight of Hand|Stealth|Survival'
)
BONUS = re.compile(rf'\+\d+ (\w+ )?bonus (?:to|on) ({BONUS_TARGETS})', re.I)
PHASE1_CLASS = re.compile(rf'\b({CLASS_NAME})\b', re.I)


def override_key(slug, feat_slugs):
    return f'feature:{slug}' if slug in feat_slugs else slug


def gated_features(data):
    core = {t for r in data['races'].values() for t in r['coreTraits']}
    for slug, feature in data['features'].items():
        if feature['kind'] in ('theme', 'class') or slug in core or PHASE1_CLASS.search(feature.get('requirements', '')):
            yield slug, feature


def has_constant(modifiers):
    return any(m.get('modifierType') == 'constant' for m in modifiers)


def check_coverage(data):
    effects = data.get('overrides', {}).get('effects', {})
    failed = []
    for slug, feat in data['feats'].items():
        if feat.get('prereq') is None:
            failed.append(slug)
        elif (feat.get('bonus') or BONUS.search(feat['summary'])) and not has_constant(feat['modifiers']) and slug not in effects:
            failed.append(slug)
    for slug, feature in gated_features(data):
        key = override_key(slug, data['feats'])
        if (feature.get('bonus') or BONUS.search(feature['summary'])) and not has_constant(feature['modifiers']) and key not in effects:
            failed.append(key)
    return failed
