const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const scripts = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .split('\n')
  .map((line) => /<script src="([^"]+)"><\/script>/.exec(line))
  .filter(Boolean)
  .map((m) => m[1]);

const win = {};
win.window = win;
const ctx = vm.createContext(win);
scripts.forEach((src) => vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), ctx, { filename: src }));
const H = win.SFCHAR;
const U = win.SFUI;
const data = win.SFDATA;

const clone = (o) => JSON.parse(JSON.stringify(o));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));

function memoryStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, dump: m };
}

function throwingStorage() {
  const boom = () => { throw new Error('denied'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

function withStorage(storage, fn) {
  const had = Object.prototype.hasOwnProperty.call(win, 'localStorage');
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true, writable: true });
  try { return fn(); } finally { if (had) win.localStorage = undefined; else delete win.localStorage; }
}

function fullChar() {
  const c = fixture('vesk-soldier-1.json');
  c.name = 'Rax';
  c.notes = 'hello';
  c.gear = [{ id: 'g1', item: 'second_skin', qty: 1, equipped: true }];
  c.levels[0] = { class: 'soldier', increases: [], skills: { ath: 1 }, feats: ['blind-fight_(combat)'], choices: { fightingStyle: 'sharpshoot' }, spells: {} };
  return c;
}

test('hook exposes the documented members', () => {
  ['load', 'save', 'statusLine', 'tabPrint', 'tabIO'].forEach((k) => assert.strictEqual(typeof H[k], 'function', k));
  assert.strictEqual(typeof H.actions, 'object');
  assert.strictEqual(win.SFUI.tabPrint, U.tabPrint);
});

test('defaultChar matches the blank character the UI uses', () => {
  assert.deepStrictEqual(clone(H.defaultChar()), clone(U.blank()));
  assert.strictEqual(H.defaultChar().v, 1);
});

test('export then import round-trips every field', () => {
  const c = fullChar();
  const text1 = H.exportJSON(c);
  assert.ok(text1.indexOf('\n') !== -1);
  assert.deepStrictEqual(clone(H.importJSON(text1)), c);
});

test('import rejects foreign, truncated and malformed files with ImportError', () => {
  const bad = ['{"v":3,"name":"x"}', '{', '[]', 'null', '"x"', '{"levels":[]}', '{"v":"1","levels":[]}', '{"v":2,"levels":[]}', '{"v":1}', '{"v":1,"levels":{}}', '{"v":1,"levels":[1]}'];
  bad.forEach((t) => {
    assert.throws(() => H.importJSON(t), (e) => e instanceof H.ImportError && e.message.length > 5, t);
  });
});

test('import messages say what is wrong', () => {
  assert.throws(() => H.migrate({ v: 1, name: 'x' }), /levels/);
  assert.throws(() => H.migrate({ v: 3, name: 'x' }), /version 3/);
  assert.throws(() => H.migrate({ levels: [] }), /version/);
  assert.throws(() => H.migrate(5), /character/);
});

test('migrate fills missing optional fields and does not mutate its input', () => {
  const raw = { v: 1, levels: [] };
  const c = H.migrate(raw);
  assert.deepStrictEqual(clone(c), clone(H.defaultChar()));
  assert.deepStrictEqual(raw, { v: 1, levels: [] });
});

test('a character with an unknown feat slug loads and validate reports it missing', () => {
  const c = fullChar();
  c.levels[0].feats = ['not_a_feat'];
  const loaded = H.importJSON(JSON.stringify(c));
  U.setCharacter(loaded);
  const blockers = win.SF.validate(win.C, data);
  assert.ok(blockers.some((b) => b.code === 'missing' && /not_a_feat/.test(b.msg + b.ref)), JSON.stringify(blockers));
});

test('saveLocal with throwing storage returns false and does not throw', () => {
  withStorage(throwingStorage(), () => {
    assert.strictEqual(H.saveLocal(fullChar()), false);
    assert.strictEqual(H.loadLocal(), null);
  });
  assert.strictEqual(H.saveLocal(fullChar()), false);
});

test('saveLocal and loadLocal round-trip through sfbuilder.v1', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    assert.strictEqual(H.loadLocal(), null);
    assert.strictEqual(H.saveLocal(fullChar()), true);
    assert.ok(s.dump['sfbuilder.v1']);
    assert.deepStrictEqual(clone(H.loadLocal()), fullChar());
    assert.deepStrictEqual(clone(H.load()), fullChar());
  });
});

test('loadLocal ignores a corrupt or foreign save', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    s.setItem('sfbuilder.v1', '{');
    assert.strictEqual(H.loadLocal(), null);
    s.setItem('sfbuilder.v1', '{"v":3,"name":"x"}');
    assert.strictEqual(H.loadLocal(), null);
  });
});

test('statusLine warns exactly when storage is unavailable', () => {
  const c = fullChar();
  withStorage(throwingStorage(), () => {
    assert.ok(text(H.statusLine(c, U.blankUI(), data)).indexOf('Not saving: export to keep your work') !== -1);
    assert.ok(text(U.renderTop(c, U.blankUI(), data)).indexOf('Not saving: export to keep your work') !== -1);
  });
  withStorage(memoryStorage(), () => {
    assert.strictEqual(text(H.statusLine(c, U.blankUI(), data)).indexOf('Not saving'), -1);
  });
});

test('exportName sanitises the character name', () => {
  assert.strictEqual(H.exportName({ name: '' }), 'character-sf.json');
  assert.strictEqual(H.exportName({}), 'character-sf.json');
  assert.strictEqual(H.exportName({ name: 'Rax the Bold' }), 'Rax-the-Bold-sf.json');
  assert.strictEqual(H.exportName({ name: '../a/b:c*?"<>|' }), 'abc-sf.json');
  assert.strictEqual(H.exportName({ name: '///' }), 'character-sf.json');
});

test('tabPrint for the vesk soldier carries the derived numbers', () => {
  const c = fixture('vesk-soldier-1.json');
  c.gear = [{ id: 'g1', item: 'second_skin', qty: 1, equipped: true }];
  const ctxo = U.ctxOf(c, data);
  const html = H.tabPrint(c, U.blankUI(), data, ctxo);
  const t = text(html);
  assert.ok(html.indexOf('pp-page') !== -1);
  [['SP', 8], ['HP', 13], ['EAC', 14], ['KAC', 15], ['CMD', 23]].forEach(([k, v]) => {
    assert.ok(new RegExp('\\b' + k + '\\s+' + v + '\\b').test(t), k + ' ' + v + ' in: ' + t.slice(0, 400));
  });
  assert.ok(html.indexOf('window.print') === -1 && html.indexOf('data-act="print"') !== -1);
});

test('tabPrint shows trained-only skills with no ranks as a dash and untrained ones as numbers', () => {
  const c = fixture('vesk-soldier-1.json');
  const html = H.tabPrint(c, U.blankUI(), data, U.ctxOf(c, data));
  const row = (name) => html.split('pp-sk').find((r) => r.indexOf('>' + name + '<') !== -1);
  assert.ok(/—/.test(row('Culture')));
  assert.ok(!/—/.test(row('Athletics')));
});

test('tabPrint escapes names, notes-free fields and unknown slugs', () => {
  const c = fullChar();
  c.name = '<img src=x onerror=alert(1)>';
  c.levels[0].feats = ['<b>nope</b>'];
  c.gear = [{ id: 'g1', item: '<script>x</script>', qty: 1, equipped: false }];
  const html = H.tabPrint(c, U.blankUI(), data, U.ctxOf(c, data));
  assert.ok(html.indexOf('<img') === -1 && html.indexOf('<script>') === -1 && html.indexOf('<b>nope') === -1);
});

test('tabPrint adds pages for feats, class features and gear', () => {
  const c = fullChar();
  const html = H.tabPrint(c, U.blankUI(), data, U.ctxOf(c, data));
  assert.ok(html.split('class="pp-page').length - 1 >= 2);
  assert.ok(text(html).indexOf('Blind-Fight') !== -1);
  assert.ok(text(html).indexOf('Fighting Style') !== -1);
});

test('tabIO has export and import controls', () => {
  const html = H.tabIO(fullChar(), U.blankUI(), data, U.ctxOf(fullChar(), data));
  assert.ok(html.indexOf('data-act="exportFile"') !== -1);
  assert.ok(html.indexOf('type="file"') !== -1);
});

test('applyImport replaces the character on success and leaves it untouched on error', () => {
  const good = fullChar();
  const toasts = [];
  H.applyImport(JSON.stringify(good), (m) => toasts.push(m));
  assert.deepStrictEqual(clone(win.C), good);
  assert.strictEqual(toasts.length, 0);
  const before = clone(win.C);
  H.applyImport('{"v":1,"name":"x"}', (m) => toasts.push(m));
  assert.strictEqual(toasts.length, 1);
  assert.ok(/levels/.test(toasts[0]));
  assert.deepStrictEqual(clone(win.C), before);
});
