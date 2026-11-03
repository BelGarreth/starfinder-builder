const test = require('node:test');
const assert = require('node:assert');
const rules = require('../js/rules.js');
const { validate, allowed } = require('../js/validate.js');
const data = require('../data/index.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const spellBlockers = (c) => validate(c, data).filter((b) => b.tab === 'spells');
const codes = (c) => spellBlockers(c).map((b) => b.code);

const onList = (key, level) => Object.keys(data.spells).filter((k) => data.spells[k].level === level && data.spells[k].allowedClasses[key]);
const T0 = onList('tech', 0);
const T1 = onList('tech', 1);
const T2 = onList('tech', 2);
const T3 = onList('tech', 3);

function caster(cls, ability, levels) {
  const abilities = { pb: { [ability]: 7 }, themeAny: ability };
  return { v: 1, name: 'Caster', race: 'human', variant: null, theme: 'themeless', abilities, levels: levels || [{ class: cls, skills: {}, feats: [], choices: {}, spells: {} }], gear: [], notes: '' };
}

function tech(learn) {
  const c = caster('technomancer', 'int');
  c.levels[0].spells = { learn };
  return c;
}

test('level 1 technomancer with Int 18 knows 4 cantrips and 2 first-level spells with 2 + 1 per day', () => {
  const c = tech([]);
  assert.strictEqual(rules.baseScores(c, data).int, 18);
  const slots = rules.spellSlots(c, data).technomancer;
  assert.deepStrictEqual(slots.known, { 0: 4, 1: 2 });
  assert.deepStrictEqual(slots.perDay, { 1: 3 });
});

test('bonus spells need a positive modifier and only apply to levels the class can cast', () => {
  const c = tech([]);
  c.abilities.pb.int = 0;
  c.abilities.themeAny = 'str';
  c.race = 'vesk';
  assert.deepStrictEqual(rules.spellSlots(c, data).technomancer.perDay, { 1: 2 });
});

test('a full level 1 technomancer pick list has no spell blockers', () => {
  const c = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease']);
  assert.deepStrictEqual(spellBlockers(c), []);
});

test('a second-level spell at level 1 is blocked', () => {
  const c = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', T2[0]]);
  assert.ok(codes(c).indexOf('level') !== -1);
  assert.strictEqual(allowed('spell', T2[0], 0, c, data).ok, false);
});

test('a mystic-only spell is blocked for a technomancer', () => {
  const c = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'acidic_mist']);
  const b = spellBlockers(c).find((x) => x.code === 'class');
  assert.ok(b);
  assert.strictEqual(b.ref, 'acidic_mist');
  assert.strictEqual(allowed('spell', 'acidic_mist', 0, c, data).ok, false);
});

test('known more spells than the table allows is blocked', () => {
  const c = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease', 'magic_missile']);
  c.levels[0].spells.learn[6] = T1[2];
  assert.ok(codes(c).indexOf('overspent') !== -1);
});

test('duplicates, unknown slugs and unspent picks are reported', () => {
  const dup = tech(['detect_magic', 'detect_magic', 'ghost_sound', 'mending', 'magic_missile', 'grease']);
  assert.ok(codes(dup).indexOf('duplicate') !== -1);
  const gone = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'not_a_spell']);
  assert.ok(codes(gone).indexOf('missing') !== -1);
  const none = tech([]);
  assert.deepStrictEqual(spellBlockers(none).map((b) => b.code), ['unspent', 'unspent']);
});

test('allowed spell reports an open slot, a full level and a spell already picked', () => {
  const c = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile']);
  assert.strictEqual(allowed('spell', 'grease', 0, c, data).ok, true);
  assert.strictEqual(allowed('spell', 'daze', 0, c, data).ok, true);
  const full = tech(['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease']);
  assert.strictEqual(allowed('spell', T1[3], 0, full, data).ok, false);
  assert.strictEqual(allowed('spell', 'ghost_sound', 0, full, data).ok, true);
});

test('spell ability must reach 10 plus the spell level to learn that level', () => {
  const low = tech(['detect_magic', 'daze', 'ghost_sound', 'mending']);
  low.abilities = { pb: {}, themeAny: 'str' };
  assert.strictEqual(rules.baseScores(low, data).int, 10);
  assert.deepStrictEqual(spellBlockers(low), []);
  low.levels[0].spells.learn.push('magic_missile');
  const b = spellBlockers(low).find((x) => x.code === 'ability');
  assert.ok(b && b.ref === 'magic_missile');
  assert.strictEqual(allowed('spell', 'magic_missile', 0, low, data).ok, false);
});

function leveled(cls, ability, n, spellsByLevel) {
  const levels = [];
  for (let i = 1; i <= n; i++) levels.push({ class: cls, skills: {}, feats: [], choices: {}, spells: spellsByLevel[i] || {} });
  return caster(cls, ability, levels);
}

test('level 2 learns the table delta, level 4 opens second-level spells, swaps replace a same-level spell', () => {
  const c = leveled('technomancer', 'int', 4, {
    1: { learn: ['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease'] },
    2: { learn: [T0.filter((k) => k === 'dancing_lights')[0], T1[2]] },
    3: { learn: [T0[8], T1[3]] },
    4: { learn: [T2[0], T2[1]] }
  });
  const slots = rules.spellSlots(c, data).technomancer;
  assert.deepStrictEqual(slots.known, { 0: 6, 1: 4, 2: 2 });
  const blockers = spellBlockers(c).filter((b) => b.level !== 1);
  assert.deepStrictEqual(blockers.filter((b) => b.code !== 'unspent').map((b) => [b.level, b.code, b.ref]), []);
});

test('swap drops a known spell for another of the same level once per level', () => {
  const base = {
    1: { learn: ['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease'] },
    2: { learn: [T0[8], T1[2]], swap: { from: 'grease', to: T1[3] } }
  };
  const c = leveled('technomancer', 'int', 2, base);
  assert.deepStrictEqual(spellBlockers(c).filter((b) => b.code !== 'unspent'), []);
  const wrongLevel = clone(c);
  wrongLevel.levels[1].spells.swap = { from: 'grease', to: T2[0] };
  assert.ok(codes(wrongLevel).length > 0);
  const notKnown = clone(c);
  notKnown.levels[1].spells.swap = { from: T1[3], to: 'grease' };
  assert.ok(codes(notKnown).indexOf('swap') !== -1);
  const firstLevel = clone(c);
  firstLevel.levels[0].spells.swap = { from: 'grease', to: T1[3] };
  assert.ok(codes(firstLevel).indexOf('swap') !== -1);
});

test('multiclass casters keep separate known pools per class', () => {
  const c = leveled('technomancer', 'int', 1, {});
  c.levels.push({ class: 'mystic', skills: {}, feats: [], choices: { connection: 'healer' }, spells: {} });
  const slots = rules.spellSlots(c, data);
  assert.deepStrictEqual(Object.keys(slots).sort(), ['mystic', 'technomancer']);
  assert.deepStrictEqual(slots.mystic.known, { 0: 4, 1: 2 });
  assert.deepStrictEqual(slots.technomancer.known, { 0: 4, 1: 2 });
});

test('mystic connection spells are added automatically and do not count as known', () => {
  const c = leveled('mystic', 'wis', 1, { 1: { learn: ['detect_magic', 'daze', 'ghost_sound', 'distant_speech', 'acidic_mist', 'aqueous_form'] } });
  c.levels[0].choices = { connection: 'healer' };
  assert.deepStrictEqual(rules.connectionSpells(c, data).mystic, [{ slug: 'mystic_cure', level: 1 }]);
  assert.deepStrictEqual(spellBlockers(c), []);
  c.levels[0].spells.learn[5] = 'mystic_cure';
  assert.ok(codes(c).indexOf('duplicate') !== -1);
});

test('connection spells follow fixed and variable-level entries', () => {
  const at = (conn, n) => {
    const c = leveled('mystic', 'wis', n, {});
    c.levels[0].choices = { connection: conn };
    return rules.connectionSpells(c, data).mystic.map((s) => s.slug + ':' + s.level);
  };
  assert.deepStrictEqual(at('overlord', 1), ['command:1']);
  assert.deepStrictEqual(at('overlord', 4), ['command:1', 'hold_person:2']);
  assert.deepStrictEqual(at('healer', 4), ['remove_condition_lesser:1', 'mystic_cure:2']);
});

test('non-casters cannot learn spells', () => {
  const c = leveled('soldier', 'str', 1, { 1: { learn: ['detect_magic'] } });
  assert.deepStrictEqual(codes(c), ['invalid']);
  assert.deepStrictEqual(rules.spellSlots(c, data), {});
});

test('enhanced and base variants of a class cannot be mixed', () => {
  const c = leveled('technomancer', 'int', 2, {});
  c.levels[1].class = 'technomancer_enhanced';
  const b = validate(c, data).filter((x) => x.tab === 'class' && x.code === 'class');
  assert.deepStrictEqual(b.map((x) => x.level), [2]);
  assert.strictEqual(allowed('class', 'technomancer_enhanced', 0, c, data).ok, true);
  assert.strictEqual(allowed('class', 'technomancer', 1, c, data).ok, true);
  assert.strictEqual(allowed('class', 'technomancer_enhanced', 1, c, data).ok, false);
  assert.strictEqual(allowed('class', 'mystic', 1, c, data).ok, true);
  assert.strictEqual(allowed('class', 'technomancer', 0, leveled('technomancer', 'int', 1, {}), data).ok, true);
});

test('a bad swap does not add its target and a self swap is rejected', () => {
  const c = leveled('technomancer', 'int', 3, {
    1: { learn: ['detect_magic', 'daze', 'ghost_sound', 'mending', 'magic_missile', 'grease'] },
    2: { learn: [T0[8], T1[2]], swap: { from: T1[3], to: T1[4] } },
    3: { learn: [T0[9], T1[3]] }
  });
  const dupe = spellBlockers(c).filter((b) => b.level === 3 && b.code === 'duplicate');
  assert.deepStrictEqual(dupe, []);
  const self = leveled('technomancer', 'int', 2, { 1: { learn: ['grease'] }, 2: { swap: { from: 'grease', to: 'grease' } } });
  assert.ok(codes(self).indexOf('swap') !== -1);
});
