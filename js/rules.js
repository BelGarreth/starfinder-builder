(function(root){
  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const POINT_BUY = { base: 10, points: 10, maxAtCreation: 18 };
  const increaseAt = [5, 10, 15, 20];
  const INCREASE_COUNT = 4;
  const SAVE_KEYS = ['fort', 'ref', 'will'];

  const blankCharacter = () => ({
    v: 1, name: '', race: '', variant: null, theme: '',
    abilities: { pb: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
    levels: [], gear: [], notes: ''
  });

  const mod = (score) => Math.floor((score - 10) / 2);
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const ownRec = (tbl, k) => (tbl && typeof k === 'string' && Object.prototype.hasOwnProperty.call(tbl, k) ? tbl[k] : null);
  const classRec = (data, slug) => ownRec(data.classes, slug);
  const raceRec = (char, data) => ownRec(data.races, char.race);
  const themeRec = (char, data) => (char.theme ? ownRec(data.themes, char.theme) : null);
  const isAbility = (a) => ABILITIES.indexOf(a) !== -1;
  const pbOf = (char) => (char.abilities && char.abilities.pb) || {};

  function themeBonus(char, data) {
    const theme = themeRec(char, data);
    if (!theme) return null;
    const open = char.theme === 'themeless' || !isAbility(theme.ability);
    const ability = open ? (char.abilities && char.abilities.themeAny) : theme.ability;
    return isAbility(ability) ? { ability, amount: theme.mod || 1 } : null;
  }

  function creationScores(char, data) {
    const scores = {};
    const pb = pbOf(char);
    ABILITIES.forEach((a) => { scores[a] = POINT_BUY.base + (Number(pb[a]) || 0); });
    const race = raceRec(char, data);
    if (race) {
      (race.abilityMods || []).forEach(([amount, ability]) => {
        const target = ability === 'any' ? char.abilities && char.abilities.raceAny : ability;
        if (isAbility(target)) scores[target] += amount;
      });
    }
    const theme = themeBonus(char, data);
    if (theme) scores[theme.ability] += theme.amount;
    return scores;
  }

  function baseScores(char, data, upToLevels) {
    const scores = creationScores(char, data);
    const levels = levelsOf(char);
    const limit = upToLevels === undefined ? levels.length : upToLevels;
    levels.slice(0, limit).forEach((lvl, i) => {
      if (increaseAt.indexOf(i + 1) === -1 || !Array.isArray(lvl.increases)) return;
      const seen = {};
      lvl.increases.forEach((a) => {
        if (!isAbility(a) || seen[a]) return;
        seen[a] = true;
        scores[a] += scores[a] >= 17 ? 1 : 2;
      });
    });
    return scores;
  }

  const gearLib = () => (typeof module !== 'undefined' ? require('./gear.js') : root.SF);

  function abilityScores(char, data, upToLevels) {
    const scores = baseScores(char, data, upToLevels);
    const levels = upToLevels === undefined ? levelsOf(char).length : Math.min(upToLevels, levelsOf(char).length);
    const bonus = gearLib().upgradeBonuses(char, data, levels);
    Object.keys(bonus).forEach((a) => { scores[a] += bonus[a]; });
    return scores;
  }

  function pointBuyErrors(char, data) {
    const errors = [];
    const pb = pbOf(char);
    let spent = 0;
    ABILITIES.forEach((a) => {
      const n = pb[a] === undefined || pb[a] === null ? 0 : Number(pb[a]);
      if (!Number.isInteger(n) || n < 0) errors.push('Point buy for ' + a + ' must be a whole number of 0 or more');
      else spent += n;
    });
    if (spent > POINT_BUY.points) errors.push('Point buy spends ' + spent + ' of ' + POINT_BUY.points + ' points');
    const scores = creationScores(char, data);
    ABILITIES.forEach((a) => {
      if (scores[a] > POINT_BUY.maxAtCreation) errors.push(a.toUpperCase() + ' is ' + scores[a] + ', above the creation maximum of ' + POINT_BUY.maxAtCreation);
    });
    return errors;
  }

  function classLevels(char) {
    const out = {};
    levelsOf(char).forEach((l) => {
      const k = l && l.class;
      if (k === '__proto__') return;
      out[k] = (Object.prototype.hasOwnProperty.call(out, k) ? out[k] : 0) + 1;
    });
    return out;
  }

  const charLevel = (char) => levelsOf(char).length;

  function sumClasses(char, data, fn) {
    const levels = classLevels(char);
    return Object.keys(levels).reduce((total, slug) => {
      const rec = classRec(data, slug);
      return rec ? total + fn(rec, levels[slug]) : total;
    }, 0);
  }

  const bab = (char, data) => sumClasses(char, data, (c, n) => (c.bab === 'full' ? n : Math.floor(n * 3 / 4)));

  function baseSave(kind, char, data) {
    if (SAVE_KEYS.indexOf(kind) === -1) throw new Error('Unknown save ' + kind);
    return sumClasses(char, data, (c, n) => (c[kind] === 'fast' ? Math.floor(n / 2) + 2 : Math.floor(n / 3)));
  }

  function hp(char, data) {
    const race = raceRec(char, data);
    return (race ? race.hp : 0) + sumClasses(char, data, (c, n) => c.hp * n);
  }

  function adjusted(scores, adj) {
    Object.keys(adj || {}).forEach((a) => { if (isAbility(a)) scores[a] += adj[a]; });
    return scores;
  }

  function sp(char, data, adj) {
    const conMod = mod(adjusted(abilityScores(char, data), adj).con);
    return sumClasses(char, data, (c, n) => (c.sp + conMod) * n);
  }

  function rp(char, data, adj) {
    const scores = adjusted(abilityScores(char, data), adj);
    const keyMods = Object.keys(classLevels(char))
      .map((slug) => classRec(data, slug))
      .filter((c) => c && isAbility(c.kas))
      .map((c) => mod(scores[c.kas]));
    const best = keyMods.length ? Math.max.apply(null, keyMods) : 0;
    return Math.max(1, Math.floor(charLevel(char) / 2)) + best;
  }

  function isHuman(char, data) {
    const race = raceRec(char, data);
    return !!race && race.base === 'human';
  }

  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const listOf = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

  function progressionOf(data, cls) {
    const rec = classRec(data, cls);
    const base = rec && rec.enhancedOf ? rec.enhancedOf : String(cls || '').replace(/_enhanced$/, '');
    const progressions = (data && data.progressions) || {};
    const prog = hasOwn(progressions, base) ? progressions[base] : null;
    if (!prog) return null;
    const enhanced = cls !== base || !!(rec && rec.enhancedOf);
    return { base, levels: prog.levels || {}, extra: enhanced && prog.enhanced ? prog.enhanced.levels || {} : {} };
  }

  function progressionEntries(data, cls, classLevel) {
    const prog = progressionOf(data, cls);
    if (!prog) return [];
    const base = listOf(prog.levels[classLevel]);
    const extra = listOf(prog.extra[classLevel]);
    const replaced = extra.filter((e) => e.choice).map((e) => e.choice);
    return base.filter((e) => !e.choice || replaced.indexOf(e.choice) === -1).concat(extra);
  }

  function levelPlan(char, data) {
    const taken = {};
    return levelsOf(char).map((lvl, i) => {
      const cls = lvl && lvl.class;
      taken[cls] = (taken[cls] || 0) + 1;
      return { levelIndex: i, cls, classLevel: taken[cls], entries: progressionEntries(data, cls, taken[cls]), choices: (lvl && lvl.choices) || {} };
    });
  }

  function choiceEntry(plan, cls, id) {
    for (let i = 0; i < plan.length; i++) {
      if (plan[i].cls !== cls) continue;
      const e = plan[i].entries.find((x) => x.choice === id);
      if (e) return { entry: e, at: plan[i] };
    }
    return null;
  }

  function poolOf(entry, data, cls, seen) {
    if (Array.isArray(entry.pool)) return entry.pool;
    if (entry.pool && entry.pool.poolOf) {
      const visited = seen || {};
      if (visited[entry.pool.poolOf]) return [];
      visited[entry.pool.poolOf] = true;
      const prog = progressionOf(data, cls);
      if (!prog) return [];
      const all = Object.keys(prog.levels).map((n) => progressionEntries(data, cls, n)).reduce((a, b) => a.concat(b), []);
      const ref = all.find((x) => x.choice === entry.pool.poolOf);
      return ref ? poolOf(ref, data, cls, visited) : [];
    }
    return [];
  }

  function pickedFor(plan, cls, id) {
    const out = [];
    plan.forEach((p) => { if (p.cls === cls) listOf(p.choices[id]).forEach((k) => out.push(k)); });
    return out;
  }

  function classFeatures(char, data) {
    const features = (data && data.features) || {};
    const plan = levelPlan(char, data);
    const out = [];
    const add = (slug, p, via, choice, index) => {
      if (typeof slug !== 'string' || !hasOwn(features, slug)) return;
      const f = { slug, levelIndex: p.levelIndex, cls: p.cls, via };
      if (choice) { f.choice = choice; f.index = index; }
      out.push(f);
    };
    plan.forEach((p) => {
      p.entries.forEach((e) => {
        if (e.fixed) add(e.fixed, p, 'fixed');
        else if (e.choice) {
          const pool = poolOf(e, data, p.cls);
          listOf(p.choices[e.choice]).forEach((k, j) => { if (pool.indexOf(k) !== -1) add(k, p, 'choice', e.choice, j); });
        } else if (e.fixedOf) {
          const option = pickedFor(plan, p.cls, e.fixedOf)[0];
          const rec = hasOwn(features, option) ? features[option] : null;
          listOf(rec && rec.grants && rec.grants[e.tier]).forEach((k) => add(k, p, 'grant'));
        }
      });
    });
    return out;
  }

  function grantedFeats(char, data) {
    const feats = (data && data.feats) || {};
    const out = [];
    levelPlan(char, data).forEach((p) => p.entries.forEach((e) => {
      if (typeof e.fixedFeat === 'string' && hasOwn(feats, e.fixedFeat)) out.push({ slug: e.fixedFeat, levelIndex: p.levelIndex, cls: p.cls });
    }));
    return out;
  }

  const grantedAt = (char, data, levelIndex) => grantedFeats(char, data).filter((f) => f.levelIndex === levelIndex).map((f) => f.slug);

  function skillPicks(char, data, flag) {
    const out = [];
    levelPlan(char, data).forEach((p) => p.entries.forEach((e) => {
      if (!e.skillPick || (flag && !e[flag])) return;
      listOf(p.choices[e.skillPick]).forEach((k) => { if (hasOwn(SKILLS, k) && out.indexOf(k) === -1) out.push(k); });
    }));
    return out;
  }

  function skillFocusSkills(char, data) {
    const features = (data && data.features) || {};
    const out = skillPicks(char, data, 'skillFocus');
    classFeatures(char, data).forEach((f) => listOf(features[f.slug].skillFocus).forEach((k) => { if (out.indexOf(k) === -1) out.push(k); }));
    return out;
  }

  function freeRanks(char, data) {
    const features = (data && data.features) || {};
    const levels = classLevels(char);
    const out = {};
    const seen = {};
    classFeatures(char, data).forEach((f) => {
      const rec = features[f.slug];
      if (!rec.freeRanks || seen[f.slug]) return;
      seen[f.slug] = true;
      listOf(rec.skillFocus).forEach((k) => { out[k] = (out[k] || 0) + (levels[f.cls] || 0); });
    });
    return out;
  }

  function featSlots(char, data) {
    const slots = [];
    const total = charLevel(char);
    for (let lvl = 1; lvl <= total; lvl += 2) slots.push({ level: lvl, kind: 'general', source: 'character level' });
    if (total >= 1 && isHuman(char, data)) slots.push({ level: 1, kind: 'bonus', source: 'human' });
    levelPlan(char, data).forEach((p) => p.entries.forEach((e) => {
      if (!e.bonusFeat) return;
      const slot = { level: p.levelIndex + 1, kind: 'bonus', source: p.cls };
      if (e.pool) slot.pool = e.pool;
      slots.push(slot);
    }));
    const rank = (s) => (s.kind === 'general' ? 0 : s.pool ? 2 : 1);
    return slots.sort((a, b) => a.level - b.level || rank(a) - rank(b));
  }

  function rankBudget(levelIndex, char, data) {
    const lvl = levelsOf(char)[levelIndex];
    const rec = lvl && classRec(data, lvl.class);
    const intMod = mod(baseScores(char, data, levelIndex + 1).int);
    return Math.max(1, (rec ? rec.ranks : 0) + intMod) + (isHuman(char, data) ? 1 : 0);
  }

  function pointBuyMax(char, data, ability) {
    const pb = pbOf(char);
    const current = Number(pb[ability]) || 0;
    const spent = ABILITIES.reduce((n, a) => n + Math.max(0, Number(pb[a]) || 0), 0);
    const adjust = creationScores(char, data)[ability] - POINT_BUY.base - current;
    const byScore = POINT_BUY.maxAtCreation - POINT_BUY.base - adjust;
    return Math.max(0, Math.min(byScore, current + POINT_BUY.points - spent));
  }

  function rankMax(levelIndex, char, data, skill) {
    const levels = levelsOf(char);
    const lvl = levels[levelIndex];
    if (!lvl) return 0;
    const picked = lvl.skills || {};
    const current = Math.max(0, Number(picked[skill]) || 0);
    const spent = Object.keys(picked).reduce((n, k) => n + Math.max(0, Number(picked[k]) || 0), 0);
    let max = current + rankBudget(levelIndex, char, data) - spent;
    for (let j = levelIndex; j < levels.length; j++) {
      const asOf = charAt(char, j + 1);
      const others = (skillRanksOf(asOf)[skill] || 0) - current;
      const free = freeRanks(asOf, data)[skill] || 0;
      max = Math.min(max, j + 1 - others - free);
    }
    return Math.max(0, max);
  }

  const SPELL_LISTS = { mystic: 'myst', technomancer: 'tech' };
  const MAX_BONUS_MOD = 10;

  function spellListOf(cls, data) {
    const rec = classRec(data, cls);
    const base = rec && rec.enhancedOf ? rec.enhancedOf : String(cls || '').replace(/_enhanced$/, '');
    return rec && rec.caster && hasOwn(SPELL_LISTS, base) ? SPELL_LISTS[base] : null;
  }

  function spellRow(table, classLevel) {
    const row = hasOwn(table, classLevel) ? table[classLevel] : {};
    const out = {};
    Object.keys(row).forEach((l) => { out[l] = row[l]; });
    return out;
  }

  function spellSlotsFor(char, data, cls, classLevel, score) {
    const rec = classRec(data, cls);
    const known = spellRow(rec.spellsKnown || {}, classLevel);
    const perDay = spellRow(rec.spellsPerDay || {}, classLevel);
    const bonus = spellRow(rec.bonusSpellsPerDay || {}, Math.min(mod(score), MAX_BONUS_MOD));
    if (mod(score) >= 1) Object.keys(perDay).forEach((l) => { perDay[l] += bonus[l] || 0; });
    return { known, perDay };
  }

  function spellSlots(char, data, adj) {
    const out = {};
    const levels = classLevels(char);
    const scores = adjusted(abilityScores(char, data), adj);
    Object.keys(levels).forEach((cls) => {
      const rec = classRec(data, cls);
      if (!spellListOf(cls, data) || !isAbility(rec.spellAbility)) return;
      out[cls] = spellSlotsFor(char, data, cls, levels[cls], scores[rec.spellAbility]);
    });
    return out;
  }

  function connectionSpells(char, data) {
    const features = (data && data.features) || {};
    const plan = levelPlan(char, data);
    const out = {};
    Object.keys(classLevels(char)).forEach((cls) => {
      const rec = classRec(data, cls);
      const pick = pickedFor(plan, cls, 'connection')[0];
      const found = hasOwn(features, pick) ? features[pick].connectionSpells : null;
      if (!rec || !found || !spellListOf(cls, data)) return;
      const known = spellRow(rec.spellsKnown || {}, classLevels(char)[cls]);
      const top = Math.max.apply(null, [0].concat(Object.keys(known).map(Number)));
      const list = [];
      for (let level = 1; level <= top; level++) {
        const slug = level === top && found.variable ? found.variable : (found.fixed || {})[level];
        if (slug) list.push({ slug, level });
      }
      out[cls] = list;
    });
    return out;
  }

  const SKILLS = {
    acr: { name: 'Acrobatics', ability: 'dex' },
    ath: { name: 'Athletics', ability: 'str' },
    blu: { name: 'Bluff', ability: 'cha' },
    com: { name: 'Computers', ability: 'int' },
    cul: { name: 'Culture', ability: 'int', trainedOnly: true },
    dip: { name: 'Diplomacy', ability: 'cha' },
    dis: { name: 'Disguise', ability: 'cha' },
    eng: { name: 'Engineering', ability: 'int', trainedOnly: true },
    int: { name: 'Intimidate', ability: 'cha' },
    lsc: { name: 'Life Science', ability: 'int', trainedOnly: true },
    med: { name: 'Medicine', ability: 'int', trainedOnly: true },
    mys: { name: 'Mysticism', ability: 'wis', trainedOnly: true },
    per: { name: 'Perception', ability: 'wis' },
    phs: { name: 'Physical Science', ability: 'int', trainedOnly: true },
    pil: { name: 'Piloting', ability: 'dex' },
    pro: { name: 'Profession', ability: 'cha', trainedOnly: true, variable: ['cha', 'int', 'wis'] },
    sen: { name: 'Sense Motive', ability: 'wis' },
    sle: { name: 'Sleight of Hand', ability: 'dex', trainedOnly: true },
    ste: { name: 'Stealth', ability: 'dex' },
    sur: { name: 'Survival', ability: 'wis' }
  };
  const ACP_SKILLS = ['acr', 'ath', 'sle', 'ste'];
  const CLASS_SKILL_BONUS = 3;
  const SKILL_FOCUS = { type: 'insight', value: 3, source: 'skill-focus' };
  const BASE_SPEED = 30;

  const charAt = (char, n) => Object.assign({}, char, { levels: levelsOf(char).slice(0, n) });

  function equippedArmor(char, data) {
    const items = (data && data.items) || {};
    const gear = Array.isArray(char && char.gear) ? char.gear : [];
    for (let i = 0; i < gear.length; i++) {
      const g = gear[i];
      const rec = g && g.equipped && Object.prototype.hasOwnProperty.call(items, g.item) ? items[g.item] : null;
      if (rec && rec.armor) return rec.armor;
    }
    return null;
  }

  const gearBulk = (char, data, strScore) => (typeof module !== 'undefined' ? require('./gear.js') : root.SF).bulkState(char, data, strScore);

  function skillRanksOf(char) {
    const ranks = {};
    levelsOf(char).forEach((l) => {
      Object.keys((l && l.skills) || {}).forEach((k) => {
        const n = Number(l.skills[k]);
        if (Number.isFinite(n)) ranks[k] = (ranks[k] || 0) + n;
      });
    });
    return ranks;
  }

  function classSkillSet(char, data) {
    const set = {};
    Object.keys(classLevels(char)).forEach((slug) => {
      const rec = classRec(data, slug);
      ((rec && rec.csk) || []).forEach((k) => { set[k] = true; });
    });
    skillPicks(char, data, 'classSkill').forEach((k) => { set[k] = true; });
    return set;
  }

  function tempAbilityScores(lib, char) {
    const adj = {};
    lib.playModifiers(char).forEach((m) => m.targets.forEach((t) => { if (t.indexOf('ability.') === 0) adj[t.slice(8)] = (adj[t.slice(8)] || 0) + m.value; }));
    return adj;
  }

  function derive(char, data, opts) {
    const lib = typeof module !== 'undefined' ? require('./bonus.js') : root.SF;
    const c = opts && opts.levels !== undefined ? charAt(char, opts.levels) : char;
    const armor = equippedArmor(c, data);
    const scores = baseScores(c, data);
    const preBulk = gearBulk(c, data, scores.str);
    const encumbered = preBulk.state !== 'ok';
    const speedBase = BASE_SPEED + (armor ? armor.speedAdjust || 0 : 0);
    const play = !!(opts && opts.play);
    const tempScores = play ? tempAbilityScores(lib, c) : undefined;
    const resolved = lib.resolve(c, data, { play, state: { encumbered }, derived: { speedBase: BASE_SPEED, speedLand: speedBase } });
    const total = (keys, extra) => lib.stack(resolved.constants
      .filter((m) => m.targets.some((t) => keys.indexOf(t) !== -1))
      .map((m) => ({ type: m.type, value: m.value, source: m.kind + ':' + m.sourceKey }))
      .concat(extra || []));

    const abilities = {};
    ABILITIES.forEach((a) => {
      const score = scores[a] + total(['ability.' + a]);
      abilities[a] = { score, mod: mod(score) };
    });
    const m = (a) => abilities[a].mod;
    const dexForAc = armor && Number.isFinite(armor.dex) ? Math.min(m('dex'), armor.dex) : m('dex');
    const eac = 10 + (armor ? armor.eac || 0 : 0) + dexForAc + total(['eac']);
    const kac = 10 + (armor ? armor.kac || 0 : 0) + dexForAc + total(['kac']);
    const saves = {};
    const saveAbility = { fort: 'con', ref: 'dex', will: 'wis' };
    SAVE_KEYS.forEach((k) => { saves[k] = baseSave(k, c, data) + m(saveAbility[k]) + total([k]); });
    const acp = Math.min(0, (armor ? armor.acp || 0 : 0) + total(['acp']));

    const ranks = skillRanksOf(c);
    const classSkills = classSkillSet(c, data);
    const theme = themeRec(c, data);
    const themeSkill = theme && SKILLS[theme.skill] ? theme.skill : null;
    const focused = skillFocusSkills(c, data);
    const free = freeRanks(c, data);
    const skills = {};
    Object.keys(SKILLS).forEach((k) => {
      const def = SKILLS[k];
      const n = Math.min(charLevel(c), (ranks[k] || 0) + (free[k] || 0) + total(['ranks.' + k]));
      const ability = k === 'pro' && def.variable.indexOf(c.proAbility) !== -1 ? c.proAbility : def.ability;
      const classSkill = !!classSkills[k] || k === themeSkill;
      const themeExtra = (k === themeSkill && classSkills[k] ? [{ type: 'untyped', value: 1 }] : [])
        .concat(focused.indexOf(k) !== -1 ? [SKILL_FOCUS] : []);
      skills[k] = {
        name: def.name,
        ability,
        ranks: n,
        classSkill,
        trainedOnly: !!def.trainedOnly,
        total: n + m(ability) + (classSkill && n >= 1 ? CLASS_SKILL_BONUS : 0)
          + total(['skill.' + k, 'skills.all', 'ability-skills.' + ability], themeExtra)
          + (ACP_SKILLS.indexOf(k) !== -1 ? acp : 0)
      };
    });

    const bulk = gearBulk(c, data, abilities.str.score);
    const sheet = {
      abilities,
      hp: hp(c, data) + total(['hp']),
      sp: sp(c, data, tempScores) + total(['sp']),
      rp: rp(c, data, tempScores) + total(['rp']),
      eac, kac,
      cmd: kac + 8 + total(['cmd']),
      fort: saves.fort, ref: saves.ref, will: saves.will,
      initiative: m('dex') + total(['initiative']),
      speed: speedBase + total(['speed.land', 'speed.all']),
      bab: bab(c, data) + total(['bab']),
      acp,
      skills,
      attacks: [],
      situational: resolved.situational,
      spellAdjust: tempScores,
      bulk
    };
    sheet.attacks = (typeof module !== 'undefined' ? require('./gear.js') : root.SF).attackLines(c, data, sheet, { play });
    return sheet;
  }

  const api = {
    version: 1,
    blankCharacter,
    ABILITIES, POINT_BUY, increaseAt, INCREASE_COUNT,
    mod, baseScores, abilityScores, pointBuyErrors, pointBuyMax, rankMax, classLevels, charLevel,
    bab, baseSave, hp, sp, rp, featSlots, rankBudget,
    spellSlots, connectionSpells, spellListOf, spellSlotsFor, progressionOf, progressionEntries, levelPlan, choiceEntry, poolOf, pickedFor, classFeatures, grantedFeats, grantedAt, skillPicks, skillFocusSkills, freeRanks,
    SKILLS, ACP_SKILLS, charAt, classSkillSet, equippedArmor, skillRanksOf, derive
  };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
