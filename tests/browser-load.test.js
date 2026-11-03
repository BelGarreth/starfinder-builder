const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const NOT_YET_CREATED = ['js/character.js'];
const listed = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .split('\n')
  .map((line) => /<script src="([^"]+)"><\/script>/.exec(line))
  .filter(Boolean)
  .map((m) => m[1]);
const scripts = listed.filter((src) => fs.existsSync(path.join(root, src)));

test('every script listed in index.html exists, apart from the not-yet-created allowlist', () => {
  const missing = listed.filter((src) => !fs.existsSync(path.join(root, src)));
  assert.deepStrictEqual(missing.filter((src) => NOT_YET_CREATED.indexOf(src) === -1), []);
});

test('every script loads in index.html order with no require or module', () => {
  const win = {};
  win.window = win;
  const ctx = vm.createContext(win);
  scripts.forEach((src) => vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), ctx, { filename: src }));
  const vesk = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vesk-soldier-1.json'), 'utf8'));
  vesk.gear = [{ item: 'second_skin', equipped: true }];
  const sheet = win.SF.derive(vesk, win.SFDATA);
  assert.strictEqual(sheet.eac, 14);
  assert.strictEqual(sheet.kac, 15);
  assert.ok(Array.isArray(win.SF.validate(vesk, win.SFDATA)));
  assert.strictEqual(typeof win.SFUI.view, 'function');
});
