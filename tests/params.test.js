const test = require('node:test');
const assert = require('node:assert');
const bonus = require('../js/bonus.js');
const rules = require('../js/rules.js');
const { validate, allowed } = require('../js/validate.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const lvl = (cls, extra) => Object.assign({ class: cls, skills: {}, feats: [], choices: {}, spells: {} }, extra);
const build = (race, cls, n) => {
  const c = clone(vesk);
  c.race = race;
  c.levels = [];
  for (let i = 0; i < n; i++) c.levels.push(lvl(cls));
  return c;
};
const total = (c, key) => bonus.totalFor(c, data, key);
const blockersOf = (c, code, ref) => validate(c, data).filter((b) => b.code === code && (ref === undefined || b.ref === ref));

test('skill focus applies to the chosen skill only', () => {
  const base = build('vesk', 'soldier', 1);
  const c = clone(base);
  c.levels[0].feats = ['skill_focus'];
  c.levels[0].choices.skill_focus = 'per';
  assert.strictEqual(total(c, 'skill.per'), total(base, 'skill.per') + 3);
  assert.strictEqual(total(c, 'skill.acr'), total(base, 'skill.acr'));
});

test('skill focus with no pick contributes nothing and is unspent', () => {
  const base = build('vesk', 'soldier', 1);
  const c = clone(base);
  c.levels[0].feats = ['skill_focus'];
  assert.strictEqual(total(c, 'skill.acr'), total(base, 'skill.acr'));
  assert.strictEqual(blockersOf(c, 'unspent', 'skill_focus').length, 1);
});

test('two skill focus instances on different skills both apply, across levels and within one level', () => {
  const base = build('vesk', 'soldier', 3);
  const across = clone(base);
  across.levels[0].feats = ['skill_focus'];
  across.levels[0].choices.skill_focus = 'per';
  across.levels[2].feats = ['skill_focus'];
  across.levels[2].choices.skill_focus = 'sen';
  assert.strictEqual(total(across, 'skill.per'), total(base, 'skill.per') + 3);
  assert.strictEqual(total(across, 'skill.sen'), total(base, 'skill.sen') + 3);
  assert.strictEqual(blockersOf(across, 'duplicate').length, 0);
  assert.strictEqual(blockersOf(across, 'invalid-choice').length, 0);
  const within = clone(base);
  within.levels[0].feats = ['skill_focus', 'skill_focus'];
  within.levels[0].choices.skill_focus = ['per', 'sen'];
  assert.strictEqual(total(within, 'skill.per'), total(base, 'skill.per') + 3);
  assert.strictEqual(total(within, 'skill.sen'), total(base, 'skill.sen') + 3);
});

test('the same skill twice is a blocker and the picker disables it', () => {
  const c = build('vesk', 'soldier', 3);
  c.levels[0].feats = ['skill_focus'];
  c.levels[0].choices.skill_focus = 'per';
  c.levels[2].feats = ['skill_focus'];
  c.levels[2].choices.skill_focus = 'per';
  assert.strictEqual(blockersOf(c, 'duplicate', 'skill_focus').length, 1);
  assert.strictEqual(blockersOf(c, 'duplicate', 'skill_focus')[0].level, 3);
  const ans = allowed('choice', 'per', 2, c, data, { id: 'skill_focus', index: 0 });
  assert.strictEqual(ans.ok, false);
  assert.ok(/Perception/.test(ans.why));
  assert.strictEqual(allowed('choice', 'sen', 2, c, data, { id: 'skill_focus', index: 0 }).ok, true);
  assert.strictEqual(allowed('choice', 'per', 0, c, data, { id: 'skill_focus', index: 0 }).ok, true);
});

test('a skill that does not exist is an invalid-choice blocker', () => {
  const c = build('vesk', 'soldier', 1);
  c.levels[0].feats = ['skill_focus'];
  c.levels[0].choices.skill_focus = 'zzz';
  assert.strictEqual(blockersOf(c, 'invalid-choice', 'skill_focus').length, 1);
});

test('lashunta student takes two chosen skills and not acrobatics', () => {
  const base = build('lashunta_(damaya)', 'soldier', 1);
  const c = clone(base);
  c.levels[0].choices.student = ['cul', 'mys'];
  assert.strictEqual(total(c, 'skill.cul') - total(base, 'skill.cul'), 2);
  assert.strictEqual(total(c, 'skill.mys') - total(base, 'skill.mys'), 2);
  assert.strictEqual(total(c, 'skill.acr') - total(base, 'skill.acr'), 0);
  assert.strictEqual(blockersOf(c, 'unspent', 'student').length, 0);
});

test('unpicked student is unspent and contributes nothing', () => {
  const none = build('lashunta_(damaya)', 'soldier', 1);
  assert.strictEqual(blockersOf(none, 'unspent', 'student').length, 1);
  assert.strictEqual(total(none, 'skill.acr'), 0);
  const one = clone(none);
  one.levels[0].choices.student = ['cul'];
  assert.strictEqual(blockersOf(one, 'unspent', 'student').length, 1);
  assert.strictEqual(total(one, 'skill.cul'), 2);
});

test('student rejects the same skill twice', () => {
  const c = build('lashunta_(damaya)', 'soldier', 1);
  c.levels[0].choices.student = ['cul', 'cul'];
  assert.strictEqual(blockersOf(c, 'duplicate', 'student').length, 1);
});

test('channel skill follows the mystic connection and is not a pick', () => {
  const base = build('vesk', 'mystic', 2);
  base.levels[0].choices.connection = 'healer';
  const noChannel = build('vesk', 'mystic', 1);
  noChannel.levels[0].choices.connection = 'healer';
  const gained = (key) => total(base, key) - total(noChannel, key);
  assert.strictEqual(gained('skill.med'), 1);
  assert.strictEqual(gained('skill.mys'), 1);
  assert.strictEqual(gained('skill.acr'), 0);
  assert.strictEqual(gained('skill.ath'), 0);
  assert.strictEqual(blockersOf(base, 'unspent', 'channel_skill_(su)').length, 0);
});

test('every mystic connection lists two associated skills, except the two whose skills are picked per day or per character', () => {
  const conns = Object.keys(data.features).filter((k) => data.features[k].category === 'connection' && data.features[k].cls === 'mystic');
  assert.ok(conns.length >= 30);
  const open = ['shaper', 'zeitgeist'];
  conns.forEach((k) => assert.strictEqual(data.features[k].associatedSkills.length, open.indexOf(k) === -1 ? 2 : 0, k));
});

function mechanic(mods) {
  const c = build('vesk', 'mechanic', 7);
  c.levels[0].choices.ai = 'exocortex';
  c.levels[6].choices.exocortexMod = mods;
  return c;
}

test('exocortex resistance uses the chosen energy type, not acid', () => {
  const c = mechanic('resistance_(ex_exocortex)');
  c.levels[6].choices['resistance_(ex_exocortex)'] = 'fire';
  assert.strictEqual(total(c, 'resist.fire'), 7);
  assert.strictEqual(total(c, 'resist.acid'), 0);
  assert.strictEqual(blockersOf(c, 'unspent', 'resistance_(ex_exocortex)').length, 0);
});

test('exocortex resistance with no pick is unspent and gives nothing', () => {
  const c = mechanic('resistance_(ex_exocortex)');
  assert.strictEqual(total(c, 'resist.acid'), 0);
  assert.strictEqual(blockersOf(c, 'unspent', 'resistance_(ex_exocortex)').length, 1);
});

test('resistant energy and its improvement follow the picks', () => {
  const c = build('vesk', 'mechanic', 6);
  c.levels[0].choices.ai = 'exocortex';
  c.levels[1].choices.trick = 'resistant_energy_(ex)';
  c.levels[1].choices['resistant_energy_(ex)'] = 'sonic';
  assert.strictEqual(total(c, 'resist.sonic'), 5);
  assert.strictEqual(total(c, 'resist.acid'), 0);
  c.levels[3].choices.trick = 'improved_resistant_energy_(ex)';
  c.levels[3].choices['improved_resistant_energy_(ex)'] = ['sonic', 'cold'];
  assert.strictEqual(total(c, 'resist.cold'), 15);
  assert.strictEqual(total(c, 'resist.sonic'), 15);
  assert.strictEqual(total(c, 'resist.fire'), 0);
});

test('exocortex resistance plus greater resistance adds 5 to the base', () => {
  const c = build('vesk', 'mechanic', 11);
  c.levels[0].choices.ai = 'exocortex';
  c.levels[6].choices.exocortexMod = 'resistance_(ex_exocortex)';
  c.levels[6].choices['resistance_(ex_exocortex)'] = 'fire';
  c.levels[10].choices.exocortexMod = 'greater_resistance_(ex_exocortex)';
  c.levels[10].choices['greater_resistance_(ex_exocortex)'] = 'fire';
  assert.strictEqual(total(c, 'resist.fire'), 10 + 5);
  assert.strictEqual(blockersOf(c, 'invalid-choice').length, 0);
});

test('resistance from different sources takes the highest, not the sum', () => {
  const c = build('vesk', 'mechanic', 7);
  c.levels[0].choices.ai = 'exocortex';
  c.levels[1].choices.trick = 'resistant_energy_(ex)';
  c.levels[1].choices['resistant_energy_(ex)'] = 'fire';
  c.levels[6].choices.exocortexMod = 'resistance_(ex_exocortex)';
  c.levels[6].choices['resistance_(ex_exocortex)'] = 'fire';
  assert.strictEqual(total(c, 'resist.fire'), 7);
  c.levels[6].choices['resistance_(ex_exocortex)'] = 'cold';
  assert.strictEqual(total(c, 'resist.fire'), 5);
  assert.strictEqual(total(c, 'resist.cold'), 7);
});

test('shaper channel skill is two picks from its list', () => {
  const noChannel = build('vesk', 'mystic', 1);
  noChannel.levels[0].choices.connection = 'shaper';
  const c = build('vesk', 'mystic', 2);
  c.levels[0].choices.connection = 'shaper';
  assert.strictEqual(blockersOf(c, 'unspent', 'shaper').length, 1);
  assert.strictEqual(total(c, 'skill.com'), total(noChannel, 'skill.com'));
  c.levels[0].choices.shaper = ['com', 'eng'];
  assert.strictEqual(blockersOf(c, 'unspent', 'shaper').length, 0);
  assert.strictEqual(total(c, 'skill.com') - total(noChannel, 'skill.com'), 1);
  assert.strictEqual(total(c, 'skill.eng') - total(noChannel, 'skill.eng'), 1);
  assert.strictEqual(total(c, 'skill.acr') - total(noChannel, 'skill.acr'), 0);
  c.levels[0].choices.shaper = ['com', 'per'];
  assert.strictEqual(blockersOf(c, 'invalid-choice', 'shaper').length, 1);
});

test('greater resistance must name an energy type that already has resistance', () => {
  const c = mechanic('greater_resistance_(ex_exocortex)');
  c.levels[6].choices['greater_resistance_(ex_exocortex)'] = 'acid';
  assert.strictEqual(blockersOf(c, 'invalid-choice', 'greater_resistance_(ex_exocortex)').length, 1);
  assert.strictEqual(allowed('choice', 'acid', 6, c, data, { id: 'greater_resistance_(ex_exocortex)', index: 0 }).ok, false);
});

test('param picks are not reported as unknown level choices', () => {
  const c = build('lashunta_(damaya)', 'soldier', 1);
  c.levels[0].choices.student = ['cul', 'mys'];
  assert.strictEqual(validate(c, data).filter((b) => b.code === 'invalid' || b.code === 'missing').length, 0);
});
