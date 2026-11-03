(function(root){
  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const POINT_BUY = { base: 10, points: 10, maxAtCreation: 18 };
  const increaseAt = [5, 10, 15, 20];
  const SAVE_KEYS = ['fort', 'ref', 'will'];

  const mod = (score) => Math.floor((score - 10) / 2);
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const classRec = (data, slug) => (data.classes && data.classes[slug]) || null;
  const raceRec = (char, data) => (data.races && data.races[char.race]) || null;
  const themeRec = (char, data) => (char.theme && data.themes && data.themes[char.theme]) || null;
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
    ABILITIES.forEach((a) => { scores[a] = POINT_BUY.base + (pb[a] || 0); });
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

  function pointBuyErrors(char, data) {
    const errors = [];
    const pb = pbOf(char);
    let spent = 0;
    ABILITIES.forEach((a) => {
      const n = pb[a] || 0;
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
    levelsOf(char).forEach((l) => { out[l.class] = (out[l.class] || 0) + 1; });
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

  function sp(char, data) {
    const conMod = mod(baseScores(char, data).con);
    return sumClasses(char, data, (c, n) => (c.sp + conMod) * n);
  }

  function rp(char, data) {
    const scores = baseScores(char, data);
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

  function featSlots(char, data) {
    const slots = [];
    const total = charLevel(char);
    for (let lvl = 1; lvl <= total; lvl += 2) slots.push({ level: lvl, kind: 'general', source: 'character level' });
    if (total >= 1 && isHuman(char, data)) slots.push({ level: 1, kind: 'bonus', source: 'human' });
    const progressions = (data && data.progressions) || {};
    const taken = {};
    levelsOf(char).forEach((lvl, i) => {
      taken[lvl.class] = (taken[lvl.class] || 0) + 1;
      const prog = progressions[lvl.class];
      const grants = prog && Array.isArray(prog.bonusFeats) ? prog.bonusFeats : [];
      if (grants.indexOf(taken[lvl.class]) !== -1) slots.push({ level: i + 1, kind: 'bonus', source: lvl.class });
    });
    return slots.sort((a, b) => a.level - b.level || (a.kind === b.kind ? 0 : a.kind === 'general' ? -1 : 1));
  }

  function rankBudget(levelIndex, char, data) {
    const lvl = levelsOf(char)[levelIndex];
    const rec = lvl && classRec(data, lvl.class);
    const intMod = mod(baseScores(char, data, levelIndex + 1).int);
    return Math.max(1, (rec ? rec.ranks : 0) + intMod) + (isHuman(char, data) ? 1 : 0);
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
  const BASE_SPEED = 30;
  const BULK_LIGHT = 0.1;

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

  function bulkOf(raw) {
    if (raw === 'L') return BULK_LIGHT;
    const n = Number(raw);
    return raw === '-' || !Number.isFinite(n) ? 0 : n;
  }

  function bulkState(char, data, strScore) {
    const items = (data && data.items) || {};
    const gear = Array.isArray(char && char.gear) ? char.gear : [];
    let carried = 0;
    gear.forEach((g) => {
      if (!g || g.carried === false || !Object.prototype.hasOwnProperty.call(items, g.item)) return;
      carried += bulkOf(items[g.item].bulk) * (Number.isFinite(g.qty) ? g.qty : 1);
    });
    carried = Math.round(carried * 10) / 10;
    const state = carried > strScore ? 'overburdened' : carried > strScore / 2 ? 'encumbered' : 'ok';
    return { carried, limit: strScore, state };
  }

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
    return set;
  }

  function derive(char, data, opts) {
    const lib = typeof module !== 'undefined' ? require('./bonus.js') : root.SF;
    const c = opts && opts.levels !== undefined ? charAt(char, opts.levels) : char;
    const armor = equippedArmor(c, data);
    const scores = baseScores(c, data);
    const preBulk = bulkState(c, data, scores.str);
    const encumbered = preBulk.state !== 'ok';
    const speedBase = BASE_SPEED + (armor ? armor.speedAdjust || 0 : 0);
    const resolved = lib.resolve(c, data, { state: { encumbered }, derived: { speedBase: BASE_SPEED, speedLand: speedBase } });
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
    const skills = {};
    Object.keys(SKILLS).forEach((k) => {
      const def = SKILLS[k];
      const n = ranks[k] || 0;
      const ability = k === 'pro' && def.variable.indexOf(c.proAbility) !== -1 ? c.proAbility : def.ability;
      const classSkill = !!classSkills[k] || k === themeSkill;
      const themeExtra = k === themeSkill && classSkills[k] ? [{ type: 'untyped', value: 1 }] : [];
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

    const bulk = bulkState(c, data, abilities.str.score);
    return {
      abilities,
      hp: hp(c, data) + total(['hp']),
      sp: sp(c, data) + total(['sp']),
      rp: rp(c, data) + total(['rp']),
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
      bulk
    };
  }

  const api = {
    version: 1,
    ABILITIES, POINT_BUY, increaseAt,
    mod, baseScores, pointBuyErrors, classLevels, charLevel,
    bab, baseSave, hp, sp, rp, featSlots, rankBudget,
    SKILLS, ACP_SKILLS, charAt, equippedArmor, skillRanksOf, bulkState, derive
  };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
