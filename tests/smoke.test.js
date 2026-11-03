const test = require('node:test');
const assert = require('node:assert');

test('rules module loads', () => {
  const rules = require('../js/rules.js');
  assert.strictEqual(rules.version, 1);
});
