const test = require('node:test');
const assert = require('node:assert');
const rules = require('../js/rules.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');
const multi = require('./fixtures/multiclass-soldier2-operative1.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const level = (cls, extra) => Object.assign({ class: cls, skills: {}, feats: [], choices: {}, spells: {} }, extra);

test('mod floors toward negative infinity', () => {
  assert.strictEqual(rules.mod(18), 4);
  assert.strictEqual(rules.mod(13), 1);
  assert.strictEqual(rules.mod(8), -1);
  assert.strictEqual(rules.mod(9), -1);
  assert.strictEqual(rules.mod(10), 0);
});

test('vesk soldier 1 base scores and derived stats', () => {
  assert.deepStrictEqual(rules.baseScores(vesk, data), { str: 18, dex: 14, con: 13, int: 8, wis: 10, cha: 10 });
  assert.strictEqual(rules.charLevel(vesk), 1);
  assert.deepStrictEqual(rules.classLevels(vesk), { soldier: 1 });
  assert.strictEqual(rules.hp(vesk, data), 13);
  assert.strictEqual(rules.sp(vesk, data), 8);
  assert.strictEqual(rules.rp(vesk, data), 5);
  assert.strictEqual(rules.bab(vesk, data), 1);
  assert.deepStrictEqual(['fort', 'ref', 'will'].map((k) => rules.baseSave(k, vesk, data)), [2, 0, 2]);
  assert.strictEqual(rules.rankBudget(0, vesk, data), 3);
  assert.strictEqual(rules.featSlots(vesk, data).length, 1);
  assert.deepStrictEqual(rules.pointBuyErrors(vesk, data), []);
});

test('multiclass soldier 2 / operative 1 sums per class', () => {
  assert.deepStrictEqual(rules.baseScores(multi, data), { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 });
  assert.deepStrictEqual(rules.classLevels(multi), { soldier: 2, operative: 1 });
  assert.strictEqual(rules.bab(multi, data), 2);
  assert.strictEqual(rules.baseSave('fort', multi, data), 3);
  assert.strictEqual(rules.baseSave('ref', multi, data), 2);
  assert.strictEqual(rules.baseSave('will', multi, data), 5);
  assert.strictEqual(rules.hp(multi, data), 4 + 7 * 2 + 6);
  assert.strictEqual(rules.rp(multi, data), 1 + 1);
});

test('rp takes the highest key ability modifier across classes', () => {
  assert.strictEqual(rules.rp(multi, data), 2);
  const c = clone(multi);
  c.abilities.pb.str = 8;
  assert.strictEqual(rules.rp(c, data), 1 + rules.mod(18));
});

test('human gets a bonus feat and an extra rank per level', () => {
  assert.strictEqual(rules.rankBudget(0, multi, data), 4 + 0 + 1);
  assert.strictEqual(rules.rankBudget(2, multi, data), 8 + 0 + 1);
  const slots = rules.featSlots(multi, data);
  assert.deepStrictEqual(slots.map((s) => [s.level, s.kind]), [[1, 'general'], [1, 'bonus'], [2, 'bonus'], [3, 'general']]);
  assert.ok(slots.every((s) => typeof s.source === 'string'));
});

test('rank budget never drops below one before the human bonus', () => {
  const c = clone(vesk);
  c.abilities.pb.int = 0;
  c.race = 'vesk';
  c.levels = [level('mystic')];
  assert.strictEqual(rules.rankBudget(0, c, data), Math.max(1, data.classes.mystic.ranks + -1));
  const low = clone(vesk);
  low.levels = [level('soldier')];
  const orig = data.classes.soldier.ranks;
  const patched = Object.assign({}, data, { classes: Object.assign({}, data.classes, { soldier: Object.assign({}, data.classes.soldier, { ranks: 0 }) }) });
  assert.strictEqual(rules.rankBudget(0, low, patched), 1);
  assert.strictEqual(data.classes.soldier.ranks, orig);
});

test('ability increases at 5/10/15/20 give +2, or +1 at 17 or higher', () => {
  const c = clone(vesk);
  c.levels = [level('soldier'), level('soldier'), level('soldier'), level('soldier'), level('soldier', { increases: ['str', 'dex', 'con', 'wis'] })];
  assert.deepStrictEqual(rules.baseScores(c, data), { str: 19, dex: 16, con: 15, int: 8, wis: 12, cha: 10 });
  assert.deepStrictEqual(rules.baseScores(c, data, 4), rules.baseScores(vesk, data));
});

test('rank budget at a level uses Int as it stood at that level', () => {
  const c = clone(vesk);
  c.abilities.pb = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  c.abilities.themeAny = null;
  c.theme = 'biotechnician';
  c.levels = [level('soldier'), level('soldier'), level('soldier'), level('soldier'), level('soldier', { increases: ['int', 'str', 'dex', 'con'] }), level('soldier')];
  const before = rules.rankBudget(3, c, data);
  const after = rules.rankBudget(5, c, data);
  assert.strictEqual(after - before, rules.mod(rules.baseScores(c, data).int) - rules.mod(rules.baseScores(c, data, 4).int));
});

test('point buy errors', () => {
  assert.deepStrictEqual(rules.POINT_BUY, { base: 10, points: 10, maxAtCreation: 18 });
  const over = clone(vesk);
  over.abilities.pb.wis = 1;
  assert.ok(rules.pointBuyErrors(over, data).length > 0);
  const high = clone(vesk);
  high.abilities.pb = { str: 6, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  assert.ok(rules.pointBuyErrors(high, data).some((e) => /str/i.test(e)));
  const negative = clone(vesk);
  negative.abilities.pb.cha = -1;
  assert.ok(rules.pointBuyErrors(negative, data).length > 0);
});

test('race any pick and theme any pick are applied', () => {
  const c = clone(multi);
  c.theme = 'themeless';
  c.abilities.themeAny = 'wis';
  assert.strictEqual(rules.baseScores(c, data).wis, 11);
  c.abilities.themeAny = null;
  assert.strictEqual(rules.baseScores(c, data).wis, 10);
});

test('unknown class or race in a save does not throw', () => {
  const c = clone(vesk);
  c.race = 'gone';
  c.theme = 'gone';
  c.levels = [level('gone')];
  assert.doesNotThrow(() => {
    rules.baseScores(c, data); rules.bab(c, data); rules.baseSave('fort', c, data);
    rules.hp(c, data); rules.sp(c, data); rules.rp(c, data); rules.featSlots(c, data); rules.rankBudget(0, c, data);
  });
});

test('progression bonus feat entries become pooled slots at the class level that grants them', () => {
  const fake = Object.assign({}, data, { progressions: { soldier: { levels: { 1: [{ bonusFeat: true }], 2: [{ bonusFeat: true, pool: 'combat' }] } } } });
  const slots = rules.featSlots(vesk, fake);
  assert.deepStrictEqual(slots.map((s) => [s.level, s.kind, s.pool || null]), [[1, 'general', null], [1, 'bonus', null]]);
});
