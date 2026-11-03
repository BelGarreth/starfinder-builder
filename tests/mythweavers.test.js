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

const clone = (o) => JSON.parse(JSON.stringify(o));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const template = fixture('mythweavers-template-43.json');
const templateKeys = Object.keys(template.sheet_data);

function familyKeys(keys) {
  const fam = {};
  const out = new Set();
  keys.forEach((k) => {
    const m = /^(\D*?)(\d+)(.*)$/.exec(k);
    if (!m) { out.add(k); return; }
    fam[m[1]] = fam[m[1]] || { lo: Infinity, hi: 0, suf: new Set() };
    fam[m[1]].lo = Math.min(fam[m[1]].lo, Number(m[2]));
    fam[m[1]].hi = Math.max(fam[m[1]].hi, Number(m[2]));
    fam[m[1]].suf.add(m[3]);
  });
  Object.keys(fam).forEach((p) => { for (let i = fam[p].lo; i <= fam[p].hi; i++) fam[p].suf.forEach((x) => out.add(p + i + x)); });
  return [...out].sort();
}
const allowedKeys = familyKeys(templateKeys);

function vesk() {
  const c = fixture('vesk-soldier-1.json');
  c.gear = [{ id: 'g1', item: 'second_skin', qty: 1, equipped: true }];
  return c;
}

function bigChar() {
  const c = vesk();
  c.name = 'Rax';
  c.notes = 'hello';
  c.levels = [
    { class: 'soldier', increases: [], skills: { ath: 1, per: 1 }, feats: ['skill_focus'], choices: { fightingStyle: 'sharpshoot', skill_focus: 'per' }, spells: {} },
    { class: 'soldier', increases: [], skills: { ath: 1 }, feats: ['blind-fight_(combat)'], choices: {}, spells: {} },
    { class: 'operative', increases: [], skills: { ste: 1 }, feats: [], choices: {}, spells: {} }
  ];
  return c;
}

test('the key list is the fixture sheet expanded by family', () => {
  assert.deepStrictEqual(clone(H.MYTHWEAVERS_KEYS).sort(), allowedKeys);
  templateKeys.forEach((k) => assert.ok(allowedKeys.indexOf(k) !== -1, k));
  ['skill_13_rank', 'skill_20_acp', 'skill_42_rank', 'equip19_worth', 'aug20_loc', 'wpn1_range'].forEach((k) => assert.ok(allowedKeys.indexOf(k) !== -1, k));
  ['init_misc', 'spell_1', 'credits'].forEach((k) => assert.ok(allowedKeys.indexOf(k) === -1, k));
});

test('export of the vesk soldier is a template 43 wrapper with family keys and string values', () => {
  const out = H.toMythWeavers(vesk(), data);
  assert.strictEqual(out.sheet_template_id, 43);
  assert.strictEqual(out.name, 'Vesk Soldier');
  assert.strictEqual(out.private, false);
  assert.strictEqual(out.can_edit, true);
  ['id', 'legacy_id', 'owner', 'game', 'game_id'].forEach((k) => assert.strictEqual(out[k], null, k));
  assert.ok(!Number.isNaN(Date.parse(out.created_at)) && !Number.isNaN(Date.parse(out.updated_at)));
  Object.keys(template).forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(out, k), k));
  const sd = out.sheet_data;
  const extra = clone(Object.keys(sd)).filter((k) => allowedKeys.indexOf(k) === -1);
  assert.deepStrictEqual(extra, []);
  Object.keys(sd).forEach((k) => assert.strictEqual(typeof sd[k], 'string', k));
  const want = { hp: '13', max_hp: '13', stam: '8', res: '5', eac_total: '14', kac_total: '15', ac_cmac: '23', fortitude_total: '3', strength_score: '18', class: 'Soldier 1', race: 'Vesk', theme: 'Mercenary' };
  Object.keys(want).forEach((k) => assert.strictEqual(sd[k], want[k], k));
});

test('EAC, KAC, save and attack parts sum to their totals', () => {
  [vesk(), bigChar()].forEach((c) => {
    const sd = H.toMythWeavers(c, data).sheet_data;
    const n = (k) => Number(sd[k] || 0);
    ['eac', 'kac'].forEach((ac) => assert.strictEqual(10 + n(ac + '_armor') + n(ac + '_dex') + n(ac + '_misc'), n(ac + '_total'), ac));
    [['fortitude', 'con'], ['reflex', 'dex'], ['will', 'wis']].forEach(([s, a]) => assert.strictEqual(n(s + '_base') + n(s + '_' + a) + n(s + '_misc'), n(s + '_total'), s));
    [['mab', 'str'], ['rab', 'dex'], ['tab', 'str']].forEach(([p, a]) => assert.strictEqual(n(p + '_base') + n(p + '_' + a) + n(p + '_misc'), Number(sd[p + '_ab']), p));
    assert.strictEqual(n('ac_cmac'), n('kac_total') + 8);
  });
});

test('skills follow the sheet order and trained-only skills without ranks are blank', () => {
  const sd = H.toMythWeavers(bigChar(), data).sheet_data;
  Object.keys(SF.SKILLS).forEach((k, i) => assert.strictEqual(sd['skill_' + (i + 1) + '_name'], template.sheet_data['skill_' + (i + 1) + '_name'], k));
  assert.strictEqual(sd.skill_5_skill_mod, '');
  assert.strictEqual(sd.skill_2_rank, '2');
  assert.strictEqual(sd.skill_13_rank, '1');
  assert.strictEqual(sd.skill_19_rank, '1');
  assert.strictEqual(sd.skill_19_acp, '0');
  assert.strictEqual(sd.__txt_other_notes, 'hello');
  const s = SF.derive(bigChar(), data);
  assert.strictEqual(sd.skill_13_skill_mod, String(s.skills.per.total));
  assert.strictEqual(sd.total_ranks, '4');
});

test('every weapon row gets its range and every equipment row its details', () => {
  const c = bigChar();
  c.gear.push({ id: 'g2', item: 'laser_pistol_azimuth', qty: 1 }, { id: 'g3', item: 'baton_tactical', qty: 1 }, { id: 'g4', item: 'adaptive_serum_mk_1', qty: 2 }, { id: 'g5', item: 'comm_unit_personal', qty: 1 });
  const sd = H.toMythWeavers(c, data).sheet_data;
  const s = SF.derive(c, data);
  s.attacks.slice(0, 6).forEach((a, i) => {
    assert.strictEqual(sd['wpn' + (i + 1) + '_name'], a.name);
    assert.strictEqual(sd['wpn' + (i + 1) + '_range'], a.range || '');
  });
  assert.strictEqual(sd.wpn1_range, s.attacks[0].range || '');
  const rows = Object.keys(sd).filter((k) => /^equip\d+_$/.test(k));
  assert.ok(rows.length >= 2);
  rows.forEach((k) => ['loc', 'level', 'worth', 'weight'].forEach((x) => assert.ok(Object.prototype.hasOwnProperty.call(sd, k + x), k + x)));
});

test('feats carry their picks, then class features, and overflow goes to the notes', () => {
  const c = bigChar();
  const sd = H.toMythWeavers(c, data).sheet_data;
  assert.strictEqual(sd.feat_1, 'Skill Focus (Perception)');
  assert.strictEqual(sd.feat_2, 'Blind-Fight (Combat)');
  assert.ok(Object.keys(sd).some((k) => /^feat_\d+$/.test(k) && sd[k] === 'Sharpshoot'));
  const many = vesk();
  many.levels[0].feats = [];
  for (let i = 0; i < 50; i++) many.levels[0].feats.push('skill_focus');
  const out = H.toMythWeavers(many, data).sheet_data;
  assert.ok(out.feat_44);
  assert.ok(/More feats: /.test(out.__txt_other_notes));
});

test('round trip restores race, theme, classes, abilities and feats', () => {
  [vesk(), bigChar()].forEach((c) => {
    const back = clone(H.fromMythWeavers(clone(H.toMythWeavers(c, data)), data));
    assert.deepStrictEqual(back.unmatched, []);
    const r = back.char;
    assert.strictEqual(r.race, c.race);
    assert.strictEqual(r.theme, c.theme);
    assert.deepStrictEqual(r.levels.map((l) => l.class), c.levels.map((l) => l.class));
    assert.deepStrictEqual(r.abilities.pb, c.abilities.pb);
    const feats = (x) => x.levels.reduce((a, l) => a.concat(l.feats || []), []).sort();
    assert.deepStrictEqual(feats(r), feats(c));
    assert.strictEqual(SF.derive(r, data).eac, SF.derive(c, data).eac);
    assert.deepStrictEqual(clone(H.migrate(clone(r))), r);
  });
  const r = clone(H.fromMythWeavers(H.toMythWeavers(bigChar(), data), data).char);
  assert.strictEqual(r.levels[0].choices.skill_focus, 'per');
  assert.strictEqual(r.levels[0].choices.fightingStyle, 'sharpshoot');
  assert.strictEqual(r.notes, 'hello');
  const ranks = clone(SF.skillRanksOf(r));
  assert.deepStrictEqual({ ath: ranks.ath, per: ranks.per, ste: ranks.ste }, { ath: 2, per: 1, ste: 1 });
});

test('importing the dummy fixture does not throw and lists what it could not match', () => {
  const res = clone(H.fromMythWeavers(clone(template), data));
  assert.ok(res.unmatched.length > 0);
  assert.ok(res.unmatched.indexOf('Race: test') !== -1);
  assert.ok(res.unmatched.some((x) => /^Feat: test \(x\d+\)$/.test(x)));
  assert.strictEqual(res.char.theme, 'ace_pilot');
  assert.deepStrictEqual(res.char.levels.map((l) => l.class), ['soldier']);
  assert.ok(res.char.notes.indexOf('Imported from Myth-Weavers, not matched:') !== -1);
  assert.ok(Array.isArray(SF.validate(res.char, data)));
  assert.deepStrictEqual(clone(H.migrate(clone(res.char))), res.char);
  U.TABS.forEach(([tab]) => U.view(U.normalize(clone(res.char), data), Object.assign(U.blankUI(), { tab }), data));
});

test('class lines with levels and partial names are parsed', () => {
  const sheet = clone(template);
  sheet.sheet_data = { name: 'X', class: 'Soldier 3 / Operative 1', theme: 'Pilot', race: 'Cave Vesk', feat_1: 'Weapon Focus (Basic melee weapons)', feat_2: 'Improved Initiative' };
  const res = clone(H.fromMythWeavers(sheet, data));
  assert.deepStrictEqual(res.char.levels.map((l) => l.class), ['soldier', 'soldier', 'soldier', 'operative']);
  assert.strictEqual(res.char.race, 'vesk_(cave)');
  const feats = res.char.levels.reduce((a, l) => a.concat(l.feats), []);
  assert.ok(feats.indexOf('weapon_focus_(combat)') !== -1 && feats.indexOf('improved_initiative_(combat)') !== -1);
  const at = res.char.levels.findIndex((l) => l.feats.indexOf('weapon_focus_(combat)') !== -1);
  assert.strictEqual(res.char.levels[at].choices['weapon_focus_(combat)'], 'basicM');
});

test('a non-43 template or missing sheet_data throws ImportError', () => {
  const bad = [null, [], 'x', { sheet_template_id: 43 }, { sheet_template_id: 43, sheet_data: [] }, Object.assign(clone(template), { sheet_template_id: 12 })];
  bad.forEach((b) => assert.throws(() => H.fromMythWeavers(b, data), (e) => e instanceof H.ImportError && e.message.length > 10, JSON.stringify(b && b.sheet_template_id)));
  assert.throws(() => H.fromMythWeavers(Object.assign(clone(template), { sheet_template_id: 12 }), data), /template 12/);
});

test('importMythWeavers reports bad files and keeps the character', () => {
  const said = [];
  assert.strictEqual(H.importMythWeavers('{nope', (m) => said.push(m)), false);
  assert.strictEqual(H.importMythWeavers(JSON.stringify({ sheet_template_id: 7, sheet_data: {} }), (m) => said.push(m)), false);
  assert.strictEqual(said.length, 2);
  assert.ok(/JSON/.test(said[0]) && /template 7/.test(said[1]));
});

test('the Myth-Weavers tab has export and import controls and escapes user text', () => {
  assert.ok(U.TABS.map((t) => t[0]).join().endsWith('bbcode,mythweavers'));
  const c = vesk();
  const html = U.renderMain(c, Object.assign(U.blankUI(), { tab: 'mythweavers' }), data);
  assert.ok(html.indexOf('data-act="exportMythWeavers"') !== -1);
  assert.ok(html.indexOf('data-import-mw') !== -1);
  assert.ok(/best-effort/.test(html));
  const sheet = clone(template);
  sheet.sheet_data = { name: '<b>Evil</b>', class: 'Soldier', feat_1: '<img src=x onerror=alert(1)>' };
  const said = [];
  win.C = vesk();
  assert.strictEqual(H.importMythWeavers(JSON.stringify(sheet), (m) => said.push(m)), true);
  const after = U.tabMythWeavers(win.C, U.blankUI(), data);
  assert.ok(after.indexOf('<img') === -1 && after.indexOf('<b>Evil') === -1);
  assert.ok(after.indexOf('&lt;img src=x onerror=alert(1)&gt;') !== -1);
  assert.ok(after.indexOf('&lt;b&gt;Evil&lt;/b&gt;') !== -1);
  assert.strictEqual(H.lastMythWeaversImport().name, '<b>Evil</b>');
  H.actions.clearMythWeavers();
  assert.strictEqual(H.lastMythWeaversImport(), null);
});
