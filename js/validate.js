(function(root){
  const rules = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./rules.js') : root.SF)[k] });

  const gear = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./gear.js') : root.SF)[k] });

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const table = (data, name) => (data && data[name]) || {};
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
    spellBlockers: (char, data, ctx) => spellBlockers(char, data, ctx),
    gearBlockers: (char, data, ctx) => gear.gearBlockers(char, data, ctx)
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

  function ranksWithFree(char, data) {
    const ranks = rules.skillRanksOf(char);
    const free = rules.freeRanks(char, data);
    const cap = rules.charLevel(char);
    Object.keys(free).forEach((k) => { ranks[k] = Math.min(cap, (ranks[k] || 0) + free[k]); });
    return ranks;
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
      ranks: ranksWithFree(char, data),
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
      return { code: 'pool', why: f.name + ' is not an option for ' + (entry.label || entry.choice) };
    }
    if (typeof f.minLevel === 'number' && f.minLevel > ctx.here.classLevel) {
      return { code: 'level', why: 'Requires ' + className(ctx.here.cls, data) + ' level ' + f.minLevel };
    }
    if (!entry.allowKnown && !f.repeatable && ctx.known.indexOf(slug) !== -1) {
      return { code: 'duplicate', why: f.name + ' cannot be taken twice' };
    }
    const unmet = asList(f.needs).filter((need) => !asList(need).some((k) => ctx.has[k]));
    if (unmet.length) {
      const name = (k) => (features[k] || {}).name || k;
      return { code: 'prereq', why: 'Requires ' + unmet.map((need) => asList(need).map(name).join(' or ')).join(', ') };
    }
    const skills = asList(f.needsClassSkill).filter((k) => !ctx.classSkills[k]);
    if (skills.length) return { code: 'prereq', why: 'Requires ' + skills.map((k) => (rules.SKILLS[k] || {}).name || k).join(', ') + ' as a class skill' };
    if (entry.distinct && f[entry.distinct] && ctx.siblings.some((k) => k !== slug && (features[k] || {})[entry.distinct] === f[entry.distinct])) {
      return { code: 'split', why: (entry.label || entry.choice) + ': only one ' + f[entry.distinct] + ' pick at this level' };
    }
    return null;
  }

  function classSkillsOf(char, data) {
    const set = Object.assign({}, rules.classSkillSet(char, data));
    const theme = char.theme && table(data, 'themes')[char.theme];
    if (theme && theme.skill) set[theme.skill] = true;
    return set;
  }

  function hasAt(char, data, levelIndex, entry, upTo) {
    const lvls = levelsOf(char).slice(0, levelIndex + 1).map((l, i) => {
      if (i !== levelIndex || !l) return l;
      const choices = Object.assign({}, l.choices);
      choices[entry.choice] = asList(choices[entry.choice]).slice(0, upTo);
      return Object.assign({}, l, { choices });
    });
    return featureSet(Object.assign({}, char, { levels: lvls }), data);
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

  function choiceProblem(entry, slug, levelIndex, char, data, index, everyOther) {
    const { plan, here } = choicePlan(char, data, levelIndex);
    if (!here) return { code: 'missing', why: 'No level ' + (levelIndex + 1) };
    const picks = asList(here.choices[entry.choice]);
    const upTo = Number.isInteger(index) ? index : picks.indexOf(slug) === -1 ? picks.length : picks.indexOf(slug);
    const asOf = rules.charAt(char, levelIndex + 1);
    return featureProblem(entry, slug, {
      here,
      known: knownBefore(plan, levelIndex, entry, upTo, char, data),
      has: hasAt(char, data, levelIndex, entry, upTo),
      classSkills: classSkillsOf(asOf, data),
      siblings: everyOther || !Number.isInteger(index) ? picks.filter((k, j) => j !== upTo) : picks.slice(0, index)
    }, data);
  }

  function baseClassOf(cls, data) {
    const rec = table(data, 'classes')[cls];
    return rec && rec.enhancedOf ? rec.enhancedOf : String(cls).replace(/_enhanced$/, '');
  }

  function variantMix(cls, levelIndex, char, data) {
    const base = baseClassOf(cls, data);
    const other = levelsOf(char).find((l, j) => j !== levelIndex && l && l.class !== cls && baseClassOf(l.class, data) === base);
    return other ? { code: 'class', why: 'Enhanced and base ' + className(base, data) + ' levels can\'t be mixed' } : null;
  }

  function classAllowed(slug, levelIndex, char, data) {
    if (!has(table(data, 'classes'), slug)) return { ok: false, why: "Class '" + slug + "' no longer exists" };
    const mix = variantMix(slug, levelIndex, char, data);
    return mix ? { ok: false, why: mix.why } : { ok: true };
  }

  function allowed(kind, slug, levelIndex, char, data, slot) {
    if (kind === 'class') return classAllowed(slug, levelIndex, char, data);
    if (kind === 'choice' && slot && typeof slot === 'object' && has(gear.FEAT_CHOICE, slot.id)) {
      const why = gear.featChoiceProblem(char, data, levelIndex, slot.id, slug);
      return why ? { ok: false, why } : { ok: true };
    }
    if (kind === 'choice') {
      const here = rules.levelPlan(char, data)[levelIndex];
      const id = slot && typeof slot === 'object' ? slot.id : slot;
      const pick = here && here.entries.find((e) => e.skillPick === id);
      if (pick) {
        const problem = skillPickProblem(pick, here, rules.levelPlan(char, data), char, slug);
        return problem ? { ok: false, why: problem.why } : { ok: true };
      }
      const entry = here && here.entries.find((e) => e.choice === id);
      if (!entry) return { ok: false, why: 'No ' + id + ' choice at this level' };
      const problem = choiceProblem(entry, slug, levelIndex, char, data, slot && typeof slot === 'object' ? slot.index : undefined, true);
      if (problem) return { ok: false, why: problem.why };
      const text = asList((table(data, 'features')[slug] || {}).needsText);
      return text.length ? { ok: true, why: 'Not checked: ' + text.join(' ') } : { ok: true };
    }
    if (kind === 'item') return gear.itemAllowed(char, data, slug, slot);
    if (kind === 'spell') return spellAllowed(slug, levelIndex, char, data, slot);
    if (kind !== 'feat') return { ok: true };
    const here = asList((levelsOf(char)[levelIndex] || {}).feats);
    const before = Number.isInteger(slot) ? here.slice(0, slot) : here;
    const problem = featProblem(slug, levelIndex, char, data, priorLevelFeats(char, levelIndex).concat(before))
      || (Number.isInteger(slot) ? slotProblem(slotsAt(char, data, levelIndex)[slot], slug, data) : null);
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }

  function spellLevelName(n) {
    return n === 0 ? '0-level' : n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') + '-level';
  }

  function spellCaster(char, data, levelIndex) {
    const here = rules.levelPlan(char, data)[levelIndex];
    const lvl = levelsOf(char)[levelIndex];
    if (!here || !lvl || !rules.spellListOf(here.cls, data)) return null;
    const rec = table(data, 'classes')[here.cls];
    const score = rules.baseScores(char, data, levelIndex + 1)[rec.spellAbility] || 0;
    const slots = rules.spellSlotsFor(char, data, here.cls, here.classLevel, score);
    return { cls: here.cls, key: rules.spellListOf(here.cls, data), classLevel: here.classLevel, ability: rec.spellAbility, score, known: slots.known };
  }

  function connectionSlugs(char, data, levelIndex, cls) {
    const list = rules.connectionSpells(rules.charAt(char, levelIndex + 1), data)[cls] || [];
    return list.map((c) => c.slug);
  }

  function spellsOf(lvl) {
    const spells = (lvl && lvl.spells) || {};
    return { learn: asList(spells.learn), swap: spells.swap };
  }

  function applySwap(held, swap) {
    if (!swap || typeof swap !== 'object') return held;
    const at = held.indexOf(swap.from);
    const next = held.slice();
    if (at !== -1) next.splice(at, 1);
    if (at !== -1 && typeof swap.to === 'string') next.push(swap.to);
    return next;
  }

  function heldBefore(char, data, levelIndex, cls) {
    let held = [];
    levelsOf(char).slice(0, levelIndex).forEach((lvl) => {
      if (!lvl || lvl.class !== cls) return;
      const s = spellsOf(lvl);
      held = applySwap(held, s.swap).concat(s.learn.filter((k) => typeof k === 'string'));
    });
    return held;
  }

  function countAtLevel(held, spells, level) {
    return held.filter((k) => has(spells, k) && spells[k].level === level).length;
  }

  function spellProblem(slug, levelIndex, char, data, held, opts) {
    const spells = table(data, 'spells');
    if (typeof slug !== 'string' || !has(spells, slug)) return { code: 'missing', why: "Spell '" + slug + "' no longer exists" };
    const caster = spellCaster(char, data, levelIndex);
    const spell = spells[slug];
    if (!caster) return { code: 'invalid', why: 'Level ' + (levelIndex + 1) + ' is not a spellcasting class level' };
    const name = className(caster.cls, data);
    if (!spell.allowedClasses || !spell.allowedClasses[caster.key]) return { code: 'class', why: spell.name + ' is not on the ' + name + ' spell list' };
    if (!has(caster.known, spell.level)) {
      return { code: 'level', why: name + ' level ' + caster.classLevel + ' cannot learn ' + spellLevelName(spell.level) + ' spells' };
    }
    if (caster.score < 10 + spell.level) {
      return { code: 'ability', why: 'Requires ' + cap(caster.ability) + ' ' + (10 + spell.level) + ' to learn ' + spellLevelName(spell.level) + ' spells' };
    }
    if (held.indexOf(slug) !== -1) return { code: 'duplicate', why: spell.name + ' is already known' };
    if (connectionSlugs(char, data, levelIndex, caster.cls).indexOf(slug) !== -1) return { code: 'duplicate', why: spell.name + ' is already a connection spell' };
    if (!(opts && opts.swap) && countAtLevel(held, spells, spell.level) >= caster.known[spell.level]) {
      return { code: 'overspent', why: name + ' knows only ' + caster.known[spell.level] + ' ' + spellLevelName(spell.level) + ' spells at level ' + caster.classLevel };
    }
    return null;
  }

  function swapProblem(swap, levelIndex, char, data, held) {
    const spells = table(data, 'spells');
    if (!swap || typeof swap !== 'object' || Array.isArray(swap)) return { code: 'invalid', why: 'A spell swap needs a spell to drop and a spell to learn', ref: undefined };
    if (!has(spells, swap.from)) return { code: 'missing', why: "Spell '" + swap.from + "' no longer exists", ref: swap.from };
    if (swap.from === swap.to) return { code: 'swap', why: 'A swap must replace a spell with a different spell', ref: swap.to };
    if (held.indexOf(swap.from) === -1) return { code: 'swap', why: spells[swap.from].name + ' is not a spell you already know', ref: swap.from };
    const rest = held.filter((k) => k !== swap.from);
    const problem = spellProblem(swap.to, levelIndex, char, data, rest, { swap: true });
    if (problem) return Object.assign({ ref: swap.to }, problem);
    if (spells[swap.to].level !== spells[swap.from].level) return { code: 'swap', why: 'A swap must replace a spell with one of the same level', ref: swap.to };
    return null;
  }

  function spellBlockers(char, data, ctx) {
    const out = [];
    const lvl = levelsOf(char)[ctx.levelIndex];
    const s = spellsOf(lvl);
    const push = (code, msg, ref) => {
      const b = { level: ctx.level, tab: 'spells', code, msg };
      if (ref !== undefined) b.ref = ref;
      out.push(b);
    };
    const caster = spellCaster(char, data, ctx.levelIndex);
    const hasSwap = !!(lvl && lvl.spells && lvl.spells.swap);
    if (!caster) {
      if (s.learn.length || hasSwap) push('invalid', 'Level ' + ctx.level + ' is not a spellcasting class level');
      return out;
    }
    let held = heldBefore(char, data, ctx.levelIndex, caster.cls);
    if (hasSwap) {
      const problem = swapProblem(lvl.spells.swap, ctx.levelIndex, char, data, held);
      if (problem) push(problem.code, problem.why, problem.ref);
      else held = applySwap(held, lvl.spells.swap);
    }
    s.learn.forEach((slug) => {
      const problem = spellProblem(slug, ctx.levelIndex, char, data, held);
      if (problem) push(problem.code, problem.why, slug);
      if (typeof slug === 'string') held = held.concat([slug]);
    });
    const spells = table(data, 'spells');
    Object.keys(caster.known).forEach((l) => {
      const level = Number(l);
      if (caster.score < 10 + level) return;
      const missing = caster.known[l] - countAtLevel(held, spells, level);
      if (missing > 0) push('unspent', 'Learn ' + missing + ' more ' + spellLevelName(level) + ' spell' + (missing === 1 ? '' : 's') + ' at level ' + ctx.level);
    });
    return out;
  }

  function spellAllowed(slug, levelIndex, char, data, slot) {
    const lvl = levelsOf(char)[levelIndex];
    const asked = slot && typeof slot === 'object' ? slot.cls : slot;
    if (!lvl) return { ok: false, why: 'No level ' + (levelIndex + 1) };
    if (typeof asked === 'string' && asked !== lvl.class) return { ok: false, why: 'Level ' + (levelIndex + 1) + ' is a ' + className(lvl.class, data) + ' level' };
    const swapping = !!(slot && typeof slot === 'object' && slot.swap);
    let held = heldBefore(char, data, levelIndex, lvl.class);
    if (swapping) {
      held = held.filter((k) => k !== slot.from);
    } else {
      const swap = lvl.spells && lvl.spells.swap;
      if (swap && !swapProblem(swap, levelIndex, char, data, held)) held = applySwap(held, swap).filter((k) => k !== slug);
      held = held.concat(spellsOf(lvl).learn.filter((k) => typeof k === 'string' && k !== slug));
    }
    const problem = spellProblem(slug, levelIndex, char, data, held, { swap: swapping });
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }

  function earlierSkillPicks(entry, here, plan) {
    const earlier = [];
    plan.slice(0, here.levelIndex).forEach((p) => {
      if (p.cls === here.cls && p.entries.some((e) => e.skillPick === entry.skillPick)) asList(p.choices[entry.skillPick]).forEach((k) => earlier.push(k));
    });
    return earlier;
  }

  function skillPickProblem(entry, here, plan, char, k) {
    const name = (rules.SKILLS[k] || {}).name || k;
    if (!has(rules.SKILLS, k)) return { code: 'invalid', why: "Skill '" + k + "' does not exist" };
    if (Array.isArray(entry.from) && entry.from.indexOf(k) === -1) return { code: 'pool', why: name + ' is not an option for ' + entry.label };
    if (earlierSkillPicks(entry, here, plan).indexOf(k) !== -1) return { code: 'duplicate', why: name + ' is already chosen for ' + entry.label };
    const ranks = rules.skillRanksOf(rules.charAt(char, here.levelIndex + 1));
    if (entry.minRanks && (ranks[k] || 0) < entry.minRanks) return { code: 'ranks', why: entry.label + ' needs ' + entry.minRanks + ' rank in ' + name };
    return null;
  }

  function skillProblems(entry, here, plan, char, push) {
    const picks = asList(here.choices[entry.skillPick]);
    picks.forEach((k, j) => {
      const name = (rules.SKILLS[k] || {}).name || k;
      let problem = skillPickProblem(entry, here, plan, char, k);
      if ((!problem || problem.code === 'ranks') && picks.indexOf(k) !== j) problem = { code: 'duplicate', why: name + ' is already chosen for ' + entry.label };
      if (problem) push(problem.code, problem.why, k);
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
      if (known.indexOf(id) !== -1 || has(gear.FEAT_CHOICE, id)) return;
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
      } else {
        const first = levels.findIndex((l) => l && baseClassOf(l.class, data) === baseClassOf(lv.class, data));
        const mix = first < i && levels[first].class !== lv.class ? variantMix(lv.class, i, char, data) : null;
        if (mix) push(n, 'class', mix.code, mix.why, lv.class);
      }

      const increases = asList(lv.increases);
      if (rules.increaseAt.indexOf(n) !== -1) {
        const distinct = increases.filter((a, j) => isAbility(a) && increases.indexOf(a) === j);
        if (increases.length !== rules.INCREASE_COUNT || distinct.length !== rules.INCREASE_COUNT) {
          push(n, 'abilities', 'increases', 'Choose ' + rules.INCREASE_COUNT + ' different ability scores to raise at level ' + n);
        }
      } else if (increases.length) {
        push(n, 'abilities', 'increases', 'Ability increases are only gained at levels ' + rules.increaseAt.join(', '));
      }

      const picked = lv.skills || {};
      let spent = 0;
      const through = rules.skillRanksOf(rules.charAt(char, n));
      const free = rules.freeRanks(rules.charAt(char, n), data);
      Object.keys(picked).forEach((k) => {
        const r = Number(picked[k]);
        if (!has(rules.SKILLS, k)) { push(n, 'skills', 'missing', "Skill '" + k + "' does not exist", k); return; }
        if (!Number.isInteger(r) || r < 0) { push(n, 'skills', 'invalid', 'Ranks in ' + rules.SKILLS[k].name + ' must be a whole number of 0 or more', k); return; }
        spent += r;
        const held = through[k] + (free[k] || 0);
        if (held > n) {
          const extra = free[k] ? ' (' + free[k] + ' free from your specialization)' : '';
          push(n, 'skills', 'rank-cap', rules.SKILLS[k].name + ' has ' + held + ' ranks' + extra + ' at level ' + n, k);
        }
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
      Object.keys(gear.FEAT_CHOICE).forEach((featSlug) => {
        const count = taken.filter((k) => k === featSlug).length;
        if (!count) return;
        const picks = asList(lv.choices && lv.choices[featSlug]);
        const label = gear.FEAT_CHOICE[featSlug].label;
        const noun = gear.FEAT_CHOICE[featSlug].kind === 'special' ? 'special weapon' : 'weapon type';
        if (picks.length < count) push(n, 'feats', 'unspent', 'Choose a ' + noun + ' for ' + label, featSlug);
        picks.forEach((v) => {
          const why = gear.featChoiceProblem(char, data, i, featSlug, v);
          if (why && typeof v === 'string' && v !== '') push(n, 'feats', 'invalid-choice', why, featSlug);
          else if (why) push(n, 'feats', 'unspent', 'Choose a ' + noun + ' for ' + label, featSlug);
        });
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
