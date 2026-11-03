const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const listed = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .split('\n')
  .map((line) => /<script src="([^"]+)"><\/script>/.exec(line))
  .filter(Boolean)
  .map((m) => m[1]);
const scripts = listed;

test('every script listed in index.html exists', () => {
  const missing = listed.filter((src) => !fs.existsSync(path.join(root, src)));
  assert.deepStrictEqual(missing, []);
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

test('the UI starts on a blank character with no persistence hook loaded', () => {
  const win = {};
  win.window = win;
  const ctx = vm.createContext(win);
  scripts.filter((src) => src !== 'js/character.js').forEach((src) => vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), ctx, { filename: src }));
  assert.strictEqual(win.SFCHAR, undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(win.C)), JSON.parse(JSON.stringify(win.SF.blankCharacter())));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(win.SFUI.blank())), JSON.parse(JSON.stringify(win.SF.blankCharacter())));
  const v = win.SFUI.view(win.C, win.SFUI.blankUI(), win.SFDATA);
  assert.ok(v.main.length > 0);
});
