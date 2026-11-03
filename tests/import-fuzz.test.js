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
const SF = win.SF;
const data = win.SFDATA;

const XSS = '<img src=x onerror=alert(1)>';
const clone = (o) => JSON.parse(JSON.stringify(o));
const L = (o) => Object.assign({ class: 'mystic', increases: [], skills: {}, feats: [], choices: {}, spells: {} }, o);
const sk = { med: 1, mys: 1, per: 1, dip: 1, sen: 1, lsc: 1, cul: 1 };

function base() {
  return {
    v: 1, name: 'Fuzz', race: 'half-orc', variant: null, theme: 'themeless', proAbility: 'wis',
    abilities: { pb: { str: 0, dex: 2, con: 0, int: 0, wis: 8, cha: 0 }, raceAny: 'wis', themeAny: 'dex' },
    levels: [
      L({ skills: sk, feats: ['spell_focus'], choices: { connection: 'healer', student: ['dip', 'sen'] }, spells: { learn: ['detect_magic'] } }),
      L({ skills: sk }), L({ skills: sk, feats: ['toughness'] }), L({ skills: sk }),
      L({ skills: sk, increases: ['wis', 'dex', 'con', 'cha'] })
    ],
    gear: [
      { id: 'g1', item: 'second_skin', qty: 1, equipped: true, slots: [{ item: 'second_skin' }] },
      { id: 'g2', item: 'semi-auto_pistol_tactical', qty: 1, equipped: true, fusions: [{ item: 'semi-auto_pistol_tactical', level: 1 }] }
    ],
    notes: ''
  };
}

const NUMERIC = [
  ['abilities', 'pb', 'str'], ['abilities', 'pb', 'wis'], ['abilities', 'raceAny'], ['abilities', 'themeAny'], ['proAbility'],
  ['levels', 0, 'skills', 'med'], ['levels', 4, 'increases', 0], ['levels', 4, 'increases'],
  ['gear', 0, 'qty'], ['gear', 1, 'fusions', 0, 'level'], ['gear', 0, 'equipped'], ['gear', 0, 'id']
];
const VALUES = ['5', XSS, {}, [], null, true, 'abc', [XSS], { x: XSS }];

function setPath(o, p, v) {
  let cur = o;
  p.slice(0, -1).forEach((k) => { cur = cur[k]; });
  cur[p[p.length - 1]] = v;
  return o;
}

function renderAll(c) {
  U.normalize(c, data);
  const out = [];
  U.TABS.forEach(([tab]) => [0, 2, 4].forEach((lvl) => {
    const v = U.view(c, Object.assign(U.blankUI(), { tab, lvl }), data);
    out.push(v.top + v.tabs + v.blockers + v.main);
  }));
  return out.join('\n');
}

function assertSaneSheet(c, label) {
  const s = SF.derive(c, data);
  SF.ABILITIES.forEach((a) => {
    assert.strictEqual(typeof s.abilities[a].score, 'number', label + ' ' + a);
    assert.ok(Number.isInteger(s.abilities[a].score) && s.abilities[a].score < 40, label + ' ' + a + '=' + s.abilities[a].score);
  });
  ['hp', 'sp', 'rp', 'eac', 'kac', 'fort', 'ref', 'will', 'initiative'].forEach((k) => assert.ok(Number.isFinite(s[k]), label + ' ' + k + '=' + s[k]));
  Object.keys(s.skills).forEach((k) => assert.ok(Number.isFinite(s.skills[k].total), label + ' skill ' + k));
  assert.ok(Number.isFinite(s.bulk.carried) && Number.isFinite(s.bulk.limit), label + ' bulk');
}

test('the untouched fuzz base renders every tab', () => {
  const c = H.importJSON(JSON.stringify(base()));
  assert.strictEqual(renderAll(c).indexOf('<img'), -1);
  assertSaneSheet(c, 'base');
});

test('hostile values in every numeric field never reach the page unescaped or break the scores', () => {
  NUMERIC.forEach((p) => VALUES.forEach((v) => {
    const label = p.join('.') + '=' + JSON.stringify(v);
    const c = H.importJSON(JSON.stringify(setPath(base(), p, v)));
    const html = renderAll(c);
    assert.strictEqual(html.indexOf('<img'), -1, label);
    assert.ok(!/NaN/.test(html), label + ' NaN in page');
    assertSaneSheet(c, label);
  }));
});

test('a numeric-string point buy is read as a number, not concatenated', () => {
  const raw = base();
  raw.abilities.pb.str = '5';
  const c = H.importJSON(JSON.stringify(raw));
  assert.strictEqual(c.abilities.pb.str, 5);
  assert.strictEqual(SF.derive(c, data).abilities.str.score, 15);
  const engineOnly = clone(raw);
  assert.strictEqual(SF.baseScores(engineOnly, data).str, 15);
});

test('hostile strings in name, slugs and notes stay escaped on every tab', () => {
  const raw = base();
  raw.name = XSS;
  raw.notes = XSS;
  raw.levels[0].feats.push(XSS);
  raw.levels[0].choices[XSS] = XSS;
  raw.levels[0].spells.learn.push(XSS);
  raw.gear.push({ id: XSS, item: XSS, qty: 1, equipped: true, slots: [{ item: XSS }], fusions: [XSS] });
  assert.strictEqual(renderAll(H.importJSON(JSON.stringify(raw))).indexOf('<img'), -1);
});

const SHAPES = {
  'gear:[null]': (c) => { c.gear = [null, 5, 'x', [], { qty: 1 }, { item: 7 }]; },
  'race:__proto__': (c) => { c.race = '__proto__'; },
  'theme:constructor': (c) => { c.theme = 'constructor'; },
  'class:__proto__': (c) => { c.levels[0].class = '__proto__'; },
  'class:toString': (c) => { c.levels[1].class = 'toString'; },
  'feats:prototype names': (c) => { c.levels[0].feats = ['constructor', 'toString', '__proto__']; },
  'choices:null': (c) => { c.levels[0].choices = null; },
  'choices:array': (c) => { c.levels[0].choices = ['healer']; },
  'choices:proto values': (c) => { c.levels[0].choices = JSON.parse('{"__proto__":{"x":1},"connection":"hasOwnProperty","student":[null,{}]}'); },
  'skills:proto': (c) => { c.levels[0].skills = JSON.parse('{"__proto__":3,"constructor":2,"toString":"x"}'); },
  'skills:string': (c) => { c.levels[0].skills = 'abc'; },
  'feats:string': (c) => { c.levels[0].feats = 'toughness'; },
  'spells:junk': (c) => { c.levels[0].spells = { learn: [null, 3, 'constructor'], swap: { from: 'constructor', to: null } }; },
  'gear item names': (c) => { c.gear = [{ item: '__proto__' }, { item: 'constructor', slots: [null, 'toString'], fusions: [null, { item: 'valueOf', seal: 'yes' }] }]; },
  'abilities:null': (c) => { c.abilities = null; },
  'abilities.pb:array': (c) => { c.abilities = { pb: [1, 2, 3] }; },
  'levels:40': (c) => { c.levels = Array.from({ length: 40 }, () => L({})); },
  'levels:empty objects': (c) => { c.levels = [{}, { class: null }]; }
};

test('malformed shapes import into a character every tab can render', () => {
  Object.keys(SHAPES).forEach((name) => {
    const raw = base();
    SHAPES[name](raw);
    const c = H.importJSON(JSON.stringify(raw));
    assert.doesNotThrow(() => renderAll(c), name);
    assert.doesNotThrow(() => SF.validate(c, data), name);
    assert.ok(c.gear.every((g) => g && typeof g.item === 'string'), name);
  });
});

test('malformed imports through applyImport never leave a broken character behind', () => {
  const good = H.importJSON(JSON.stringify(base()));
  U.setCharacter(good);
  Object.keys(SHAPES).forEach((name) => {
    const raw = base();
    SHAPES[name](raw);
    H.applyImport(JSON.stringify(raw), () => {});
    assert.doesNotThrow(() => renderAll(clone(win.C)), name);
  });
  H.applyImport('{"v":1,"levels":[1]}', () => {});
  assert.doesNotThrow(() => renderAll(clone(win.C)));
});

test('applyImport restores the previous character and reports when the import cannot render', () => {
  const good = H.importJSON(JSON.stringify(base()));
  U.setCharacter(good);
  const before = clone(win.C);
  const view = U.view;
  const toasts = [];
  U.view = (c, ui, d) => { if (c.name === 'Boom') throw new TypeError('boom'); return view(c, ui, d); };
  try {
    const raw = base();
    raw.name = 'Boom';
    assert.strictEqual(H.applyImport(JSON.stringify(raw), (m) => toasts.push(m)), false);
  } finally { U.view = view; }
  assert.deepStrictEqual(clone(win.C), before);
  assert.strictEqual(toasts.length, 1);
  assert.ok(/not changed/.test(toasts[0]), toasts[0]);
});
