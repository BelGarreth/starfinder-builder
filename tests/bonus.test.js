const test = require('node:test');
const assert = require('node:assert');
const bonus = require('../js/bonus.js');
const data = require('../data/index.js');
const { evalFormula, formulaCtx } = require('../js/formula.js');
const vesk = require('./fixtures/vesk-soldier-1.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const lvl = (cls, extra) => Object.assign({ class: cls, skills: {}, feats: [], choices: {}, spells: {} }, extra);
const levelled = (cls, n, firstExtra) => {
  const c = clone(vesk);
  c.levels = [];
  for (let i = 0; i < n; i++) c.levels.push(lvl(cls, i === 0 ? firstExtra : {}));
  return c;
};

test('stack: typed bonuses keep the highest, untyped stack, penalties stack', () => {
  assert.strictEqual(bonus.stack([
    { type: 'insight', value: 2 }, { type: 'insight', value: 1 },
    { type: 'untyped', value: 1 }, { type: 'untyped', value: 1 },
    { type: 'racial', value: -1 }
  ]), 3);
});

test('stack: circumstance stacks across sources but not within one source', () => {
  assert.strictEqual(bonus.stack([
    { type: 'circumstance', value: 2, source: 'A' }, { type: 'circumstance', value: 1, source: 'B' }
  ]), 3);
  assert.strictEqual(bonus.stack([
    { type: 'circumstance', value: 2, source: 'A' }, { type: 'circumstance', value: 4, source: 'A' }
  ]), 4);
});

test('stack: empty and different typed bonuses', () => {
  assert.strictEqual(bonus.stack([]), 0);
  assert.strictEqual(bonus.stack([{ type: 'insight', value: 2 }, { type: 'enhancement', value: 3 }, { type: 'morale', value: 1 }]), 6);
  assert.strictEqual(bonus.stack([{ type: 'enhancement', value: -2 }, { type: 'enhancement', value: -1 }, { type: 'enhancement', value: 2 }]), -1);
});

test('toughness at level 4 adds 4 sp', () => {
  const c = levelled('soldier', 4);
  c.levels[0].feats = ['toughness'];
  assert.strictEqual(bonus.totalFor(c, data, 'sp'), 4);
  assert.strictEqual(bonus.totalFor(c, data, 'hp'), 0);
});

test('target maps effect types to sheet keys', () => {
  const t = (effectType, valueAffected) => bonus.target({ effectType, valueAffected });
  assert.deepStrictEqual(t('ac', 'both'), ['eac', 'kac']);
  assert.deepStrictEqual(t('ac', 'kac'), ['kac']);
  assert.deepStrictEqual(t('save', 'reflex'), ['ref']);
  assert.deepStrictEqual(t('saves', ''), ['fort', 'ref', 'will']);
  assert.deepStrictEqual(t('stamina-points', ''), ['sp']);
  assert.deepStrictEqual(t('skill', 'ath'), ['skill.ath']);
  assert.deepStrictEqual(t('all-skills', ''), ['skills.all']);
  assert.deepStrictEqual(t('specific-speed', 'land'), ['speed.land']);
  assert.deepStrictEqual(t('ability-score', 'str'), ['ability.str']);
  assert.deepStrictEqual(t('ability-skills', 'dex'), ['ability-skills.dex']);
  assert.deepStrictEqual(t('all-attacks', ''), ['attack.all']);
  assert.deepStrictEqual(t('melee-damage', ''), ['damage.melee']);
});

test('unknown effect type throws in strict mode and is ignored otherwise', () => {
  assert.throws(() => bonus.target({ effectType: 'nonsense', valueAffected: '' }, true));
  assert.deepStrictEqual(bonus.target({ effectType: 'nonsense', valueAffected: '' }), []);
});

test('when: armor and lightOrNoArmor gating', () => {
  const state = (armorType, encumbered) => ({ armorType, encumbered: !!encumbered });
  assert.strictEqual(bonus.whenHolds('armor', state('light')), true);
  assert.strictEqual(bonus.whenHolds('armor', state(null)), false);
  assert.strictEqual(bonus.whenHolds('lightOrNoArmor', state(null)), true);
  assert.strictEqual(bonus.whenHolds('lightOrNoArmor', state('light')), true);
  assert.strictEqual(bonus.whenHolds('lightOrNoArmor', state('heavy')), false);
  assert.strictEqual(bonus.whenHolds('lightOrNoArmor', state('power')), false);
  assert.strictEqual(bonus.whenHolds('lightOrNoArmor', state(null, true)), false);
  assert.strictEqual(bonus.whenHolds(undefined, state('heavy', true)), true);
  assert.throws(() => bonus.whenHolds('moon', state(null)));
});

test('armorTypeOf uses the first equipped item with an armor field', () => {
  const lightKey = Object.keys(data.items).find((k) => data.items[k].armor && data.items[k].armor.type === 'light');
  const heavyKey = Object.keys(data.items).find((k) => data.items[k].armor && data.items[k].armor.type === 'heavy');
  const c = clone(vesk);
  assert.strictEqual(bonus.armorTypeOf(c, data), null);
  c.gear = [{ item: heavyKey, equipped: false }, { item: lightKey, equipped: true }];
  assert.strictEqual(bonus.armorTypeOf(c, data), 'light');
  c.gear = [{ item: 'does_not_exist', equipped: true }, { item: heavyKey, equipped: true }, { item: lightKey, equipped: true }];
  assert.strictEqual(bonus.armorTypeOf(c, data), 'heavy');
});

test('quick movement applies only in light armor or none and not encumbered', () => {
  const c = levelled('operative', 9);
  c.levels[0].choices = { exploit: 'quick_movement_(ex)' };
  const lightKey = Object.keys(data.items).find((k) => data.items[k].armor && data.items[k].armor.type === 'light');
  const heavyKey = Object.keys(data.items).find((k) => data.items[k].armor && data.items[k].armor.type === 'heavy');
  assert.strictEqual(bonus.totalFor(c, data, 'speed.land'), 20);
  assert.strictEqual(bonus.totalFor(c, data, 'speed.land', { state: { armorType: null, encumbered: true } }), 0);
  c.gear = [{ item: lightKey, equipped: true }];
  assert.strictEqual(bonus.totalFor(c, data, 'speed.land'), 20);
  c.gear = [{ item: heavyKey, equipped: true }];
  assert.strictEqual(bonus.totalFor(c, data, 'speed.land'), 0);
});

test('theme features gate by level', () => {
  const themeKey = Object.keys(data.themes).find((k) => data.themes[k].features.some((f) => (data.features[f].level || 1) === 6));
  const c = levelled('soldier', 5);
  c.theme = themeKey;
  const names = (ch) => bonus.collectModifiers(ch, data).constants.map((m) => m.sourceKey);
  const at6 = data.themes[themeKey].features.filter((f) => data.features[f].level === 6);
  const c6 = levelled('soldier', 6);
  c6.theme = themeKey;
  const withMods = at6.filter((f) => (data.features[f].modifiers || []).some((m) => m.modifierType === 'constant'));
  withMods.forEach((f) => {
    assert.ok(!names(c).includes(f), 'not at 5: ' + f);
    assert.ok(names(c6).includes(f), 'at 6: ' + f);
  });
});

test('race core traits apply and alt traits do not', () => {
  const race = Object.entries(data.races).find(([, r]) => r.coreTraits.some((t) => (data.features[t].modifiers || []).some((m) => m.modifierType === 'constant')));
  const c = clone(vesk);
  c.race = race[0];
  const keys = bonus.collectModifiers(c, data).constants.map((m) => m.sourceKey);
  race[1].coreTraits.forEach((t) => {
    if ((data.features[t].modifiers || []).some((m) => m.modifierType === 'constant')) assert.ok(keys.includes(t), t);
  });
  race[1].altTraits.forEach((t) => assert.ok(!keys.includes(t), t));
});

test('effect overrides are applied by slug, and none means nothing', () => {
  const c = levelled('soldier', 1);
  c.levels[0].feats = ['disease_adaptation', 'mounted_expert'];
  const out = bonus.collectModifiers(c, data);
  assert.ok(out.situational.some((m) => m.sourceKey === 'disease_adaptation'));
  assert.ok(!out.constants.some((m) => m.sourceKey === 'mounted_expert'));
});

test('feature override keys: feature:<slug> on a feat collision, class- prefix kept', () => {
  assert.deepStrictEqual(bonus.overrideKeys('toughness', 'feat', data), ['toughness']);
  assert.deepStrictEqual(bonus.overrideKeys('spell_focus', 'feature', data), ['feature:spell_focus']);
  assert.deepStrictEqual(bonus.overrideKeys('class-commander', 'feature', data), ['feature:class-commander', 'class-commander']);
  assert.deepStrictEqual(bonus.overrideKeys('adamant_mage', 'feature', data), ['feature:adamant_mage', 'adamant_mage']);
});

test('chosen class features accept slugs and arrays, and automatic features come from progressions', () => {
  const c = levelled('operative', 1);
  c.levels[0].choices = { exploit: ['quick_movement_(ex)'] };
  assert.ok(bonus.collectModifiers(c, data).constants.some((m) => m.sourceKey === 'quick_movement_(ex)'));
  const fake = Object.assign({}, data, { progressions: { operative: { features: { 1: ['quick_movement_(ex)'] } } } });
  const d = levelled('operative', 1);
  assert.ok(bonus.collectModifiers(d, fake).constants.some((m) => m.sourceKey === 'quick_movement_(ex)'));
});

test('equipped gear, slotted upgrades and fusions contribute; unequipped gear does not', () => {
  const key = Object.keys(data.items).find((k) => (data.items[k].modifiers || []).some((m) => m.modifierType === 'constant' && !m.when));
  const c = clone(vesk);
  c.gear = [{ item: key, equipped: false }];
  assert.ok(!bonus.collectModifiers(c, data).constants.some((m) => m.sourceKey === key));
  c.gear = [{ item: key, equipped: true }];
  assert.ok(bonus.collectModifiers(c, data).constants.some((m) => m.sourceKey === key));
  c.gear = [{ item: 'does_not_exist', equipped: true, slots: [{ item: key }] }];
  assert.ok(bonus.collectModifiers(c, data).constants.some((m) => m.sourceKey === key));
  c.gear = [{ item: 'does_not_exist', equipped: true, fusions: [key] }];
  assert.ok(bonus.collectModifiers(c, data).constants.some((m) => m.sourceKey === key));
});

test('missing records and malformed characters do not crash', () => {
  const c = clone(vesk);
  c.race = 'gone'; c.theme = 'gone'; c.levels[0].feats = ['gone'];
  c.levels[0].choices = { x: 'gone', y: ['gone', 'also_gone'] };
  assert.doesNotThrow(() => bonus.collectModifiers(c, data));
  assert.doesNotThrow(() => bonus.collectModifiers({}, data));
});

test('sweep: every constant modifier in the data evaluates and maps to a target', () => {
  const char = levelled('operative', 10);
  const ctx = formulaCtx(char, data, { speedLand: 30, speedBase: 30 });
  let count = 0;
  const check = (m, where) => {
    if (m.modifierType !== 'constant') return;
    count++;
    const v = evalFormula(m.modifier, ctx);
    assert.ok(Number.isFinite(v), where + ' ' + m.modifier);
    bonus.target(m, true);
    if (m.when) bonus.whenHolds(m.when, { armorType: null, encumbered: false });
  };
  ['races', 'feats', 'features', 'items'].forEach((table) => {
    Object.keys(data[table]).forEach((k) => (data[table][k].modifiers || []).forEach((m) => check(m, table + ':' + k)));
  });
  Object.keys(data.overrides.effects).forEach((k) => {
    const v = data.overrides.effects[k];
    if (v !== 'none') v.forEach((m) => check(m, 'override:' + k));
  });
  assert.ok(count > 250, 'swept ' + count);
});
