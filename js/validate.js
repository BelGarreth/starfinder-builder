(function(root){
  const rules = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./rules.js') : root.SF)[k] });

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const table = (data, name) => (data && data[name]) || {};
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const INCREASE_COUNT = 4;
  const REPEATABLE_FEATS = ['skill_focus', 'weapon_focus_(combat)', 'weapon_specialization_(combat)'];
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
    choiceBlockers: (char, data, ctx) => choiceBlockers(char, data, ctx),
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
    rules.classFeatures(char, data).forEach((f) => add(f.slug));
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

  function slotsAt(char, data, levelIndex) {
    return rules.featSlots(char, data).filter((s) => s.level === levelIndex + 1);
  }

  function slotProblem(slot, slug, data) {
    if (!slot || !slot.pool || !has(table(data, 'feats'), slug)) return null;
    const feat = table(data, 'feats')[slug];
    const who = cap(className(slot.source, data));
    if (slot.pool === 'combat') return feat.combat ? null : { code: 'pool', why: who + ' bonus feats must be combat feats' };
    if (Array.isArray(slot.pool) && slot.pool.indexOf(slug) === -1) {
      return { code: 'pool', why: who + ' bonus feat must be ' + slot.pool.map((k) => (table(data, 'feats')[k] || {}).name || k).join(' or ') };
    }
    return null;
  }

  function className(cls, data) {
    return (table(data, 'classes')[cls] || {}).name || String(cls);
  }

  function choicePlan(char, data, levelIndex) {
    const plan = rules.levelPlan(char, data);
    return { plan, here: plan[levelIndex] || null };
  }

  function featureProblem(entry, slug, ctx, data) {
    const features = table(data, 'features');
    if (typeof slug !== 'string' || !has(features, slug)) return { code: 'missing', why: "Feature '" + slug + "' no longer exists" };
    const f = features[slug];
    if (rules.poolOf(entry, data, ctx.here.cls).indexOf(slug) === -1) {
      return { code: 'pool', why: f.name + ' is not a ' + (entry.label || entry.choice) + ' option for ' + className(ctx.here.cls, data) };
    }
    if (typeof f.minLevel === 'number' && f.minLevel > ctx.here.classLevel) {
      return { code: 'level', why: 'Requires ' + className(ctx.here.cls, data) + ' level ' + f.minLevel };
    }
    if (!entry.allowKnown && !f.repeatable && ctx.known.indexOf(slug) !== -1) {
      return { code: 'duplicate', why: f.name + ' cannot be taken twice' };
    }
    return null;
  }

  function knownBefore(plan, levelIndex, entry, upTo, char, data) {
    const known = [];
    plan.slice(0, levelIndex).forEach((p) => p.entries.forEach((e) => {
      if (e.choice && !e.allowKnown) asList(p.choices[e.choice]).forEach((k) => known.push(k));
    }));
    const here = plan[levelIndex];
    if (here) asList(here.choices[entry.choice]).slice(0, upTo).forEach((k) => known.push(k));
    const lower = Object.assign({}, char, { levels: levelsOf(char).slice(0, levelIndex) });
    rules.classFeatures(lower, data).filter((f) => f.via !== 'choice').forEach((f) => known.push(f.slug));
    return known;
  }

  function choiceProblem(entry, slug, levelIndex, char, data, index) {
    const { plan, here } = choicePlan(char, data, levelIndex);
    if (!here) return { code: 'missing', why: 'No level ' + (levelIndex + 1) };
    const picks = asList(here.choices[entry.choice]);
    const upTo = Number.isInteger(index) ? index : picks.indexOf(slug) === -1 ? picks.length : picks.indexOf(slug);
    return featureProblem(entry, slug, { here, known: knownBefore(plan, levelIndex, entry, upTo, char, data) }, data);
  }

  function allowed(kind, slug, levelIndex, char, data, slot) {
    if (kind === 'choice') {
      const here = rules.levelPlan(char, data)[levelIndex];
      const id = slot && typeof slot === 'object' ? slot.id : slot;
      const entry = here && here.entries.find((e) => e.choice === id);
      if (!entry) return { ok: false, why: 'No ' + id + ' choice at this level' };
      const problem = choiceProblem(entry, slug, levelIndex, char, data, slot && typeof slot === 'object' ? slot.index : undefined);
      return problem ? { ok: false, why: problem.why } : { ok: true };
    }
    if (kind !== 'feat') return { ok: true };
    const here = asList((levelsOf(char)[levelIndex] || {}).feats);
    const before = Number.isInteger(slot) ? here.slice(0, slot) : here;
    const problem = featProblem(slug, levelIndex, char, data, priorLevelFeats(char, levelIndex).concat(before))
      || (Number.isInteger(slot) ? slotProblem(slotsAt(char, data, levelIndex)[slot], slug, data) : null);
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }

  function skillProblems(entry, here, plan, char, push) {
    const picks = asList(here.choices[entry.skillPick]);
    const earlier = [];
    plan.slice(0, here.levelIndex).forEach((p) => {
      if (p.cls === here.cls && p.entries.some((e) => e.skillPick === entry.skillPick)) asList(p.choices[entry.skillPick]).forEach((k) => earlier.push(k));
    });
    const ranks = rules.skillRanksOf(rules.charAt(char, here.levelIndex + 1));
    picks.forEach((k, j) => {
      const name = (rules.SKILLS[k] || {}).name || k;
      if (!has(rules.SKILLS, k)) push('invalid', "Skill '" + k + "' does not exist", k);
      else if (Array.isArray(entry.from) && entry.from.indexOf(k) === -1) push('pool', name + ' is not a ' + entry.label + ' option', k);
      else if (earlier.indexOf(k) !== -1 || picks.indexOf(k) !== j) push('duplicate', name + ' is already chosen for ' + entry.label, k);
      else if (entry.minRanks && (ranks[k] || 0) < entry.minRanks) push('ranks', entry.label + ' needs ' + entry.minRanks + ' rank in ' + name, k);
    });
    return picks.length;
  }

  function choiceBlockers(char, data, ctx) {
    const out = [];
    const plan = rules.levelPlan(char, data);
    const here = plan[ctx.levelIndex];
    if (!here) return out;
    const n = ctx.level;
    const push = (code, msg, ref) => {
      const b = { level: n, tab: 'class', code, msg };
      if (ref !== undefined) b.ref = ref;
      out.push(b);
    };
    const known = [];
    here.entries.forEach((entry) => {
      let count = 0;
      const need = entry.count || 1;
      if (entry.choice) {
        const picks = asList(here.choices[entry.choice]);
        count = picks.length;
        picks.forEach((slug, j) => {
          const problem = choiceProblem(entry, slug, ctx.levelIndex, char, data, j);
          if (problem) push(problem.code, problem.why, slug);
        });
      } else if (entry.skillPick) {
        count = skillProblems(entry, here, plan, char, push);
      } else if (entry.abilityPick) {
        const picks = asList(here.choices[entry.abilityPick]);
        count = picks.length;
        picks.forEach((a) => { if (rules.ABILITIES.indexOf(a) === -1) push('invalid', "Ability '" + a + "' does not exist", a); });
      } else {
        return;
      }
      const label = entry.label || entry.choice || entry.skillPick || entry.abilityPick;
      if (count < need) push('unspent', 'Choose ' + (need - count) + ' more ' + label + ' at level ' + n);
      else if (count > need) push('overspent', 'Level ' + n + ' picks ' + count + ' ' + label + ' but only ' + need + ' allowed');
      known.push(entry.choice || entry.skillPick || entry.abilityPick);
    });
    const features = table(data, 'features');
    Object.keys(here.choices).forEach((id) => {
      if (known.indexOf(id) !== -1) return;
      asList(here.choices[id]).forEach((k) => {
        if (typeof k !== 'string' || !has(features, k)) push('missing', "Feature '" + k + "' no longer exists", k);
        else push('invalid', features[k].name + ' is not a choice at ' + className(here.cls, data) + ' level ' + here.classLevel, k);
      });
    });
    return out;
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
      const here = slots.filter((s) => s.level === n);
      const available = here.length;
      taken.forEach((slug, j) => {
        const problem = featProblem(slug, i, char, data, priorFeats) || slotProblem(here[j], slug, data);
        if (problem) push(n, 'feats', problem.code, problem.why, slug);
        priorFeats.push(slug);
      });
      if (taken.length > available) push(n, 'feats', 'overspent', 'Level ' + n + ' takes ' + taken.length + ' feats with ' + available + ' slots');
      else if (taken.length < available) push(n, 'feats', 'unspent', 'Level ' + n + ' has ' + (available - taken.length) + ' empty feat slots');

      const ctx = { level: n, levelIndex: i };
      [hooks.choiceBlockers, hooks.spellBlockers].forEach((hook) => hook(char, data, ctx).forEach((b) => out.push(b)));
    });
    const last = { level: levels.length, levelIndex: levels.length - 1 };
    hooks.gearBlockers(char, data, last).forEach((b) => out.push(b));

    const items = table(data, 'items');
    (Array.isArray(char && char.gear) ? char.gear : []).forEach((g) => {
      if (g && !has(items, g.item)) push(null, 'gear', 'missing', "Item '" + g.item + "' no longer exists", g.item);
    });
    return out;
  }

  const api = { validate, allowed, hooks, unmetPrereq, choiceBlockers };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
