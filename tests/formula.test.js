const test = require('node:test');
const assert = require('node:assert');
const { evalFormula, FormulaError, formulaCtx } = require('../js/formula.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');

const ctx = (level, bab, operative) => ({
  details: { level: { value: level } },
  attributes: { baseAttackBonus: { value: bab } },
  classes: { operative: { levels: operative || 0 } }
});

test('weapon focus ternary', () => {
  assert.strictEqual(evalFormula('ternary(gte((@details.level.value - @attributes.baseAttackBonus.value),3),2,1)', ctx(5, 5)), 1);
  assert.strictEqual(evalFormula('ternary(gte((@details.level.value - @attributes.baseAttackBonus.value),3),2,1)', ctx(9, 5)), 2);
});

test('arithmetic, precedence, unary minus, decimals', () => {
  assert.strictEqual(evalFormula('1 + 2 * 3'), 7);
  assert.strictEqual(evalFormula('(1 + 2) * 3'), 9);
  assert.strictEqual(evalFormula('-(4) + floor(8 * 0.75)'), 2);
  assert.strictEqual(evalFormula('10 / 4'), 2.5);
});

test('class levels and functions', () => {
  assert.strictEqual(evalFormula('floor(@classes.operative.levels/4)+1', ctx(8, 0, 8)), 3);
  assert.strictEqual(evalFormula('ceil(7/2)'), 4);
  assert.strictEqual(evalFormula('max(0, 3 - 5)'), 0);
  assert.strictEqual(evalFormula('min(4, 2, 9)'), 2);
  assert.strictEqual(evalFormula('sign(-7)'), -1);
  assert.deepStrictEqual(['gt(2,1)', 'gte(1,1)', 'lt(1,2)', 'lte(2,1)', 'eq(3,3)'].map((e) => evalFormula(e)), [1, 1, 1, 0, 1]);
});

test('lookupRange picks the highest threshold at or below the value', () => {
  assert.strictEqual(evalFormula('lookupRange(7,0,1,1,5,2,10,3)'), 2);
  assert.strictEqual(evalFormula('lookupRange(0,9,1,1,5,2)'), 9);
  assert.strictEqual(evalFormula('lookupRange(99,0,1,1,5,2,10,3)'), 3);
});

test('missing paths are zero', () => {
  assert.strictEqual(evalFormula('@resources.solarian.attunement.value + 2', {}), 2);
  assert.strictEqual(evalFormula('ternary(@item.properties.operative, 1, 5)', {}), 5);
});

test('unknown syntax throws FormulaError and never evaluates code', () => {
  ['alert(1)', '1 +', '(1', 'constructor', '1 $ 2', 'floor(1,', 'process.exit()', '1 / 0'].forEach((e) => {
    assert.throws(() => evalFormula(e, {}), FormulaError, e);
  });
});

test('formulaCtx for vesk soldier 1', () => {
  const c = formulaCtx(vesk, data, {});
  assert.strictEqual(c.details.level.value, 1);
  assert.strictEqual(c.classes.soldier.levels, 1);
  assert.strictEqual(c.abilities.str.value, 18);
  assert.strictEqual(c.abilities.str.mod, 4);
  assert.strictEqual(c.attributes.baseAttackBonus.value, 1);
  assert.strictEqual(c.attributes.speed.land.value, 30);
  assert.strictEqual(c.attributes.speed.land.base, 30);
  assert.strictEqual(evalFormula('@resources.x.y', c), 0);
});

test('formulaCtx reads speed from derived and ranks from levels', () => {
  const char = JSON.parse(JSON.stringify(vesk));
  char.levels[0].skills = { ath: 1 };
  char.levels.push({ class: 'soldier', skills: { ath: 1, acr: 1 }, feats: [], choices: {}, spells: {} });
  const c = formulaCtx(char, data, { speedLand: 40, speedBase: 35 });
  assert.strictEqual(c.skills.ath.ranks, 2);
  assert.strictEqual(c.attributes.speed.land.value, 40);
  assert.strictEqual(c.attributes.speed.land.base, 35);
});
