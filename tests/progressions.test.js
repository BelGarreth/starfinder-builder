const test = require('node:test');
const assert = require('node:assert');
const rules = require('../js/rules.js');
const bonus = require('../js/bonus.js');
const { validate, allowed, choiceBlockers } = require('../js/validate.js');
const data = require('../data/index.js');
const vesk = require('./fixtures/vesk-soldier-1.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const lvl = (cls, choices, extra) => Object.assign({ class: cls, skills: {}, feats: [], choices: choices || {}, spells: {} }, extra);
const PHASE1 = ['envoy', 'mechanic', 'mystic', 'operative', 'solarian', 'soldier', 'technomancer'];

function build(cls, n, choicesAt) {
  const c = clone(vesk);
  c.levels = [];
  for (let i = 1; i <= n; i++) c.levels.push(lvl(cls, (choicesAt && choicesAt[i]) || {}));
  return c;
}

const entries = (cls, n) => rules.entriesAt(data, cls, n);
const choiceAt = (cls, n, id) => entries(cls, n).find((e) => e.choice === id);
const features = (c) => rules.classFeatures(c, data).map((f) => f.slug);
const blockersAt = (c, n) => choiceBlockers(c, data, { level: n, levelIndex: n - 1 });

test('every phase 1 class has levels 1 to 20', () => {
  PHASE1.forEach((cls) => {
    const prog = data.progressions[cls];
    assert.ok(prog, cls);
    for (let n = 1; n <= 20; n++) assert.ok(Array.isArray(prog.levels[n]), cls + ' ' + n);
  });
});

test('every progression slug and pool entry resolves to a feature', () => {
  PHASE1.forEach((cls) => [cls, cls + '_enhanced'].forEach((slug) => {
    if (!data.classes[slug]) return;
    for (let n = 1; n <= 20; n++) {
      entries(slug, n).forEach((e) => {
        if (e.fixed) assert.ok(data.features[e.fixed], slug + ' ' + n + ' ' + e.fixed);
        if (e.choice) rules.poolOf(e, data, slug).forEach((k) => assert.ok(data.features[k], k));
      });
    }
  }));
});

test('soldier level 1 offers a fighting style and the style fixes its first technique', () => {
  const style = choiceAt('soldier', 1, 'fightingStyle');
  assert.ok(style.pool.indexOf('blitz') !== -1);
  assert.ok(entries('soldier', 1).some((e) => e.fixed === 'primary_style_technique'));
  assert.ok(entries('soldier', 1).some((e) => e.fixedOf === 'fightingStyle' && e.tier === 1));
  const c = build('soldier', 1, { 1: { fightingStyle: 'blitz' } });
  assert.ok(features(c).indexOf('rapid_response_(ex)_(1st)') !== -1);
  assert.deepStrictEqual(blockersAt(c, 1), []);
  assert.ok(blockersAt(build('soldier', 1), 1).some((b) => b.code === 'unspent'));
});

test('soldier style techniques follow the primary and secondary styles by level', () => {
  const picks = { 1: { fightingStyle: 'blitz' }, 3: { gearBoost: 'armored_advantage_(ex)' }, 9: { secondaryStyle: 'armor_storm' } };
  const c = build('soldier', 9, picks);
  const got = features(c);
  ['rapid_response_(ex)_(1st)', 'charge_attack_(ex)_(2nd)', 'keep_fighting_(ex)_(3rd)', 'hammer_fist_(ex)_(1st)'].forEach((k) => assert.ok(got.indexOf(k) !== -1, k));
  assert.ok(got.indexOf('enhanced_tank_(ex)_(2nd)') === -1);
  const same = build('soldier', 9, Object.assign({}, picks, { 9: { secondaryStyle: 'blitz' } }));
  assert.ok(blockersAt(same, 9).some((b) => b.code === 'duplicate' && b.ref === 'blitz'));
});

test('soldier 2 grants a bonus combat feat slot that rejects non-combat feats', () => {
  const c = build('soldier', 2, { 1: { fightingStyle: 'blitz' } });
  const slots = rules.featSlots(c, data);
  assert.deepStrictEqual(slots.map((s) => [s.level, s.kind, s.pool || null]), [[1, 'general', null], [2, 'bonus', 'combat']]);
  assert.strictEqual(rules.featSlots(build('soldier', 1), data).length, 1);
  const combat = Object.keys(data.feats).find((k) => data.feats[k].combat && data.feats[k].prereq.all.length === 0);
  assert.strictEqual(allowed('feat', combat, 1, c, data, 0).ok, true);
  assert.deepStrictEqual(allowed('feat', 'toughness', 1, c, data, 0), { ok: false, why: 'Soldier bonus feats must be combat feats' });
  c.levels[1].feats = ['toughness'];
  assert.ok(validate(c, data).some((b) => b.level === 2 && b.code === 'pool' && b.ref === 'toughness'));
});

test('envoy level 1 has skill expertise and an improvisation pool gated by level', () => {
  assert.ok(entries('envoy', 1).some((e) => e.fixed === 'skill_expertise_(ex)'));
  const improv = choiceAt('envoy', 1, 'improvisation');
  assert.ok(improv.pool.indexOf("get_'em_(ex)") !== -1);
  const fourth = improv.pool.find((k) => data.features[k].minLevel === 4);
  assert.ok(fourth);
  const c = build('envoy', 1, { 1: { improvisation: fourth } });
  assert.deepStrictEqual(allowed('choice', fourth, 0, c, data, 'improvisation'), { ok: false, why: 'Requires Envoy level 4' });
  assert.deepStrictEqual(allowed('choice', "get_'em_(ex)", 0, c, data, 'improvisation'), { ok: true });
  assert.ok(blockersAt(c, 1).some((b) => b.code === 'level' && b.ref === fourth));
  assert.ok(!choiceAt('envoy', 1, 'expertiseTalent'));
});

test('envoy skill expertise must be a listed skill with a rank', () => {
  const c = build('envoy', 1, { 1: { improvisation: "get_'em_(ex)", skillExpertise: 'blu' } });
  assert.ok(blockersAt(c, 1).some((b) => b.code === 'ranks'));
  c.levels[0].skills = { blu: 1 };
  assert.deepStrictEqual(blockersAt(c, 1), []);
  c.levels[0].choices.skillExpertise = 'acr';
  assert.ok(blockersAt(c, 1).some((b) => b.code === 'pool'));
});

test('operative daredevil adds skill focus to acrobatics and athletics and its exploit at 5', () => {
  const plain = rules.derive(build('operative', 1), data);
  const c = build('operative', 1, { 1: { specialization: 'class-daredevil' } });
  const s = rules.derive(c, data);
  assert.strictEqual(s.skills.acr.total - plain.skills.acr.total >= 3, true);
  assert.strictEqual(s.skills.ath.total - plain.skills.ath.total >= 3, true);
  assert.strictEqual(s.skills.ste.total, plain.skills.ste.total);
  assert.deepStrictEqual(rules.skillFocusSkills(c, data).sort(), ['acr', 'ath']);
  const five = build('operative', 5, { 1: { specialization: 'class-daredevil' } });
  assert.ok(features(five).indexOf('versatile_movement_(ex)') !== -1);
  assert.ok(features(build('operative', 4, { 1: { specialization: 'class-daredevil' } })).indexOf('versatile_movement_(ex)') === -1);
});

test('operative exploits cannot repeat across levels and respect their level', () => {
  const exploit = choiceAt('operative', 2, 'exploit');
  const early = exploit.pool.find((k) => data.features[k].minLevel === 2 && !data.features[k].repeatable);
  const late = exploit.pool.find((k) => data.features[k].minLevel === 6);
  const c = build('operative', 4, { 1: { specialization: 'class-daredevil' }, 2: { exploit: early }, 4: { exploit: early } });
  assert.ok(blockersAt(c, 4).some((b) => b.code === 'duplicate' && b.ref === early));
  assert.deepStrictEqual(blockersAt(c, 2), []);
  assert.deepStrictEqual(allowed('choice', late, 3, c, data, 'exploit'), { ok: false, why: 'Requires Operative level 6' });
});

test('soldier 3 weapon specialization is a fixed feature with damage modifiers', () => {
  const c = build('soldier', 3, { 1: { fightingStyle: 'blitz' }, 3: { gearBoost: 'armored_advantage_(ex)' } });
  assert.ok(features(c).indexOf('weapon_specialization_(ex)_(soldier)') !== -1);
  const spec = bonus.resolve(c, data).constants.filter((m) => m.sourceKey === 'weapon_specialization_(ex)_(soldier)');
  assert.strictEqual(spec.find((m) => m.valueAffected === 'longA').value, 3);
  assert.strictEqual(spec.find((m) => m.valueAffected === 'smallA').value, 1);
  assert.ok(features(build('soldier', 2)).indexOf('weapon_specialization_(ex)_(soldier)') === -1);
});

test('mechanic artificial intelligence offers only the exocortex', () => {
  assert.deepStrictEqual(choiceAt('mechanic', 1, 'ai').pool, ['exocortex']);
  const c = build('mechanic', 1, { 1: { ai: 'drone', memoryModule: 'com' } });
  assert.ok(blockersAt(c, 1).some((b) => b.ref === 'drone' && b.code === 'pool'));
  c.levels[0].choices.ai = 'exocortex';
  assert.deepStrictEqual(blockersAt(c, 1), []);
  assert.ok(features(c).indexOf('memory_module_(ex)') !== -1);
  assert.deepStrictEqual(rules.skillFocusSkills(c, data), ['com']);
  const mods = choiceAt('mechanic', 7, 'exocortexMod');
  assert.ok(mods.pool.indexOf('flight_system_(ex_exocortex)') !== -1);
  assert.strictEqual(data.features['flight_system_(ex_exocortex)'].minLevel, 11);
});

test('mystic connection grants its powers at 1, 3 and 6', () => {
  const c = build('mystic', 6, { 1: { connection: 'healer' } });
  const got = features(c);
  ['healing_channel_(su)', 'lifelink_(su)', "healer's_bond_(sp)"].forEach((k) => assert.ok(got.indexOf(k) !== -1, k));
  assert.ok(got.indexOf('steal_life_(su)') === -1);
});

test('solarian gets black hole and supernova at 1 and they are not in the revelation pool', () => {
  const got = features(build('solarian', 1));
  assert.ok(got.indexOf('black_hole_(su)') !== -1 && got.indexOf('supernova_(su)') !== -1);
  assert.ok(choiceAt('solarian', 2, 'revelation').pool.indexOf('black_hole_(su)') === -1);
  assert.strictEqual(choiceAt('solarian', 9, 'zenithRevelation').count, 2);
});

test('solarian skill adept picks become class skills', () => {
  const c = build('solarian', 1, { 1: { skillAdept: ['ste', 'pil'] } });
  c.levels[0].skills = { ste: 1 };
  const s = rules.derive(c, data);
  assert.strictEqual(s.skills.ste.classSkill, true);
});

test('enhanced variants add their entries on top of the base class', () => {
  assert.ok(!choiceAt('technomancer', 1, 'technomanticTalent'));
  const talent = choiceAt('technomancer_enhanced', 1, 'technomanticTalent');
  assert.ok(talent && talent.pool.indexOf('technomantic_talent_(evocation)') !== -1);
  assert.ok(entries('technomancer_enhanced', 2).some((e) => e.choice === 'hack'));
  assert.ok(entries('technomancer_enhanced', 2).some((e) => e.fixed === 'deconstructivist'));
  const twice = build('technomancer_enhanced', 4, { 1: { technomanticTalent: 'technomantic_talent_(evocation)' }, 4: { technomanticTalent: 'technomantic_talent_(evocation)' } });
  assert.ok(!blockersAt(twice, 4).some((b) => b.code === 'duplicate'));
  assert.ok(entries('envoy_enhanced', 2).some((e) => e.fixed === 'signature_support_(ex)'));
  assert.ok(entries('solarian_enhanced', 8).some((e) => e.fixed === 'aftershock_(su)'));
  assert.ok(!entries('solarian', 8).some((e) => e.fixed === 'aftershock_(su)'));
});

test('technomancer 3 bonus feat slot only takes spell focus', () => {
  const c = build('technomancer', 3);
  const slot = rules.featSlots(c, data).find((s) => s.level === 3 && s.kind === 'bonus');
  assert.deepStrictEqual(slot.pool, ['spell_focus']);
});

test('picks outside the schema are flagged, and orphaned slugs are missing', () => {
  const c = build('operative', 1, { 1: { specialization: 'class-daredevil', exploit: 'quick_movement_(ex)', bogus: 'gone_feature' } });
  const b = blockersAt(c, 1);
  assert.ok(b.some((x) => x.code === 'invalid' && x.ref === 'quick_movement_(ex)'));
  assert.ok(b.some((x) => x.code === 'missing' && x.ref === 'gone_feature'));
  c.levels[0].choices = { specialization: 'gone_feature' };
  assert.ok(blockersAt(c, 1).some((x) => x.code === 'missing' && x.ref === 'gone_feature'));
  assert.ok(!features(c).includes('quick_movement_(ex)'));
});

test('option requirements are enforced: Improved Get Em needs Get Em', () => {
  const c = build('envoy', 6, { 1: { improvisation: 'clever_feint_(ex)' }, 6: { improvisation: "improved_get_'em_(ex)" } });
  assert.deepStrictEqual(allowed('choice', "improved_get_'em_(ex)", 5, c, data, 'improvisation'), { ok: false, why: "Requires Get 'Em (Ex)" });
  assert.ok(blockersAt(c, 6).some((b) => b.code === 'prereq' && b.ref === "improved_get_'em_(ex)"));
  c.levels[0].choices.improvisation = "get_'em_(ex)";
  assert.deepStrictEqual(allowed('choice', "improved_get_'em_(ex)", 5, c, data, 'improvisation'), { ok: true });
  assert.ok(!blockersAt(c, 6).some((b) => b.code === 'prereq'));
});

test('a requirement picked at a later level does not satisfy an earlier pick', () => {
  const c = build('envoy', 8, { 1: { improvisation: 'clever_feint_(ex)' }, 6: { improvisation: "improved_get_'em_(ex)" }, 8: { improvisation: "get_'em_(ex)" } });
  assert.ok(blockersAt(c, 6).some((b) => b.code === 'prereq' && b.ref === "improved_get_'em_(ex)"));
  assert.ok(!blockersAt(c, 8).some((b) => b.code === 'prereq'));
});

test('zenith revelations must be one graviton and one photon at each of 9 and 17', () => {
  const zen = choiceAt('solarian', 9, 'zenithRevelation');
  assert.ok(zen.pool.every((k) => ['graviton', 'photon'].indexOf(data.features[k].stellarType) !== -1));
  const two = build('solarian', 9, { 9: { zenithRevelation: ['starquake_(su)', 'wormholes_(su)'] } });
  assert.ok(blockersAt(two, 9).some((b) => b.code === 'split' && b.ref === 'wormholes_(su)'));
  assert.strictEqual(allowed('choice', 'time_dilation_(su)', 8, two, data, { id: 'zenithRevelation', index: 1 }).ok, false);
  assert.strictEqual(allowed('choice', 'ray_of_light_(su)', 8, two, data, { id: 'zenithRevelation', index: 1 }).ok, true);
  assert.strictEqual(choiceAt('solarian', 17, 'zenithRevelation').distinct, 'stellarType');
});

test('the exocortex mechanic trick pool leaves out drone-only tricks and checks exocortex needs', () => {
  const pool = choiceAt('mechanic', 2, 'trick').pool;
  ['repair_drone_(ex)', 'artificial_pilot_(ex)', 'exploration_routine_(ex)', 'protective_programming_(ex)', 'melded_mod_(ex)', 'drone_meld_(ex)', 'experimental_cortex_design_(ex)']
    .forEach((k) => assert.ok(pool.indexOf(k) === -1, k));
  const c = build('mechanic', 2, { 1: { ai: 'exocortex', memoryModule: 'com' }, 2: { trick: 'combat_boost_(ex)' } });
  assert.deepStrictEqual(blockersAt(c, 2), []);
  c.levels[0].choices.ai = [];
  assert.ok(blockersAt(c, 2).some((b) => b.code === 'prereq' && b.ref === 'combat_boost_(ex)'));
});

test('an exocortex mod from the 11th-level list cannot be the first mod at 7', () => {
  const c = build('mechanic', 7, { 1: { ai: 'exocortex' } });
  assert.deepStrictEqual(allowed('choice', 'flight_system_(ex_exocortex)', 6, c, data, 'exocortexMod'), { ok: false, why: 'Requires Mechanic level 11' });
  assert.strictEqual(allowed('choice', 'speed_(ex_exocortex)', 6, c, data, 'exocortexMod').ok, true);
});

test('ambusher needs stealth as a class skill, and unparsed requirements are shown but not blocked', () => {
  const c = build('soldier', 1);
  assert.deepStrictEqual(allowed('choice', 'ambusher', 0, c, data, 'fightingStyle'), { ok: false, why: 'Requires Stealth as a class skill' });
  c.theme = Object.keys(data.themes).find((k) => data.themes[k].skill === 'ste');
  assert.strictEqual(allowed('choice', 'ambusher', 0, c, data, 'fightingStyle').ok, true);
  const four = allowed('choice', 'fourfold_tactician', 0, c, data, 'fightingStyle');
  assert.strictEqual(four.ok, true);
  assert.ok(/^Not checked: You must have four or more arms/.test(four.why));
});

test('solarian level 1 has stellar mode, and pool messages read naturally', () => {
  assert.ok(entries('solarian', 1).some((e) => e.fixed === 'stellar_mode_(su)'));
  assert.ok(features(build('solarian', 1)).indexOf('stellar_mode_(su)') !== -1);
  const c = build('envoy', 1, { 1: { improvisation: 'quick_movement_(ex)' } });
  assert.ok(blockersAt(c, 1).some((b) => b.msg === 'Quick Movement (Ex) is not an option for Envoy improvisation'));
});

test('specialization free ranks count once: in the sheet and prerequisites, not against the rank budget', () => {
  const plain = build('operative', 3);
  const c = build('operative', 3, { 1: { specialization: 'class-daredevil' } });
  assert.deepStrictEqual(rules.freeRanks(c, data), { acr: 3, ath: 3 });
  assert.strictEqual(rules.derive(c, data).skills.acr.ranks, 3);
  assert.strictEqual(rules.derive(plain, data).skills.acr.ranks, 0);
  [0, 1, 2].forEach((i) => assert.strictEqual(rules.rankBudget(i, c, data), rules.rankBudget(i, plain, data)));
  assert.ok(!validate(c, data).some((b) => b.code === 'rank-cap'));
  c.levels[1].skills = { acr: 1 };
  assert.ok(validate(c, data).some((b) => b.code === 'rank-cap' && b.level === 2 && b.ref === 'acr'));
  assert.strictEqual(rules.derive(c, data).skills.acr.ranks, 3);
  const disciple = build('operative', 2, { 1: { specialization: 'disciple' } });
  assert.deepStrictEqual(rules.freeRanks(disciple, data), { mys: 2, per: 2 });
  const feat = Object.keys(data.feats).find((k) => { const a = data.feats[k].prereq.all; return a.length === 1 && a[0].k === 'ranks' && a[0].skill === 'acr' && a[0].min <= 3; });
  if (feat) {
    assert.strictEqual(allowed('feat', feat, 2, c, data).ok, true);
    assert.strictEqual(allowed('feat', feat, 2, plain, data).ok, false);
  }
});
