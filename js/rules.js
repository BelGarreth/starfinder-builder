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

  const api = {
    version: 1,
    ABILITIES, POINT_BUY, increaseAt,
    mod, baseScores, pointBuyErrors, classLevels, charLevel,
    bab, baseSave, hp, sp, rp, featSlots, rankBudget
  };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
