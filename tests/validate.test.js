const test = require('node:test');
const assert = require('node:assert');
const rules = require('../js/rules.js');
const { validate, allowed, hooks } = require('../js/validate.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');
const edit = require('./fixtures/edit-level1-after-5.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const find = (blockers, pred) => blockers.filter((b) => Object.keys(pred).every((k) => b[k] === pred[k]));

function veskInSecondSkin() {
  const c = clone(vesk);
  c.gear = [{ item: 'second_skin', equipped: true }];
  return c;
}

test('vesk soldier 1 in second skin derives its defenses', () => {
  const s = rules.derive(veskInSecondSkin(), data);
  assert.deepStrictEqual([s.eac, s.kac, s.cmd], [14, 15, 23]);
  assert.deepStrictEqual([s.fort, s.ref, s.will, s.initiative], [3, 2, 2, 2]);
  assert.deepStrictEqual(s.attacks.map((a) => a.name), ['Natural weapons (vesk)', 'Unarmed strike']);
  assert.deepStrictEqual(s.bulk, { carried: 0.1, limit: 18, state: 'ok' });
});

test('without armor the armor savant bonus is inactive', () => {
  const s = rules.derive(vesk, data);
  assert.deepStrictEqual([s.eac, s.kac], [12, 12]);
});

test('skills use class skill bonus, theme skill and armor check penalty', () => {
  const c = clone(vesk);
  c.levels[0].skills = { ath: 1, ste: 1 };
  const s = rules.derive(c, data);
  assert.strictEqual(s.skills.ath.total, 1 + 4 + 3 + 1);
  assert.strictEqual(s.skills.ath.classSkill, true);
  assert.strictEqual(s.skills.ste.classSkill, false);
  assert.strictEqual(s.skills.ste.total, 1 + 2);
  assert.strictEqual(s.skills.cul.trainedOnly, true);
  const heavy = clone(c);
  heavy.gear = [{ item: Object.keys(data.items).find((k) => data.items[k].armor && data.items[k].armor.acp === -1 && data.items[k].armor.type === 'heavy'), equipped: true }];
  assert.strictEqual(rules.derive(heavy, data).skills.ath.total, s.skills.ath.total - 1);
});

test('encumbrance feeds from bulk against the strength score', () => {
  const c = clone(vesk);
  c.gear = [{ item: Object.keys(data.items).find((k) => data.items[k].bulk === '10'), equipped: false }];
  assert.strictEqual(rules.derive(c, data).bulk.state, 'encumbered');
  c.gear.push({ item: c.gear[0].item });
  assert.strictEqual(rules.derive(c, data).bulk.state, 'overburdened');
});

test('a coherent level 5 character has no blockers', () => {
  assert.deepStrictEqual(validate(edit, data), []);
});

test('lowering level 1 Dex flags the level 3 feat that needed it', () => {
  const c = clone(edit);
  c.abilities.pb.dex = 2;
  const found = find(validate(c, data), { level: 3, tab: 'feats', code: 'prereq' });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].msg, 'Requires Dex 15');
});

test('lowering Int re-flags overspent ranks at every maxed level', () => {
  const c = clone(edit);
  c.abilities.pb.int = 2;
  const blockers = validate(c, data);
  [1, 2, 3, 4, 5].forEach((n) => assert.strictEqual(find(blockers, { level: n, tab: 'skills', code: 'overspent' }).length, 1));
});

test('allowed uses the same prerequisite text', () => {
  assert.deepStrictEqual(allowed('feat', 'iron_will', 0, edit, data), { ok: true });
  assert.deepStrictEqual(allowed('feat', 'lunge_(combat)', 0, edit, data), { ok: false, why: 'Requires base attack bonus +6' });
  assert.strictEqual(allowed('feat', 'nimble_moves_(combat)', 0, edit, data).ok, true);
  const low = clone(edit);
  low.abilities.pb.dex = 2;
  assert.deepStrictEqual(allowed('feat', 'nimble_moves_(combat)', 2, low, data, 0), { ok: false, why: 'Requires Dex 15' });
});

test('ranks prerequisites read as a list of skills', () => {
  const slug = Object.keys(data.feats).find((k) => data.feats[k].prereq && data.feats[k].prereq.all.some((c) => c.k === 'any' && c.of.every((x) => x.k === 'ranks')));
  const why = allowed('feat', slug, 0, edit, data).why;
  assert.match(why, /^Requires \d+ ranks in [A-Za-z ]+ or [A-Za-z ]+/);
});

test('duplicate feats are blocked unless repeatable', () => {
  const c = clone(edit);
  c.levels[4].feats = ['toughness'];
  assert.strictEqual(find(validate(c, data), { level: 5, tab: 'feats', code: 'duplicate' }).length, 1);
  c.levels[4].feats = ['skill_focus'];
  c.levels[2].feats = ['skill_focus'];
  assert.strictEqual(find(validate(c, data), { code: 'duplicate' }).length, 0);
});

test('feat slots and ranks both flag unspent and overspent', () => {
  const c = clone(edit);
  c.levels[2].feats = [];
  c.levels[0].skills = { ath: 1 };
  const blockers = validate(c, data);
  assert.strictEqual(find(blockers, { level: 3, tab: 'feats', code: 'unspent' }).length, 1);
  assert.strictEqual(find(blockers, { level: 1, tab: 'skills', code: 'unspent' }).length, 1);
  c.levels[2].feats = ['toughness', 'iron_will'];
  assert.strictEqual(find(validate(c, data), { level: 3, tab: 'feats', code: 'overspent' }).length, 1);
});

test('ranks in one skill are capped at character level', () => {
  const c = clone(edit);
  c.levels[0].skills = { ath: 2, acr: 1, eng: 1, med: 1, pil: 1, sur: 1 };
  assert.strictEqual(find(validate(c, data), { level: 1, tab: 'skills', code: 'rank-cap', ref: 'ath' }).length, 1);
});

test('ability increases need four different scores at the right levels', () => {
  const c = clone(edit);
  c.levels[4].increases = ['str', 'str', 'dex', 'con'];
  assert.strictEqual(find(validate(c, data), { level: 5, tab: 'abilities', code: 'increases' }).length, 1);
  c.levels[4].increases = ['str', 'dex', 'con', 'wis'];
  c.levels[3].increases = ['str', 'dex', 'con', 'wis'];
  assert.strictEqual(find(validate(c, data), { level: 4, tab: 'abilities', code: 'increases' }).length, 1);
  c.levels[3].increases = [];
  c.levels[4].increases = undefined;
  assert.strictEqual(find(validate(c, data), { level: 5, tab: 'abilities', code: 'increases' }).length, 1);
});

test('missing race and theme ability picks are blocked', () => {
  const c = clone(edit);
  delete c.abilities.raceAny;
  assert.strictEqual(find(validate(c, data), { tab: 'abilities', code: 'missing', ref: 'raceAny' }).length, 1);
  const t = clone(edit);
  t.theme = 'themeless';
  assert.strictEqual(find(validate(t, data), { tab: 'abilities', code: 'missing', ref: 'themeAny' }).length, 1);
  t.abilities.themeAny = 'dex';
  assert.strictEqual(find(validate(t, data), { ref: 'themeAny' }).length, 0);
});

test('unknown slugs become missing blockers instead of crashing', () => {
  const c = clone(edit);
  c.race = 'gone';
  c.theme = 'gone';
  c.levels[0].class = 'gone';
  c.levels[0].feats = ['gone_feat', 'toughness'];
  c.levels[1].choices = { x: ['gone_feature'] };
  c.gear = [{ item: 'gone_item', equipped: true }];
  const blockers = validate(c, data);
  ['gone', 'gone_feat', 'gone_feature', 'gone_item'].forEach((ref) => assert.ok(find(blockers, { code: 'missing', ref }).length >= 1, ref));
  assert.ok(find(blockers, { tab: 'feats', code: 'missing', ref: 'gone_feat' })[0].msg.includes('no longer exists'));
  assert.doesNotThrow(() => rules.derive(c, data));
});

test('area hooks default to no blockers and can be replaced', () => {
  const original = hooks.choiceBlockers;
  hooks.choiceBlockers = (char, d, ctx) => (ctx.level === 2 ? [{ level: 2, tab: 'class', code: 'choice', msg: 'x' }] : []);
  try {
    assert.strictEqual(find(validate(edit, data), { code: 'choice' }).length, 1);
  } finally {
    hooks.choiceBlockers = original;
  }
  assert.deepStrictEqual(validate(edit, data), []);
});

test('allowed sees same-level picks before the slot being edited', () => {
  assert.deepStrictEqual(allowed('feat', 'toughness', 0, edit, data), { ok: false, why: 'Toughness cannot be taken twice' });
  assert.deepStrictEqual(allowed('feat', 'toughness', 0, edit, data, 1), { ok: true });
  assert.strictEqual(allowed('feat', 'weapon_focus_(combat)', 0, edit, data, 1).ok, true);
  const dependent = Object.keys(data.feats).find((k) => (data.feats[k].prereq.all || []).length === 1 && data.feats[k].prereq.all[0].k === 'feat' && data.feats[data.feats[k].prereq.all[0].feat] && data.feats[data.feats[k].prereq.all[0].feat].prereq.all.length === 0);
  const base = data.feats[dependent].prereq.all[0].feat;
  const c = clone(edit);
  c.levels[0].feats = [base, 'toughness'];
  assert.strictEqual(allowed('feat', dependent, 0, c, data, 1).ok, true);
  assert.strictEqual(allowed('feat', dependent, 0, c, data, 0).ok, false);
});

test('gear blockers run even with zero levels', () => {
  const original = hooks.gearBlockers;
  hooks.gearBlockers = () => [{ level: null, tab: 'gear', code: 'g', msg: 'x' }];
  try {
    const c = clone(edit);
    c.levels = [];
    assert.strictEqual(find(validate(c, data), { code: 'g' }).length, 1);
  } finally {
    hooks.gearBlockers = original;
  }
});
