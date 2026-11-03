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
  return {
    getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, dump: m,
    get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i] || null
  };
}

function throwingStorage() {
  const boom = () => { throw new Error('denied'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

function withStorage(storage, fn) {
  const had = Object.prototype.hasOwnProperty.call(win, 'localStorage');
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true, writable: true });
  H.probeStorage();
  try { return fn(); } finally { if (had) win.localStorage = undefined; else delete win.localStorage; H.probeStorage(); }
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

test('storage availability is probed once, not on every render', () => {
  const s = memoryStorage();
  let writes = 0;
  const counting = Object.assign({}, s, { setItem: (k, v) => { writes++; s.setItem(k, v); } });
  withStorage(counting, () => {
    const before = writes;
    for (let i = 0; i < 5; i++) H.statusLine(fullChar(), U.blankUI(), data);
    assert.strictEqual(writes, before);
  });
});

test('statusLine flips to the warning when a save fails', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    H.loadLocal();
    assert.strictEqual(text(H.statusLine({}, U.blankUI(), data)), '');
    const real = s.setItem;
    s.setItem = () => { throw new Error('quota'); };
    assert.strictEqual(H.saveLocal(fullChar()), false);
    s.setItem = real;
    assert.ok(text(H.statusLine({}, U.blankUI(), data)).indexOf('Not saving: export to keep your work') !== -1);
  });
});

['{', '{"v":3,"name":"x"}', '{"v":9,"levels":[]}'].forEach((blob) => {
  test('an unreadable saved blob is backed up, flagged, and recoverable: ' + blob, () => {
    const s = memoryStorage();
    withStorage(s, () => {
      s.setItem('sfbuilder.v1', blob);
      assert.strictEqual(H.load(), null);
      const keys = Object.keys(s.dump).filter((k) => k.indexOf('sfbuilder.v1.backup-') === 0);
      assert.strictEqual(keys.length, 1);
      assert.strictEqual(s.dump[keys[0]], blob);
      assert.strictEqual(H.saveLocal(fullChar()), true);
      assert.strictEqual(s.dump[keys[0]], blob);
      const html = H.statusLine({}, U.blankUI(), data);
      assert.ok(text(html).indexOf('Your saved character could not be read. A copy was kept.') !== -1);
      assert.ok(html.indexOf('data-act="downloadRaw"') !== -1);
      assert.strictEqual(H.recoveredBackup().text, blob);
      const got = [];
      const doc = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
      win.document = doc;
      win.Blob = function (parts, o) { got.push(parts.join(''), o.type); };
      win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
      win.setTimeout = () => 0;
      try { H.actions.downloadRaw(); } finally { delete win.setTimeout; delete win.document; delete win.Blob; delete win.URL; }
      assert.deepStrictEqual(got, [blob, 'text/plain']);
    });
  });
});

test('a readable save raises no recovery notice', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    H.saveLocal(fullChar());
    H.load();
    assert.strictEqual(H.recoveredBackup(), null);
    assert.strictEqual(text(H.statusLine({}, U.blankUI(), data)), '');
  });
});

test('tabPrint shows param and choice picks next to their feats and features', () => {
  const c = fixture('vesk-soldier-1.json');
  c.levels[0] = { class: 'soldier', increases: [], skills: {}, feats: ['skill_focus', 'weapon_focus_(combat)'], choices: { skill_focus: 'per', 'weapon_focus_(combat)': 'smallA', fightingStyle: 'sharpshoot' }, spells: {} };
  const t = text(H.tabPrint(c, U.blankUI(), data, U.ctxOf(c, data)));
  assert.ok(/Skill Focus[^()]*\(Perception\)/.test(t), t);
  assert.ok(/Weapon Focus \(Combat\) \(small arms\)/.test(t), t);
  assert.ok(/Primary fighting style/.test(t) && /Sharpshoot/i.test(t), t);
});

test('tabPrint shows multi-pick feats per instance', () => {
  const c = fixture('vesk-soldier-1.json');
  c.levels[0] = { class: 'soldier', increases: [], skills: {}, feats: ['student'], choices: { student: ['ath', 'acr'] }, spells: {} };
  const t = text(H.tabPrint(c, U.blankUI(), data, U.ctxOf(c, data)));
  assert.ok(/Athletics, Acrobatics/.test(t), t);
});

function downloaded(action) {
  const got = [];
  win.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
  win.Blob = function (parts, o) { got.push(parts.join(''), o.type); };
  win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  win.setTimeout = () => 0;
  try { action(); } finally { delete win.setTimeout; delete win.document; delete win.Blob; delete win.URL; }
  return got;
}

function quotaOnBackup() {
  const s = memoryStorage();
  const real = s.setItem;
  s.setItem = (k, v) => { if (k.indexOf('.backup-') !== -1) throw new Error('quota'); real(k, v); };
  return s;
}

test('when the backup cannot be written, autosave is suppressed and the notice says so', () => {
  const s = quotaOnBackup();
  withStorage(s, () => {
    s.dump['sfbuilder.v1'] = '{corrupt';
    assert.strictEqual(H.load(), null);
    assert.strictEqual(H.saveLocal(fullChar()), false);
    assert.strictEqual(s.dump['sfbuilder.v1'], '{corrupt');
    const html = H.statusLine({}, U.blankUI(), data);
    const t = text(html);
    assert.ok(t.indexOf('could not be read and could not be backed up. Download it before editing.') !== -1, t);
    assert.ok(t.indexOf('A copy was kept') === -1);
    assert.ok(t.indexOf('Not saving') === -1);
    assert.ok(html.indexOf('data-act="downloadRaw"') !== -1 && html.indexOf('data-act="startFresh"') !== -1);
  });
});

test('downloading the raw text releases the autosave block', () => {
  const s = quotaOnBackup();
  withStorage(s, () => {
    s.dump['sfbuilder.v1'] = '{corrupt';
    H.load();
    assert.deepStrictEqual(downloaded(H.actions.downloadRaw), ['{corrupt', 'text/plain']);
    assert.strictEqual(H.saveLocal(fullChar()), true);
  });
});

test('Start fresh and a successful import release the autosave block', () => {
  [() => H.actions.startFresh(), () => H.applyImport(JSON.stringify(fullChar()), () => {})].forEach((release) => {
    const s = quotaOnBackup();
    withStorage(s, () => {
      s.dump['sfbuilder.v1'] = '{corrupt';
      H.load();
      assert.strictEqual(H.saveLocal(fullChar()), false);
      release();
      assert.strictEqual(H.saveLocal(fullChar()), true);
      assert.strictEqual(text(H.statusLine({}, U.blankUI(), data)).indexOf('backed up'), -1);
    });
  });
});

test('a failed import keeps the autosave block', () => {
  const s = quotaOnBackup();
  withStorage(s, () => {
    s.dump['sfbuilder.v1'] = '{corrupt';
    H.load();
    H.applyImport('{', () => {});
    assert.strictEqual(H.saveLocal(fullChar()), false);
  });
});

test('on load an existing backup key is offered for download, newest first', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    H.actions.startFresh();
    s.dump['sfbuilder.v1.backup-100'] = 'older';
    s.dump['sfbuilder.v1.backup-300'] = 'newest';
    s.dump['sfbuilder.v1.backup-200'] = 'middle';
    H.saveLocal(fullChar());
    assert.ok(H.load());
    const html = H.statusLine({}, U.blankUI(), data);
    assert.ok(html.indexOf('data-act="downloadRaw"') !== -1);
    assert.ok(text(html).indexOf('could not be read') === -1);
    assert.deepStrictEqual(downloaded(H.actions.downloadRaw), ['newest', 'text/plain']);
  });
});
