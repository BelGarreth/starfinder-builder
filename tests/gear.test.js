const test = require('node:test');
const assert = require('node:assert');
const gear = require('../js/gear.js');
const rules = require('../js/rules.js');
const validate = require('../js/validate.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const lvl = (cls, extra) => Object.assign({ class: cls, skills: {}, feats: [], choices: {}, spells: {} }, extra);
const withGear = (g, n, cls) => {
  const c = clone(vesk);
  c.gear = g;
  c.levels = [];
  for (let i = 0; i < (n || 1); i++) c.levels.push(lvl(cls || 'soldier'));
  return c;
};
const line = (c, name) => gear.attackLines(c, data, rules.derive(c, data)).find((l) => l.name === name);
const codes = (c) => gear.gearBlockers(c, data, {}).map((b) => b.code);
const find = (pred) => Object.keys(data.items).find((k) => pred(data.items[k]));

test('vesk soldier 1 with second skin and tactical baton has 660 credits left', () => {
  const c = withGear([{ id: 'a', item: 'second_skin', qty: 1, equipped: true }, { id: 'b', item: 'baton_tactical', qty: 1, equipped: false }]);
  assert.deepStrictEqual(gear.budget(c, data), { credits: 1000, spent: 340, left: 660 });
});

test('baton line counts Str once', () => {
  const c = withGear([{ id: 'b', item: 'baton_tactical', qty: 1, equipped: false }]);
  const l = line(c, 'Baton, tactical');
  assert.strictEqual(l.attack, 5);
  assert.strictEqual(l.damage, '1d4+4');
  const thrown = line(c, 'Baton, tactical (thrown)');
  assert.strictEqual(thrown.attack, 3);
  assert.strictEqual(thrown.damage, '1d4+4');
});

test('wealth table covers 1 to 20', () => {
  assert.strictEqual(Object.keys(gear.WEALTH).length, 20);
  assert.strictEqual(gear.WEALTH[20], 3775000);
  assert.strictEqual(gear.budget(withGear([], 3), data).credits, 4000);
});

test('over budget and item level cap block', () => {
  const rich = find((i) => i.price > 1000 && i.level <= 1) || find((i) => i.price > 1000);
  assert.ok(codes(withGear([{ id: 'a', item: rich, qty: 1 }])).indexOf('over-budget') !== -1);
  const lvl2 = find((i) => i.level === 2 && i.price <= 100 && i.type === 'goods') || find((i) => i.level === 2 && i.price <= 500);
  assert.ok(codes(withGear([{ id: 'a', item: lvl2, qty: 1 }])).indexOf('item-level') !== -1);
  assert.ok(codes(withGear([{ id: 'a', item: lvl2, qty: 1 }], 2)).indexOf('item-level') === -1);
});

test('upgrades beyond armor slots block', () => {
  const upg = find((i) => i.type === 'upgrade' && i.level === 1 && i.slotCost === 1) || find((i) => i.type === 'upgrade' && i.slotCost === 1);
  const one = withGear([{ id: 'a', item: 'second_skin', equipped: true, slots: [{ item: upg }] }], 7);
  assert.ok(codes(one).indexOf('upgrade-slots') === -1);
  const two = withGear([{ id: 'a', item: 'second_skin', equipped: true, slots: [{ item: upg }, { item: upg }] }], 7);
  assert.ok(codes(two).indexOf('upgrade-slots') !== -1);
});

test('fusion levels beyond weapon level block', () => {
  const fusion = find((i) => i.type === 'fusion' && i.fusionLevel >= 5);
  const c = withGear([{ id: 'a', item: 'baton_tactical', fusions: [fusion] }], 8);
  assert.ok(codes(c).indexOf('fusion-level') !== -1);
});

test('two eye augmentations block, eye and ears do not', () => {
  const eyes = Object.keys(data.items).filter((k) => data.items[k].type === 'augmentation' && /^eyes?$/.test(data.items[k].augSystem) && data.items[k].level <= 3);
  const ears = find((i) => i.type === 'augmentation' && i.augSystem === 'ears' && i.level <= 3);
  const mk = (list) => withGear(list.map((k, i) => ({ id: 'g' + i, item: k, qty: 1, equipped: true })), 20);
  assert.ok(codes(mk([eyes[0], eyes[1]])).indexOf('augmentation-system') !== -1);
  assert.ok(codes(mk([eyes[0], ears])).indexOf('augmentation-system') === -1);
});

test('only one armor can be equipped', () => {
  const other = find((i) => i.armor && i.price <= 600 && i.level <= 3);
  assert.ok(codes(withGear([{ id: 'a', item: 'second_skin', equipped: true }, { id: 'b', item: other, equipped: true }], 3)).indexOf('armor-count') !== -1);
  assert.ok(codes(withGear([{ id: 'a', item: 'second_skin', equipped: true }, { id: 'b', item: other, equipped: false }], 3)).indexOf('armor-count') === -1);
});

test('validate surfaces gear blockers and allowed answers for items', () => {
  const c = withGear([{ id: 'a', item: 'second_skin', equipped: true }, { id: 'b', item: 'second_skin', equipped: true }]);
  assert.ok(validate.validate(c, data).some((b) => b.tab === 'gear' && b.code === 'armor-count'));
  const lvl2 = find((i) => i.level === 2);
  assert.strictEqual(validate.allowed('item', lvl2, 0, vesk, data).ok, false);
  assert.strictEqual(validate.allowed('item', 'baton_tactical', 0, vesk, data).ok, true);
  assert.strictEqual(validate.allowed('item', 'nope', 0, vesk, data).ok, false);
  const pricey = find((i) => i.level <= 1 && i.price > 1000);
  if (pricey) assert.match(validate.allowed('item', pricey, 0, vesk, data).why, /credits/);
});

test('allowed rejects an upgrade that overfills the armor', () => {
  const upg = find((i) => i.type === 'upgrade' && i.level <= 1 && i.slotCost === 1 && i.price <= 300);
  const c = withGear([{ id: 'a', item: 'second_skin', equipped: true, slots: [{ item: upg }] }]);
  assert.strictEqual(validate.allowed('item', upg, 0, c, data, { into: 'a' }).ok, false);
});

test('weapon specialization scales by weapon type: soldier 3 longarm +3, small arm +1', () => {
  const longarm = find((i) => i.weapon && i.weapon.type === 'longA' && /^\d+d\d+$/.test(i.weapon.damage[0].formula));
  const small = find((i) => i.weapon && i.weapon.type === 'smallA' && /^\d+d\d+$/.test(i.weapon.damage[0].formula));
  const c = withGear([{ id: 'l', item: longarm }, { id: 's', item: small }], 3);
  const dmg = (k) => line(c, data.items[k].name).damage;
  const plain = (k) => data.items[k].weapon.damage[0].formula.replace(/\s/g, '');
  assert.strictEqual(dmg(longarm), plain(longarm) + '+3');
  assert.strictEqual(dmg(small), plain(small) + '+1');
  const lvl1 = withGear([{ id: 'l', item: longarm }], 1);
  assert.strictEqual(line(lvl1, data.items[longarm].name).damage, plain(longarm));
});

test('operative property melee weapons get half specialization', () => {
  const c = withGear([{ id: 'b', item: 'baton_tactical' }], 4);
  assert.strictEqual(line(c, 'Baton, tactical').damage, '1d4+6');
});

test('weapon-scoped feat modifiers only apply to their weapon type', () => {
  const small = find((i) => i.weapon && i.weapon.type === 'smallA');
  const c = withGear([{ id: 'b', item: 'baton_tactical' }, { id: 's', item: small }], 3);
  c.levels[0].feats = ['weapon_focus_(combat)'];
  c.levels[0].choices['weapon_focus_(combat)'] = 'smallA';
  const base = withGear([{ id: 'b', item: 'baton_tactical' }, { id: 's', item: small }], 3);
  assert.strictEqual(line(c, data.items[small].name).attack, line(base, data.items[small].name).attack + 1);
  assert.strictEqual(line(c, 'Baton, tactical').attack, line(base, 'Baton, tactical').attack);
});

test('not proficient is -4 and unproficient armor penalty hits attacks', () => {
  const adv = find((i) => i.weapon && i.weapon.type === 'heavy');
  const c = withGear([{ id: 'h', item: adv }], 1, 'envoy');
  const prof = gear.proficiency(c, data);
  assert.strictEqual(!!prof.weapon.hweap, false);
  const withProf = clone(c);
  withProf.levels[0].feats = ['heavy_weapon_proficiency_(combat)'];
  const name = data.items[adv].name;
  assert.strictEqual(line(withProf, name).attack - line(c, name).attack, 4);
  const heavyArmor = find((i) => i.armor && i.armor.type === 'heavy' && i.armor.acp < 0 && i.price <= 100000);
  const worn = withGear([{ id: 'a', item: heavyArmor, equipped: true }, { id: 'b', item: 'baton_tactical' }], 1, 'envoy');
  const bare = withGear([{ id: 'b', item: 'baton_tactical' }], 1, 'envoy');
  const acp = rules.derive(worn, data).acp;
  assert.ok(acp < 0);
  assert.strictEqual(line(worn, 'Baton, tactical').attack - line(bare, 'Baton, tactical').attack, acp);
});

test('every weapon type in the data maps to a proficiency group', () => {
  const types = {};
  Object.values(data.items).forEach((i) => { if (i.weapon) types[i.weapon.type] = true; });
  Object.keys(types).forEach((t) => assert.ok(gear.WEAPON_PROFICIENCY[t], 'unmapped weapon type ' + t));
  const armor = {};
  Object.values(data.items).forEach((i) => { if (i.armor) armor[i.armor.type] = true; });
  Object.keys(armor).forEach((t) => assert.ok(gear.ARMOR_PROFICIENCY[t], 'unmapped armor type ' + t));
});

test('exocortex combat tracking grants heavy armor and longarms and longarm specialization', () => {
  const longarm = find((i) => i.weapon && i.weapon.type === 'longA' && /^\d+d\d+$/.test(i.weapon.damage[0].formula));
  const c = withGear([{ id: 'l', item: longarm }], 3, 'mechanic');
  const prof = gear.proficiency(c, data);
  assert.ok(prof.armor.hvy);
  assert.ok(prof.weapon.larms);
  assert.match(line(c, data.items[longarm].name).damage, /\+3$/);
});

test('vesk natural weapons replace the nonlethal unarmed strike; everyone else gets the unarmed strike', () => {
  const c = withGear([], 1);
  const lines = gear.attackLines(c, data, rules.derive(c, data));
  const natural = lines.find((l) => l.name === 'Natural weapons (vesk)');
  assert.strictEqual(natural.damage, '1d3+4');
  assert.match(natural.notes, /lethal/);
  assert.doesNotMatch(natural.notes, /nonlethal/);
  assert.strictEqual(lines.some((l) => l.name === 'Unarmed strike'), false);
  const human = clone(c);
  human.race = 'human';
  const humanLines = gear.attackLines(human, data, rules.derive(human, data));
  assert.strictEqual(humanLines.some((l) => /Natural/.test(l.name)), false);
  assert.match(humanLines.find((l) => l.name === 'Unarmed strike').notes, /nonlethal/);
});

test('vesk natural weapons add 1.5x level from level 3 instead of stacking with specialization', () => {
  const c = withGear([], 4);
  const natural = gear.attackLines(c, data, rules.derive(c, data)).find((l) => l.name === 'Natural weapons (vesk)');
  assert.strictEqual(natural.damage, '1d3+10');
});

test('bulk: half the Str score encumbers, the full score overburdens', () => {
  const heavyItem = find((i) => i.bulk === '10');
  const c = withGear([{ id: 'a', item: heavyItem, qty: 1 }]);
  assert.strictEqual(gear.bulkState(c, data, 18).state, 'encumbered');
  assert.strictEqual(gear.bulkState(c, data, 20).state, 'ok');
  assert.strictEqual(gear.bulkState(c, data, 12).state, 'encumbered');
  assert.strictEqual(gear.bulkState(c, data, 9).state, 'overburdened');
  assert.strictEqual(rules.derive(c, data).bulk.limit, rules.derive(c, data).abilities.str.score);
});

test('missing items are skipped by blockers and lines', () => {
  const c = withGear([{ id: 'a', item: 'gone', qty: 1 }]);
  assert.deepStrictEqual(codes(c), []);
  assert.ok(gear.attackLines(c, data, rules.derive(c, data)).length >= 1);
});

test('fusion prices come from the weapon level table, seals cost 110 percent at their own level, consumables pay half', () => {
  const fusion = find((i) => i.type === 'fusion' && i.fusionLevel === 1);
  gear.FUSION_PRICE[1] = 100;
  gear.FUSION_PRICE[3] = 400;
  try {
    const installed = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: fusion }] }]);
    assert.strictEqual(gear.budget(installed, data).spent, 90 + 100);
    const seal = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: fusion, level: 1, seal: true }] }]);
    assert.strictEqual(gear.budget(seal, data).spent, 90 + 110);
    const sealUp = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: fusion, level: 3, seal: true }] }]);
    assert.strictEqual(gear.budget(sealUp, data).spent, 90 + 440);
    assert.ok(codes(sealUp).indexOf('fusion-level') !== -1);
    assert.ok(codes(seal).indexOf('fusion-level') === -1);
    assert.ok(codes(seal).indexOf('price-unknown') === -1);
    const grenade = find((i) => i.weapon && i.weapon.type === 'grenade' && i.level === 1);
    const gren = withGear([{ id: 'g', item: grenade, fusions: [{ item: fusion }] }]);
    assert.strictEqual(gear.budget(gren, data).spent, data.items[grenade].price + 50);
    const low = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: find((i) => i.type === 'fusion' && i.fusionLevel === 5), level: 1, seal: true }] }], 8);
    assert.ok(codes(low).indexOf('fusion-seal-level') !== -1);
    assert.strictEqual(validate.allowed('item', fusion, 0, withGear([{ id: 'a', item: 'baton_tactical' }]), data, { into: 'a' }).ok, true);
  } finally {
    delete gear.FUSION_PRICE[1];
    delete gear.FUSION_PRICE[3];
  }
});

test('fusions fail closed while the price table has no entry', () => {
  const fusion = find((i) => i.type === 'fusion' && i.fusionLevel === 1);
  const base = withGear([{ id: 'a', item: 'baton_tactical' }]);
  const refused = validate.allowed('item', fusion, 0, base, data, { into: 'a' });
  assert.deepStrictEqual(refused, { ok: false, why: 'Fusion pricing not available yet' });
  assert.strictEqual(validate.allowed('item', fusion, 0, base, data).ok, false);
  const saved = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: fusion }] }]);
  assert.ok(codes(saved).indexOf('price-unknown') !== -1);
  const sealed = withGear([{ id: 'a', item: 'baton_tactical', fusions: [{ item: fusion, level: 1, seal: true }] }]);
  assert.ok(codes(sealed).indexOf('price-unknown') !== -1);
});

test('attachments must fit the parent kind', () => {
  const upg = find((i) => i.type === 'upgrade' && i.slotCost === 1);
  const fusion = find((i) => i.type === 'fusion' && i.fusionLevel === 1);
  const upgInWeapon = withGear([{ id: 'w', item: 'baton_tactical', slots: [{ item: upg }] }], 20);
  assert.ok(codes(upgInWeapon).indexOf('attachment-kind') !== -1);
  const fusionInArmor = withGear([{ id: 'a', item: 'second_skin', fusions: [{ item: fusion, level: 1 }] }], 20);
  assert.ok(codes(fusionInArmor).indexOf('attachment-kind') !== -1);
  const fine = withGear([{ id: 'w', item: 'baton_tactical', fusions: [{ item: fusion, level: 1, seal: true }] }, { id: 'a', item: 'second_skin', slots: [{ item: upg }] }], 20);
  assert.ok(codes(fine).indexOf('attachment-kind') === -1);
  const base = withGear([{ id: 'w', item: 'baton_tactical' }, { id: 'a', item: 'second_skin' }], 20);
  assert.strictEqual(validate.allowed('item', upg, 0, base, data, { into: 'w' }).ok, false);
  assert.strictEqual(validate.allowed('item', fusion, 0, base, data, { into: 'a' }).ok, false);
  gear.FUSION_PRICE[1] = 100;
  try {
    assert.strictEqual(validate.allowed('item', fusion, 0, base, data, { into: 'w' }).ok, true);
  } finally {
    delete gear.FUSION_PRICE[1];
  }
});

test('ammo is priced and weighed per pack and quantity must be a positive whole number', () => {
  const arrows = find((i) => i.perPack === 20);
  const rec = data.items[arrows];
  const spent = (qty) => gear.budget(withGear([{ id: 'a', item: arrows, qty }], 20), data).spent;
  assert.strictEqual(spent(20), rec.price);
  assert.strictEqual(spent(21), rec.price * 2);
  assert.strictEqual(spent(40), rec.price * 2);
  [0, 1.5, -2].forEach((qty) => assert.ok(codes(withGear([{ id: 'a', item: arrows, qty }], 20)).indexOf('qty') !== -1, String(qty)));
  assert.ok(codes(withGear([{ id: 'a', item: arrows, qty: 40 }], 20)).indexOf('qty') === -1);
  const heavy = find((i) => i.perPack > 1 && i.bulk === '1');
  if (heavy) {
    const perPack = data.items[heavy].perPack;
    assert.strictEqual(gear.bulkState(withGear([{ id: 'a', item: heavy, qty: perPack + 1 }]), data, 18).carried, 2);
  }
});

test('weapon focus and specialization need a proficient weapon type', () => {
  const focused = (choice, cls) => {
    const c = withGear([], 1, cls);
    c.levels[0].feats = ['weapon_focus_(combat)'];
    if (choice !== undefined) c.levels[0].choices['weapon_focus_(combat)'] = choice;
    return c;
  };
  const feats = (c) => validate.validate(c, data).filter((b) => b.tab === 'feats' && b.ref === 'weapon_focus_(combat)');
  assert.deepStrictEqual(feats(focused(undefined)).map((b) => [b.code, b.msg]), [['unspent', 'Choose a weapon type for Weapon Focus']]);
  assert.deepStrictEqual(feats(focused('smallA')), []);
  assert.deepStrictEqual(feats(focused('smallA')).length, 0);
  assert.deepStrictEqual(feats(focused('sniper', 'envoy')).map((b) => b.code), ['invalid-choice']);
  assert.deepStrictEqual(feats(focused('bogus')).map((b) => b.code), ['invalid-choice']);
  assert.strictEqual(validate.allowed('choice', 'smallA', 0, focused(undefined), data, { id: 'weapon_focus_(combat)' }).ok, true);
  const refused = validate.allowed('choice', 'sniper', 0, focused(undefined, 'envoy'), data, { id: 'weapon_focus_(combat)' });
  assert.strictEqual(refused.ok, false);
  assert.match(refused.why, /Not proficient/);
});

test('special weapon proficiency is per chosen weapon', () => {
  const special = find((i) => i.weapon && i.weapon.type === 'special' && i.level <= 1);
  const c = withGear([{ id: 's', item: special }], 1, 'envoy');
  c.levels[0].feats = ['special_weapon_proficiency_(combat)'];
  const name = data.items[special].name;
  const without = line(c, name).attack;
  c.levels[0].choices['special_weapon_proficiency_(combat)'] = special;
  assert.strictEqual(line(c, name).attack - without, 4);
  assert.strictEqual(validate.validate(c, data).some((b) => b.ref === 'special_weapon_proficiency_(combat)'), false);
  c.levels[0].choices['special_weapon_proficiency_(combat)'] = 'baton_tactical';
  assert.ok(validate.validate(c, data).some((b) => b.code === 'invalid-choice'));
});

test('weapon focus gives +1, or +2 when BAB trails level by 3', () => {
  const small = find((i) => i.weapon && i.weapon.type === 'smallA');
  const mk = (cls, n) => {
    const c = withGear([{ id: 's', item: small }], n, cls);
    const base = clone(c);
    c.levels[0].feats = ['weapon_focus_(combat)'];
    c.levels[0].choices['weapon_focus_(combat)'] = 'smallA';
    const name = data.items[small].name;
    return line(c, name).attack - line(base, name).attack;
  };
  assert.strictEqual(mk('soldier', 3), 1);
  assert.strictEqual(mk('mystic', 12), 2);
});

test('derive populates attacks from the same lines', () => {
  const c = withGear([{ id: 'b', item: 'baton_tactical' }]);
  const sheet = rules.derive(c, data);
  assert.deepStrictEqual(sheet.attacks, gear.attackLines(c, data, sheet));
  assert.ok(sheet.attacks.some((l) => l.name === 'Baton, tactical'));
});

const MK1 = 'synaptic_accelerators_(technology)_mk_1';
const MK2 = 'synaptic_accelerators_(technology)_mk_2';
function operative3(gearList) {
  const c = withGear(gearList, 3, 'operative');
  c.race = 'human';
  c.theme = 'ace_pilot';
  c.abilities = { pb: { str: 0, dex: 5, con: 2, int: 2, wis: 1, cha: 0 }, raceAny: 'dex' };
  return c;
}

test('all nine personal upgrades are recognised', () => {
  const personal = Object.keys(data.items).filter((k) => gear.isPersonal(data.items[k]));
  assert.strictEqual(personal.length, 9);
  personal.forEach((k) => assert.ok(data.items[k].modifiers.some((m) => m.effectType === 'ability-score' && m.valueAffected === 'str'), k));
});

test('a Dex mk 1 personal upgrade raises Dex and what derives from it, not Str', () => {
  const plain = rules.derive(operative3([]), data);
  const up = rules.derive(operative3([{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'dex' }]), data);
  assert.strictEqual(up.abilities.dex.score, plain.abilities.dex.score + 2);
  assert.strictEqual(up.abilities.str.score, plain.abilities.str.score);
  assert.strictEqual(up.abilities.dex.mod, plain.abilities.dex.mod + 1);
  assert.strictEqual(up.initiative, plain.initiative + 1);
  assert.strictEqual(up.ref, plain.ref + 1);
  assert.strictEqual(up.eac, plain.eac + 1);
  assert.strictEqual(up.skills.ste.total, plain.skills.ste.total + 1);
  assert.strictEqual(up.rp, plain.rp + 1);
});

test('a Con personal upgrade raises SP; an unequipped or unchosen one adds nothing', () => {
  const plain = rules.derive(operative3([]), data);
  const con = rules.derive(operative3([{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'con' }]), data);
  assert.strictEqual(con.abilities.con.score, plain.abilities.con.score + 2);
  assert.strictEqual(con.sp, plain.sp + 3);
  assert.strictEqual(con.fort, plain.fort + 1);
  const none = rules.derive(operative3([{ id: 'u', item: MK1, qty: 1, equipped: true }]), data);
  const stored = rules.derive(operative3([{ id: 'u', item: MK1, qty: 1, equipped: false, ability: 'con' }]), data);
  [none, stored].forEach((s) => {
    assert.deepStrictEqual(JSON.stringify(s.abilities), JSON.stringify(plain.abilities));
    assert.strictEqual(s.sp, plain.sp);
  });
});

test('personal upgrade ability picks are blocked until valid', () => {
  const blockers = (g) => gear.gearBlockers(operative3(g), data, {});
  assert.ok(blockers([{ id: 'u', item: MK1, qty: 1, equipped: true }]).some((b) => b.code === 'unspent' && b.ref === 'u'));
  assert.ok(blockers([{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'luck' }]).some((b) => b.code === 'invalid-choice'));
  assert.deepStrictEqual(blockers([{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'dex' }]).filter((b) => /personal|unspent|invalid|duplicate/.test(b.code)), []);
  const two = [{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'dex' }, { id: 'v', item: 'ability_crystal_(magic)_mk_1', qty: 1, equipped: true, ability: 'dex' }];
  const c = withGear(two, 3, 'operative');
  const codes2 = gear.gearBlockers(c, data, {}).map((b) => b.code);
  assert.strictEqual(codes2.filter((x) => x === 'duplicate').length, 1);
  assert.ok(codes2.indexOf('personal-model') !== -1);
  assert.ok(validate.allowed('ability', 'dex', 2, operative3([{ id: 'u', item: MK1, qty: 1, equipped: true }]), data, { gear: 'u' }).ok);
  const taken = validate.allowed('ability', 'dex', 2, c, data, { index: 1 });
  assert.strictEqual(taken.ok, false);
  assert.ok(/different ability/.test(taken.why), taken.why);
  assert.strictEqual(validate.allowed('ability', 'dex', 2, c, data, { gear: 'nope' }).ok, false);
  assert.strictEqual(validate.allowed('ability', 'dex', 2, withGear([{ id: 's', item: 'second_skin', qty: 1, equipped: true }], 3), data, { gear: 's' }).ok, false);
});

test('a personal upgrade counts toward feat prerequisites and spell ability, from its item level on', () => {
  const c = operative3([{ id: 'u', item: MK2, qty: 1, equipped: true, ability: 'con' }]);
  for (let i = 3; i < 7; i++) c.levels.push(lvl('operative'));
  assert.strictEqual(rules.abilityScores(c, data).con, rules.baseScores(c, data).con + 4);
  assert.strictEqual(rules.abilityScores(c, data, 6).con, rules.baseScores(c, data, 6).con);
  assert.strictEqual(rules.abilityScores(c, data, 7).con, rules.baseScores(c, data, 7).con + 4);
  const at = (n) => { const x = clone(c); x.levels = x.levels.slice(0, n); return x; };
  const conFeat = Object.keys(data.feats).find((k) => { const all = (data.feats[k].prereq || {}).all || []; return all.length === 1 && all[0].k === 'ability' && all[0].a === 'con' && all[0].min === 15; });
  assert.ok(conFeat);
  assert.ok(rules.baseScores(c, data).con < 15 && rules.abilityScores(c, data).con >= 15, 'fixture con');
  assert.ok(validate.allowed('feat', conFeat, 6, at(7), data).ok);
  assert.strictEqual(validate.allowed('feat', conFeat, 4, at(5), data).ok, false);
});

test('personal upgrade raises a caster spell ability for bonus spells', () => {
  const c = withGear([], 4, 'technomancer');
  c.race = 'human';
  c.theme = 'spacefarer';
  c.abilities = { pb: { str: 0, dex: 3, con: 2, int: 3, wis: 0, cha: 0 }, raceAny: 'con' };
  const before = rules.spellSlots(c, data).technomancer.perDay;
  c.gear = [{ id: 'u', item: MK1, qty: 1, equipped: true, ability: 'int' }];
  const after = rules.spellSlots(c, data).technomancer.perDay;
  assert.ok(rules.abilityScores(c, data).int === rules.baseScores(c, data).int + 2);
  assert.notDeepStrictEqual(JSON.stringify(after), JSON.stringify(before));
});
