const test = require('node:test');
const assert = require('node:assert');

const data = require('../data.js');

test('data.js exposes the SFDATA shape', () => {
  for (const key of ['meta', 'races', 'themes', 'classes', 'feats', 'features', 'spells', 'items', 'progressions', 'overrides']) {
    assert.ok(key in data, key);
  }
  assert.match(data.meta.foundrySha, /^[0-9a-f]{40}$/);
  assert.deepStrictEqual(Object.keys(data.overrides), ['effects']);
});

test('known records are present', () => {
  assert.deepStrictEqual(data.races.vesk.abilityMods, [[2, 'str'], [2, 'con'], [-2, 'int']]);
  assert.strictEqual(data.classes.envoy_enhanced.enhancedOf, 'envoy');
  assert.strictEqual(Object.keys(data.themes).length, 60);
  assert.strictEqual(data.items.baton_tactical.price, 90);
  assert.strictEqual(data.feats._folders, undefined);
});
