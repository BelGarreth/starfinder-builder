const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .split('\n')
  .map((line) => /<script src="(js\/[^/"]+\.js)"><\/script>/.exec(line))
  .filter(Boolean)
  .map((m) => m[1])
  .filter((src) => /root\.SF = Object\.assign/.test(fs.readFileSync(path.join(root, src), 'utf8')));

test('no two engine files export the same name', () => {
  assert.ok(engine.length >= 6, engine.join(', '));
  const owners = {};
  engine.forEach((src) => Object.keys(require(path.join(root, src))).forEach((k) => { (owners[k] = owners[k] || []).push(src); }));
  const clashes = Object.keys(owners).filter((k) => owners[k].length > 1).map((k) => k + ': ' + owners[k].join(', '));
  assert.deepStrictEqual(clashes, []);
});
