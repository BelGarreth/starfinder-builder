(function(root){
  const rules = typeof require !== 'undefined' ? require('./rules.js') : root.SF;

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const table = (data, name) => (data && data[name]) || {};
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const INCREASE_COUNT = 4;
  const REPEATABLE_FEATS = ['skill_focus', 'weapon_focus_(combat)', 'weapon_specialization_(combat)', 'improved_critical_(combat)'];
  const REPEATABLE_TEXT = /multiple times|more than once|each time you (?:take|select|gain) this feat/i;
  const PROFICIENCY = {
    'basic melee weapons': { cls: ['weapon', 'bmelee'], feat: 'basic_melee_weapon_proficiency_(combat)' },
    'advanced melee weapons': { cls: ['weapon', 'amelee'], feat: 'advanced_melee_weapon_proficiency_(combat)' },
    'small arms': { cls: ['weapon', 'sarms'], feat: 'small_arm_proficiency_(combat)' },
    longarms: { cls: ['weapon', 'larms'], feat: 'longarm_proficiency_(combat)' },
    'heavy weapons': { cls: ['weapon', 'hweap'], feat: 'heavy_weapon_proficiency_(combat)' },
    'sniper weapons': { cls: ['weapon', 'snipe'], feat: 'sniper_weapon_proficiency_(combat)' },
    grenades: { cls: ['weapon', 'gren'], feat: 'grenade_proficiency_(combat)' },
    'light armor': { cls: ['armor', 'lgt'], feat: 'light_armor_proficiency_(combat)' },
    'heavy armor': { cls: ['armor', 'hvy'], feat: 'heavy_armor_proficiency_(combat)' },
    'powered armor': { cls: ['armor', 'pwr'], feat: 'powered_armored_proficiency_(combat)' },
    shields: { cls: ['armor', 'shl'], feat: 'shield_proficiency_(combat)' }
  };

  const hooks = {
    choiceBlockers: () => [],
    spellBlockers: () => [],
    gearBlockers: () => []
  };

  function featsOf(char) {
    const out = [];
    levelsOf(char).forEach((l) => asList(l && l.feats).forEach((f) => out.push(f)));
    return out;
  }

  function featureSet(char, data) {
    const set = {};
    const add = (k) => { if (typeof k === 'string') set[k] = true; };
    const race = table(data, 'races')[char.race];
    if (race) asList(race.coreTraits).forEach(add);
    const theme = char.theme && table(data, 'themes')[char.theme];
    const features = table(data, 'features');
    const total = rules.charLevel(char);
    if (theme) asList(theme.features).forEach((k) => {
      const f = features[k];
      if (!f || typeof f.level !== 'number' || f.level <= total) add(k);
    });
    levelsOf(char).forEach((l) => {
      const choices = (l && l.choices) || {};
      Object.keys(choices).forEach((id) => asList(choices[id]).forEach(add));
    });
    const levels = rules.classLevels(char);
    Object.keys(levels).forEach((cls) => {
      const prog = table(data, 'progressions')[cls];
      const granted = prog && prog.features;
      if (granted) Object.keys(granted).forEach((n) => { if (Number(n) <= levels[cls]) asList(granted[n]).forEach(add); });
    });
    return set;
  }

  function hasProficiency(group, char, data, feats) {
    const p = PROFICIENCY[group];
    if (!p) return true;
    if (feats.indexOf(p.feat) !== -1) return true;
    return Object.keys(rules.classLevels(char)).some((slug) => {
      const rec = table(data, 'classes')[slug];
      return !!(rec && rec.prof && rec.prof[p.cls[0]] && rec.prof[p.cls[0]][p.cls[1]]);
    });
  }

  function checkState(char, data) {
    return {
      char,
      data,
      scores: rules.baseScores(char, data),
      bab: rules.bab(char, data),
      level: rules.charLevel(char),
      classLevels: rules.classLevels(char),
      feats: featsOf(char),
      ranks: rules.skillRanksOf(char),
      features: featureSet(char, data)
    };
  }

  function holds(check, st) {
    switch (check.k) {
      case 'ability': return (st.scores[check.a] || 0) >= check.min;
      case 'bab': return st.bab >= check.min;
      case 'level': return st.level >= check.min;
      case 'classLevel': return (st.classLevels[check.cls] || 0) >= check.min;
      case 'feat': return st.feats.indexOf(check.feat) !== -1;
      case 'ranks': return (st.ranks[check.skill] || 0) >= check.min;
      case 'any': return check.of.some((c) => holds(c, st));
      case 'proficiency': return hasProficiency(check.group, st.char, st.data, st.feats);
      case 'feature': return !!st.features[check.feature];
      case 'race': return !!(table(st.data, 'races')[st.char.race] && table(st.data, 'races')[st.char.race].base === check.race);
      default: return true;
    }
  }

  function phrase(check, data) {
    switch (check.k) {
      case 'ability': return cap(check.a) + ' ' + check.min;
      case 'bab': return 'base attack bonus +' + check.min;
      case 'level': return 'character level ' + check.min;
      case 'classLevel': return ((table(data, 'classes')[check.cls] || {}).name || check.cls) + ' level ' + check.min;
      case 'feat': return ((table(data, 'feats')[check.feat] || {}).name || check.feat);
      case 'feature': return ((table(data, 'features')[check.feature] || {}).name || check.feature);
      case 'race': return cap(check.race);
      case 'proficiency': return 'proficiency with ' + check.group;
      case 'ranks': return check.min + ' ranks in ' + ((rules.SKILLS[check.skill] || {}).name || check.skill);
      case 'any': {
        const ofRanks = check.of.every((c) => c.k === 'ranks' && c.min === check.of[0].min);
        if (ofRanks) return check.of[0].min + ' ranks in ' + check.of.map((c) => (rules.SKILLS[c.skill] || {}).name || c.skill).join(' or ');
        return check.of.map((c) => phrase(c, data)).join(' or ');
      }
      default: return '';
    }
  }

  function unmetPrereq(prereq, st) {
    const checks = prereq && Array.isArray(prereq.all) ? prereq.all : [];
    const unmet = checks.filter((c) => c.k !== 'text' && !holds(c, st)).map((c) => phrase(c, st.data)).filter(Boolean);
    return unmet.length ? 'Requires ' + unmet.join(', ') : null;
  }

  function isRepeatable(slug, rec) {
    return REPEATABLE_FEATS.indexOf(slug) !== -1 || REPEATABLE_TEXT.test((rec && rec.summary) || '');
  }

  function featProblem(slug, levelIndex, char, data, priorFeats) {
    const feats = table(data, 'feats');
    if (!has(feats, slug)) return { code: 'missing', why: "Feat '" + slug + "' no longer exists" };
    if (priorFeats.indexOf(slug) !== -1 && !isRepeatable(slug, feats[slug])) {
      return { code: 'duplicate', why: feats[slug].name + ' cannot be taken twice' };
    }
    const lvls = levelsOf(char).slice(0, levelIndex + 1);
    if (!lvls[levelIndex]) return null;
    lvls[levelIndex] = Object.assign({}, lvls[levelIndex], { feats: [] });
    const asOf = Object.assign({}, char, { levels: lvls });
    const st = checkState(asOf, data);
    st.feats = priorFeats.slice();
    const why = unmetPrereq(feats[slug].prereq, st);
    return why ? { code: 'prereq', why } : null;
  }

  function priorLevelFeats(char, levelIndex) {
    return featsOf(Object.assign({}, char, { levels: levelsOf(char).slice(0, levelIndex) }));
  }

  function allowed(kind, slug, levelIndex, char, data) {
    if (kind !== 'feat') return { ok: true };
    const problem = featProblem(slug, levelIndex, char, data, priorLevelFeats(char, levelIndex));
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }

  function validate(char, data) {
    const out = [];
    const push = (level, tab, code, msg, ref) => {
      const b = { level, tab, code, msg };
      if (ref !== undefined) b.ref = ref;
      out.push(b);
    };
    const abilities = (char && char.abilities) || {};
    const isAbility = (a) => rules.ABILITIES.indexOf(a) !== -1;
    const levels = levelsOf(char);

    const race = table(data, 'races')[char && char.race];
    if (!race) push(null, 'char', 'missing', "Race '" + (char && char.race) + "' no longer exists", char && char.race);
    else if ((race.abilityMods || []).some((x) => x[1] === 'any') && !isAbility(abilities.raceAny)) {
      push(null, 'abilities', 'missing', 'Choose the ability for your racial bonus', 'raceAny');
    }
    if (char && char.theme) {
      const theme = table(data, 'themes')[char.theme];
      if (!theme) push(null, 'char', 'missing', "Theme '" + char.theme + "' no longer exists", char.theme);
      else if ((char.theme === 'themeless' || !isAbility(theme.ability)) && !isAbility(abilities.themeAny)) {
        push(null, 'abilities', 'missing', 'Choose the ability for your theme bonus', 'themeAny');
      }
    }
    rules.pointBuyErrors(char, data).forEach((msg) => push(null, 'abilities', 'pointbuy', msg));
    if (!levels.length) push(null, 'class', 'unspent', 'Choose a class for level 1');

    const slots = rules.featSlots(char, data);
    const features = table(data, 'features');
    const priorFeats = [];

    levels.forEach((lvl, i) => {
      const n = i + 1;
      const lv = lvl || {};
      if (!has(table(data, 'classes'), lv.class)) {
        push(n, 'class', 'missing', "Class '" + lv.class + "' no longer exists", lv.class);
      }

      const increases = asList(lv.increases);
      if (rules.increaseAt.indexOf(n) !== -1) {
        const distinct = increases.filter((a, j) => isAbility(a) && increases.indexOf(a) === j);
        if (increases.length !== INCREASE_COUNT || distinct.length !== INCREASE_COUNT) {
          push(n, 'abilities', 'increases', 'Choose ' + INCREASE_COUNT + ' different ability scores to raise at level ' + n);
        }
      } else if (increases.length) {
        push(n, 'abilities', 'increases', 'Ability increases are only gained at levels ' + rules.increaseAt.join(', '));
      }

      const picked = lv.skills || {};
      let spent = 0;
      const through = rules.skillRanksOf(rules.charAt(char, n));
      Object.keys(picked).forEach((k) => {
        const r = Number(picked[k]);
        if (!has(rules.SKILLS, k)) { push(n, 'skills', 'missing', "Skill '" + k + "' does not exist", k); return; }
        if (!Number.isInteger(r) || r < 0) { push(n, 'skills', 'invalid', 'Ranks in ' + rules.SKILLS[k].name + ' must be a whole number of 0 or more', k); return; }
        spent += r;
        if (through[k] > n) push(n, 'skills', 'rank-cap', rules.SKILLS[k].name + ' has ' + through[k] + ' ranks at level ' + n, k);
      });
      const budget = rules.rankBudget(i, char, data);
      if (spent > budget) push(n, 'skills', 'overspent', 'Level ' + n + ' spends ' + spent + ' of ' + budget + ' skill ranks');
      else if (spent < budget) push(n, 'skills', 'unspent', 'Level ' + n + ' has ' + (budget - spent) + ' unspent skill ranks');

      const taken = asList(lv.feats);
      const available = slots.filter((s) => s.level === n).length;
      taken.forEach((slug) => {
        const problem = featProblem(slug, i, char, data, priorFeats);
        if (problem) push(n, 'feats', problem.code, problem.why, slug);
        priorFeats.push(slug);
      });
      if (taken.length > available) push(n, 'feats', 'overspent', 'Level ' + n + ' takes ' + taken.length + ' feats with ' + available + ' slots');
      else if (taken.length < available) push(n, 'feats', 'unspent', 'Level ' + n + ' has ' + (available - taken.length) + ' empty feat slots');

      const choices = lv.choices || {};
      Object.keys(choices).forEach((id) => asList(choices[id]).forEach((k) => {
        if (typeof k === 'string' && !has(features, k)) push(n, 'class', 'missing', "Feature '" + k + "' no longer exists", k);
      }));

      const ctx = { level: n, levelIndex: i };
      [hooks.choiceBlockers, hooks.spellBlockers].forEach((hook) => hook(char, data, ctx).forEach((b) => out.push(b)));
      if (n === levels.length) hooks.gearBlockers(char, data, ctx).forEach((b) => out.push(b));
    });

    const items = table(data, 'items');
    (Array.isArray(char && char.gear) ? char.gear : []).forEach((g) => {
      if (g && !has(items, g.item)) push(null, 'gear', 'missing', "Item '" + g.item + "' no longer exists", g.item);
    });
    return out;
  }

  const api = { validate, allowed, hooks, unmetPrereq };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
