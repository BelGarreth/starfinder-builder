const test = require('node:test');
const assert = require('node:assert');

const data = require('../data/index.js');

test('data/index.js exposes the SFDATA shape', () => {
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

test('every data part stays under 3,000,000 bytes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const name of ['core.js', 'spells.js', 'items.js']) {
    assert.ok(fs.statSync(path.join(__dirname, '..', 'data', name)).size < 3000000, name);
  }
});

test('meta lives in core and the browser wrapper merges parts', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const sandbox = {};
  vm.createContext(sandbox);
  for (const name of ['core.js', 'spells.js', 'items.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8'), sandbox);
  }
  assert.ok(sandbox.SFDATA.meta.foundrySha);
  assert.ok(Object.keys(sandbox.SFDATA.spells).length > 0);
  assert.ok(Object.keys(sandbox.SFDATA.items).length > 0);
});
