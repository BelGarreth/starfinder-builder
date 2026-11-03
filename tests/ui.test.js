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
  .map((m) => m[1])
  .filter((src) => fs.existsSync(path.join(root, src)));

const win = {};
win.window = win;
const ctx = vm.createContext(win);
scripts.forEach((src) => vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), ctx, { filename: src }));
const U = win.SFUI;
const data = win.SFDATA;

const clone = (o) => JSON.parse(JSON.stringify(o));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const rowsOf = (html) => html.split('<tr').slice(1);
const rowWith = (html, needle) => rowsOf(html).find((r) => r.indexOf(needle) !== -1);

function vesk() {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vesk-soldier-1.json'), 'utf8'));
  c.gear = [{ id: 'g1', item: 'second_skin', qty: 1, equipped: true }];
  c.levels[0] = { class: 'soldier', increases: [], skills: { ath: 1, acr: 1, per: 1 }, feats: ['blind-fight_(combat)'], choices: { fightingStyle: 'sharpshoot' }, spells: {} };
  return c;
}
const ui = (o) => Object.assign(U.blankUI(), o || {});

test('vesk soldier 1 top bar shows its derived numbers and no blockers', () => {
  const v = U.view(vesk(), ui(), data);
  const top = text(v.top);
  ['SP 8', 'HP 13', 'RP 5', 'EAC 14', 'KAC 15', 'Fort +3', 'Ref +2', 'Will +2', 'Init +2'].forEach((s) => assert.ok(top.indexOf(s) !== -1, s + ' in ' + top));
  assert.ok(top.indexOf('Vesk · Mercenary · Soldier 1 · level 1') !== -1, top);
  assert.strictEqual(v.blockers, '');
  assert.strictEqual(v.ctx.blockers.length, 0);
});

test('levelling to 3 lists unspent ranks, feat slots and the gear boost choice, grouped by tab', () => {
  const c = vesk();
  const UI = ui();
  U.actions.addLevel(c, UI, data, 'soldier');
  assert.strictEqual(UI.tab, 'skills');
  U.actions.addLevel(c, UI, data, 'soldier');
  assert.strictEqual(UI.tab, 'class');
  assert.strictEqual(UI.lvl, 2);
  const b = U.renderBlockers(c, UI, data);
  const t = text(b);
  ['Level 2 has 3 unspent skill ranks', 'Level 3 has 3 unspent skill ranks', 'Level 2 has 1 empty feat slots', 'Level 3 has 1 empty feat slots', 'Choose 1 more Gear boost at level 3'].forEach((s) => assert.ok(t.indexOf(s) !== -1, s));
  assert.ok(b.indexOf('data-act="goto" data-a="skills" data-b2="1"') !== -1);
  assert.ok(t.indexOf('Class features') < t.indexOf('Skills') && t.indexOf('Skills') < t.indexOf('Feats'));
  U.actions.removeLevel(c, UI, data);
  assert.strictEqual(c.levels.length, 2);
});

test('clearing the level 3 blockers through the actions leaves none', () => {
  const c = vesk();
  const UI = ui();
  U.actions.addLevel(c, UI, data, 'soldier');
  U.actions.addLevel(c, UI, data, 'soldier');
  [1, 2].forEach((i) => ['ath', 'acr', 'per'].forEach((k) => U.bind(c, UI, 'levels.' + i + '.skills.' + k, '1', { t: 'n', z: true })));
  U.actions.takeFeat(c, UI, data, '1', 'improved_combat_maneuver_(combat)', '0');
  U.actions.takeFeat(c, UI, data, '2', 'toughness', '0');
  U.actions.pick(c, UI, data, '2', 'armored_advantage_(ex)', 'gearBoost');
  assert.deepStrictEqual(clone(win.SF.validate(c, data).map((b) => b.msg)), []);
});

test('disabled feat options carry their reason and AoN link', () => {
  const html = U.tabFeats(vesk(), ui({ tab: 'feats', featQ: 'weapon specialization', featSlot: 0 }), data, U.ctxOf(vesk(), data));
  const row = rowWith(html, 'Weapon Specialization (Combat)');
  assert.ok(row, 'row present');
  assert.ok(/<button[^>]*disabled/.test(row), 'disabled');
  assert.ok(text(row).indexOf('Requires character level 3') !== -1, text(row));
  assert.ok(row.indexOf('target="_blank" rel="noopener"') !== -1);
});

test('class feature pools show every option with level gates inline', () => {
  const c = vesk();
  const UI = ui();
  U.actions.addLevel(c, UI, data, 'soldier');
  U.actions.addLevel(c, UI, data, 'soldier');
  const html = U.tabClass(c, ui({ lvl: 2 }), data, U.ctxOf(c, data));
  const pool = data.progressions.soldier.levels['3'].find((e) => e.choice === 'gearBoost').pool;
  pool.forEach((slug) => assert.ok(html.indexOf('data-b2="' + U.esc(slug) + '"') !== -1, slug));
  const gated = rowWith(html, 'Fast Hands');
  assert.ok(/disabled/.test(gated) && text(gated).indexOf('Requires Soldier level 7') !== -1, text(gated || ''));
});

test('weapon focus shows its weapon type picker with disabled types explained', () => {
  const c = vesk();
  c.levels[0].feats = ['weapon_focus_(combat)'];
  c.levels[0].class = 'mystic';
  const html = U.tabFeats(c, ui(), data, U.ctxOf(c, data));
  assert.ok(html.indexOf('data-sel="featChoice"') !== -1);
  assert.ok(text(html).indexOf('Not proficient in longarms') !== -1, 'longarm reason');
});

test('skill focus shows a skill picker that disables a skill already chosen and writes the pick', () => {
  const c = vesk();
  c.levels[0].feats = ['skill_focus'];
  c.levels.push({ class: 'soldier', increases: [], skills: {}, feats: ['skill_focus'], choices: {}, spells: {} });
  c.levels.push({ class: 'soldier', increases: [], skills: {}, feats: ['skill_focus'], choices: {}, spells: {} });
  c.levels[0].choices.skill_focus = 'per';
  const html = U.tabFeats(c, ui({ lvl: 2 }), data, U.ctxOf(c, data));
  assert.ok(html.indexOf('data-sel="paramChoice"') !== -1);
  assert.ok(text(html).indexOf('Perception is already chosen for Skill Focus') !== -1);
  U.selects.paramChoice(c, ui(), data, 'sen', '2', 'skill_focus|0');
  assert.strictEqual(c.levels[2].choices.skill_focus, 'sen');
  U.selects.paramChoice(c, ui(), data, '', '2', 'skill_focus|0');
  assert.strictEqual(c.levels[2].choices.skill_focus, undefined);
});

test('replacing the first of two skill focus feats keeps the second pick', () => {
  const c = vesk();
  c.levels[0].feats = ['skill_focus', 'skill_focus'];
  c.levels[0].choices.skill_focus = ['per', 'sen'];
  U.actions.takeFeat(c, ui(), data, '0', 'toughness', '0');
  assert.strictEqual(c.levels[0].choices.skill_focus, 'sen');
});

test('lashunta student shows two skill pickers on the character tab', () => {
  const c = vesk();
  U.actions.race(c, ui(), data, 'lashunta');
  const html = U.tabChar(c, ui(), data);
  assert.strictEqual(html.split('data-sel="paramChoice"').length - 1, 2);
  U.selects.paramChoice(c, ui(), data, 'cul', '0', 'student|0');
  U.selects.paramChoice(c, ui(), data, 'mys', '0', 'student|1');
  assert.strictEqual(JSON.stringify(c.levels[0].choices.student), '["cul","mys"]');
});

test('param picks for a feature that is no longer held are dropped on normalize', () => {
  const c = vesk();
  c.levels[0].choices.student = ['cul', 'mys'];
  U.normalize(c, data);
  assert.strictEqual(c.levels[0].choices.student, undefined);
});

test('exocortex resistance shows an energy picker on the class tab', () => {
  const c = vesk();
  c.levels = [];
  for (let n = 0; n < 7; n++) c.levels.push({ class: 'mechanic', increases: [], skills: {}, feats: [], choices: {}, spells: {} });
  c.levels[0].choices.ai = 'exocortex';
  c.levels[6].choices.exocortexMod = 'resistance_(ex_exocortex)';
  const html = U.tabClass(c, ui({ lvl: 6 }), data, U.ctxOf(c, data));
  assert.ok(html.indexOf('data-sel="paramChoice"') !== -1);
  assert.ok(text(html).indexOf('Sonic') !== -1);
});

test('fusions are offered but disabled with the pricing reason', () => {
  const c = vesk();
  for (let n = 0; n < 9; n++) c.levels.push({ class: 'soldier' });
  const html = U.tabGear(c, ui({ shopCat: 'fusion', into: 'g1' }), data, U.ctxOf(c, data));
  const rows = rowsOf(html).filter((r) => r.indexOf('data-act="buy"') !== -1);
  assert.strictEqual(rows.length, Object.keys(data.items).filter((k) => data.items[k].type === 'fusion').length);
  assert.ok(rows.every((r) => /<button[^>]*disabled/.test(r)));
  assert.ok(text(rowWith(html, 'data-a="accurate"')).indexOf('Fusion pricing not available yet') !== -1);
  assert.ok(text(html).indexOf('Natural weapons (vesk)') !== -1);
});

test('large lists are capped with a refine note', () => {
  const c = vesk();
  const html = U.tabGear(c, ui(), data, U.ctxOf(c, data));
  assert.ok(rowsOf(html).filter((r) => r.indexOf('data-act="buy"') !== -1).length <= U.ROW_CAP);
  assert.ok(text(html).indexOf('Refine your search') !== -1);
});

test('trained-only skills with no ranks show as untrained', () => {
  const html = U.tabSkills(vesk(), ui(), data, U.ctxOf(vesk(), data));
  assert.ok(text(rowWith(html, 'Culture')).indexOf('—') !== -1);
  assert.ok(text(rowWith(html, 'Athletics')).indexOf('+9') !== -1);
});

test('data-derived text is escaped', () => {
  const c = vesk();
  c.name = '<b>Kr&g</b>';
  const top = U.renderTop(c, ui(), data);
  assert.ok(top.indexOf('&lt;b&gt;Kr&amp;g&lt;/b&gt;') !== -1);
  assert.ok(top.indexOf('<b>Kr') === -1);
});

test('the spells tab only appears for casters', () => {
  const c = vesk();
  assert.ok(U.renderTabs(c, ui(), data).indexOf('data-a="spells"') === -1);
  c.levels[0].class = 'mystic';
  assert.ok(U.renderTabs(c, ui(), data).indexOf('data-a="spells"') !== -1);
  const html = U.tabSpells(c, ui({ tab: 'spells' }), data, U.ctxOf(c, data));
  assert.ok(text(html).indexOf('Mystic spells') !== -1);
});

test('bulk over the limit warns in the top bar without a blocker', () => {
  const c = vesk();
  const heavy = Object.keys(data.items).find((k) => data.items[k].bulk === '10');
  c.gear.push({ id: 'g2', item: heavy, qty: 1, equipped: false });
  const v = U.view(c, ui(), data);
  assert.ok(text(v.top).indexOf('Encumbered') !== -1);
  assert.ok(!v.ctx.blockers.some((b) => /bulk/i.test(b.msg)));
});

test('race variants and the enhanced toggle', () => {
  const c = U.blank();
  const UI = ui();
  U.actions.race(c, UI, data, 'lashunta');
  assert.ok(/^lashunta_\(/.test(c.race));
  U.normalize(c, data);
  assert.strictEqual(c.variant, data.races[c.race].variant);
  assert.ok(text(U.view(c, UI, data).blockers).indexOf('Choose a class for level 1') !== -1);
  U.actions.addLevel(c, UI, data, 'envoy');
  U.actions.enh(c, UI, data, 'envoy');
  assert.strictEqual(c.levels[0].class, 'envoy_enhanced');
  const html = U.tabChar(c, UI, data);
  assert.ok(text(rowWith(html, 'data-a="envoy"') || '').indexOf("can't be mixed") === -1);
  const blank = U.renderBlockers(U.blank(), ui(), data);
  assert.ok(text(blank).indexOf('Choose a race') !== -1);
});

const maxOf = (html, b) => { const m = new RegExp('data-b="' + b.replace(/[.$()]/g, '\\$&') + '"[^>]*data-max="(-?\\d+)"').exec(html); return m ? Number(m[1]) : null; };

test('point buy inputs are capped at the creation maximum and points left, and bind clamps typed values', () => {
  const c = vesk();
  const html = U.tabAbilities(c, ui(), data, U.ctxOf(c, data));
  assert.strictEqual(maxOf(html, 'abilities.pb.str'), 5);
  assert.strictEqual(maxOf(html, 'abilities.pb.int'), 0);
  U.bind(c, ui(), 'abilities.pb.str', '20', { t: 'n', min: 0, max: 5 });
  assert.strictEqual(c.abilities.pb.str, 5);
  U.bind(c, ui(), 'abilities.pb.int', '-3', { t: 'n', min: 0, max: 0 });
  assert.strictEqual(c.abilities.pb.int, 0);
});

test('ability increases stop at four and only exist at 5, 10, 15 and 20', () => {
  const c = vesk();
  const UI = ui();
  for (let n = 0; n < 4; n++) c.levels.push(U.newLevel('soldier'));
  ['str', 'dex', 'con', 'wis', 'cha'].forEach((a) => U.actions.inc(c, UI, data, '4', a));
  assert.deepStrictEqual(clone(c.levels[4].increases), ['str', 'dex', 'con', 'wis']);
  U.actions.inc(c, UI, data, '3', 'str');
  assert.deepStrictEqual(clone(c.levels[3].increases), []);
  const html = U.tabAbilities(c, UI, data, U.ctxOf(c, data));
  assert.ok(/data-b2="cha" disabled/.test(html));
  assert.ok(/data-b2="str" checked>/.test(html));
});

test('skill rank inputs are capped by the level budget and the rank cap', () => {
  const c = vesk();
  const html = U.tabSkills(c, ui(), data, U.ctxOf(c, data));
  assert.strictEqual(maxOf(html, 'levels.0.skills.acr'), 1);
  assert.strictEqual(maxOf(html, 'levels.0.skills.eng'), 0);
  U.bind(c, ui(), 'levels.0.skills.acr', '9', { t: 'n', min: 0, max: 1, z: true });
  assert.strictEqual(c.levels[0].skills.acr, 1);
  U.bind(c, ui(), 'levels.0.skills.eng', '4', { t: 'n', min: 0, max: 0, z: true });
  assert.ok(!('eng' in c.levels[0].skills));
});

test('skill picks disable skills outside the list or below the rank minimum, and a single pick replaces', () => {
  const c = U.blank();
  c.race = 'human'; c.theme = 'ace_pilot'; c.abilities.raceAny = 'cha';
  c.levels = [U.newLevel('envoy')];
  const UI = ui();
  let html = U.tabClass(c, UI, data, U.ctxOf(c, data));
  const box = (k) => new RegExp('<label[^>]*><input[^>]*data-b2="' + k + '" data-c="skillExpertise"[^>]*>[^<]*(<span class="why">[^<]*</span>)?').exec(html)[0];
  assert.ok(/disabled/.test(box('acr')) && /not an option for Skill expertise/.test(box('acr')));
  assert.ok(/disabled/.test(box('blu')) && /needs 1 rank in Bluff/.test(box('blu')));
  c.levels[0].skills = { blu: 1, com: 1 };
  html = U.tabClass(c, UI, data, U.ctxOf(c, data));
  assert.ok(!/disabled/.test(box('blu')));
  U.actions.skillPick(c, UI, data, '0', 'acr', 'skillExpertise');
  assert.strictEqual(c.levels[0].choices.skillExpertise, undefined);
  U.actions.skillPick(c, UI, data, '0', 'blu', 'skillExpertise');
  U.actions.skillPick(c, UI, data, '0', 'com', 'skillExpertise');
  assert.strictEqual(c.levels[0].choices.skillExpertise, 'com');
});

test('multi-skill picks disable the rest once full', () => {
  const c = vesk();
  c.levels[0] = U.newLevel('solarian');
  const UI = ui();
  ['acr', 'ath', 'blu'].forEach((k) => U.actions.skillPick(c, UI, data, '0', k, 'skillAdept'));
  assert.deepStrictEqual(clone(c.levels[0].choices.skillAdept), ['acr', 'ath']);
  const html = U.tabClass(c, UI, data, U.ctxOf(c, data));
  assert.ok(/data-b2="blu" data-c="skillAdept" disabled/.test(html) && html.indexOf('Unpick one to choose another') !== -1);
});

test('a personal upgrade gets an ability picker on the gear tab that feeds the sheet', () => {
  const c = vesk();
  c.levels = [1, 2, 3].map(() => U.newLevel('soldier'));
  c.gear.push({ id: 'g2', item: 'synaptic_accelerators_(technology)_mk_1', qty: 1, equipped: true });
  const ctxOf = () => U.ctxOf(c, data);
  const html = U.tabGear(c, ui({ tab: 'gear' }), data, ctxOf());
  assert.ok(html.indexOf('data-sel="gearAbility"') !== -1);
  assert.ok(ctxOf().blockers.some((b) => b.tab === 'gear' && b.code === 'unspent' && b.ref === 'g2'));
  const dex = ctxOf().sheet.abilities.dex.score;
  U.selects.gearAbility(c, ui(), data, 'dex', '1');
  assert.strictEqual(c.gear[1].ability, 'dex');
  assert.strictEqual(ctxOf().sheet.abilities.dex.score, dex + 2);
  assert.ok(!ctxOf().blockers.some((b) => b.ref === 'g2'));
  U.selects.gearAbility(c, ui(), data, '', '1');
  assert.strictEqual(c.gear[1].ability, undefined);
});
