(function(root){
  const U = root.SFUI = root.SFUI || {};
  const SF = () => root.SF;
  const { esc, sign, own, asList, levelsOf, table, btn, input, select, fld, pickRow, pickTable, matches, className } = U;
  const ABILITY_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

  function raceFamilies(data) {
    const fam = {};
    const order = [];
    Object.keys(table(data, 'races')).forEach((slug) => {
      const r = data.races[slug];
      if (!fam[r.base]) { fam[r.base] = []; order.push(r.base); }
      fam[r.base].push(slug);
    });
    return { fam, order };
  }

  function baseRaceRec(data, base, slugs) {
    return own(table(data, 'races'), base) || Object.assign({}, data.races[slugs[0]], { name: cap(base) });
  }

  function baseClasses(data) {
    return Object.keys(table(data, 'classes')).filter((k) => !data.classes[k].enhancedOf);
  }

  const enhancedOf = (data, base) => Object.keys(table(data, 'classes')).find((k) => data.classes[k].enhancedOf === base) || null;

  function enhancedOn(C, UI, data, base) {
    const held = levelsOf(C).find((l) => l && (l.class === base || (own(table(data, 'classes'), l.class) || {}).enhancedOf === base));
    if (held) return held.class !== base;
    return !!(UI.enh && UI.enh[base]);
  }

  function raceCard(C, UI, data) {
    const { fam, order } = raceFamilies(data);
    const current = own(table(data, 'races'), C.race);
    const rows = order.map((base) => {
      const rec = baseRaceRec(data, base, fam[base]);
      const on = !!current && current.base === base;
      const note = own(table(data, 'races'), base) ? '' : 'pick a variant';
      return pickRow(rec, { act: 'race', a: base, on, extra: note });
    });
    let variant = '';
    if (current) {
      const slugs = fam[current.base];
      const opts = slugs.map((k) => [k, data.races[k].variant || 'Standard']);
      const traits = asList(current.coreTraits).map((k) => (own(table(data, 'features'), k) || {}).name || k);
      const mods = asList(current.abilityMods).map(([n, a]) => sign(n) + ' ' + (a === 'any' ? 'any one' : a.toUpperCase())).join(', ');
      variant = '<div class="row c" style="margin-top:10px">' + fld('Variant', select('race', C.race, opts)) + '<span class="note">' + esc(current.name) + ': ' + esc(mods) + ', ' + esc(current.hp) + ' HP</span></div>'
        + (traits.length ? '<p class="note">Racial traits: ' + esc(traits.join(', ')) + '</p>' : '') + traitPickers(C, data);
    }
    return '<div class="card"><h2>Race</h2>' + pickTable(rows, 'tall') + variant + '</div>';
  }

  function traitPickers(C, data) {
    const entries = levelsOf(C).length ? SF().entriesAt(C, data, 0).filter((e) => e.rec.kind === 'race') : [];
    return entries.map((e) => U.paramPicker(C, data, 0, e)).join('');
  }

  function themeCard(C, UI, data) {
    const q = UI.themeQ || '';
    const rows = Object.keys(table(data, 'themes')).filter((k) => matches(data.themes[k], q) || k === C.theme).map((k) => {
      const t = data.themes[k];
      const skill = (SF().SKILLS[t.skill] || {}).name || t.skill;
      const extra = esc((t.ability && ABILITY_NAME[t.ability] ? '+' + (t.mod || 1) + ' ' + t.ability.toUpperCase() : '+1 any') + (skill ? ', ' + skill : ''));
      return pickRow(t, { act: 'theme', a: k, on: C.theme === k, extra });
    });
    return '<div class="card"><h2>Theme</h2><div class="row">' + fld('Search themes', input(C, UI, '$themeQ', { ph: 'Name' })) + '</div>' + pickTable(rows, 'tall') + '</div>';
  }

  function classCard(C, UI, data) {
    const next = levelsOf(C).length;
    const rows = baseClasses(data).map((base) => {
      const enh = enhancedOf(data, base);
      const on = enh && enhancedOn(C, UI, data, base);
      const slug = on ? enh : base;
      const ans = next >= 20 ? { ok: false, why: 'Level 20 is the maximum' } : SF().allowed('class', slug, next, C, data);
      const toggle = enh ? '<label class="note tog"><input type="checkbox" data-act="enh" data-a="' + esc(base) + '"' + (on ? ' checked' : '') + '> Enhanced</label>' : '';
      return pickRow(data.classes[slug], { act: 'addLevel', a: slug, ans, label: 'Add level ' + (next + 1), extra: toggle });
    });
    return '<div class="card"><h2>Classes</h2><p class="note">Add a level of any class. The Enhanced toggle switches every level of that class between the original and the Enhanced rules.</p>' + pickTable(rows) + '</div>';
  }

  function levelsCard(C, UI, data) {
    const lv = levelsOf(C);
    if (!lv.length) return '<div class="card"><h2>Levels</h2><p class="note">No levels yet. Add a level 1 class above.</p></div>';
    const slugs = Object.keys(table(data, 'classes'));
    const plan = SF().levelPlan(C, data);
    const rows = lv.map((l, i) => {
      const opts = slugs.map((k) => {
        const ans = SF().allowed('class', k, i, C, data);
        return [k, data.classes[k].name + (ans.ok ? '' : ' (' + ans.why + ')'), !ans.ok && k !== l.class];
      });
      if (!own(table(data, 'classes'), l.class)) opts.unshift([l.class, "Missing class '" + l.class + "'", true]);
      const last = i === lv.length - 1 ? btn('removeLevel', 'Remove last level', { c: 'sm x' }) : '';
      return '<tr><td class="num">' + (i + 1) + '</td><td>' + select('levels.' + i + '.class', l.class, opts) + '</td><td class="mute">' + esc(className(data, l.class)) + ' ' + esc((plan[i] || {}).classLevel || '') + '</td><td class="acts">' + last + '</td></tr>';
    });
    return '<div class="card"><h2>Levels</h2><div class="scroll"><table class="t"><thead><tr><th class="num">Level</th><th>Class</th><th>Class level</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
  }

  U.tabChar = function (C, UI, data) {
    return '<div class="card"><div class="g2">' + fld('Character name', input(C, UI, 'name', { ph: 'Name' })) + fld('Notes', input(C, UI, 'notes', { t: 'ta', rows: 2 })) + '</div></div>'
      + '<div class="g2"><div>' + raceCard(C, UI, data) + '</div><div>' + themeCard(C, UI, data) + '</div></div>'
      + classCard(C, UI, data) + levelsCard(C, UI, data);
  };

  function abilityAnyOptions() {
    return [['', '(choose)']].concat(SF().ABILITIES.map((a) => [a, ABILITY_NAME[a]]));
  }

  U.tabAbilities = function (C, UI, data, ctx) {
    const rules = SF();
    const pb = (C.abilities && C.abilities.pb) || {};
    const creation = rules.baseScores(C, data, 0);
    const now = rules.baseScores(C, data);
    const spent = rules.ABILITIES.reduce((n, a) => n + (Number(pb[a]) || 0), 0);
    const rows = rules.ABILITIES.map((a) => {
      const s = ctx.sheet.abilities[a];
      const adj = creation[a] - rules.POINT_BUY.base - (Number(pb[a]) || 0);
      return '<tr><td><b>' + ABILITY_NAME[a] + '</b></td><td class="num">' + rules.POINT_BUY.base + '</td><td class="num">' + (adj ? sign(adj) : '') + '</td><td>' + input(C, UI, 'abilities.pb.' + a, { t: 'n', min: 0, max: rules.pointBuyMax(C, data, a), c: 's' })
        + '</td><td class="num">' + (now[a] - creation[a] ? sign(now[a] - creation[a]) : '') + '</td><td class="num"><b>' + esc(s.score) + '</b></td><td class="num brass">' + esc(sign(s.mod)) + '</td></tr>';
    });
    const race = own(table(data, 'races'), C.race);
    const theme = own(table(data, 'themes'), C.theme);
    const anyRace = race && asList(race.abilityMods).some((m) => m[1] === 'any');
    const anyTheme = theme && (C.theme === 'themeless' || rules.ABILITIES.indexOf(theme.ability) === -1);
    const picks = (anyRace ? fld('Racial bonus ability', select('abilities.raceAny', C.abilities && C.abilities.raceAny, abilityAnyOptions())) : '')
      + (anyTheme ? fld('Theme bonus ability', select('abilities.themeAny', C.abilities && C.abilities.themeAny, abilityAnyOptions())) : '');
    const left = rules.POINT_BUY.points - spent;
    const pointsCard = '<div class="card"><h2>Point buy</h2><p class="note">Every score starts at ' + rules.POINT_BUY.base + '. Spend ' + rules.POINT_BUY.points + ' points; no score above ' + rules.POINT_BUY.maxAtCreation + ' at creation. Points left: <b class="' + (left < 0 ? 'bad' : 'ok') + '">' + esc(left) + '</b></p>'
      + (picks ? '<div class="row">' + picks + '</div>' : '')
      + '<div class="scroll"><table class="t"><thead><tr><th>Ability</th><th class="num">Base</th><th class="num">Race/theme</th><th>Points</th><th class="num">Increases</th><th class="num">Score</th><th class="num">Mod</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
    const incLevels = rules.increaseAt.filter((n) => n <= levelsOf(C).length);
    const incCard = incLevels.length ? '<div class="card"><h2>Ability increases</h2><p class="note">At each of these levels raise ' + rules.INCREASE_COUNT + ' different scores by 2, or by 1 if the score is already 17 or more.</p>'
      + incLevels.map((n) => {
        const chosen = asList(C.levels[n - 1].increases);
        const full = chosen.length >= rules.INCREASE_COUNT;
        return '<div class="row c"><b>Level ' + n + '</b>' + rules.ABILITIES.map((a) => {
          const on = chosen.indexOf(a) !== -1;
          return '<label class="note tog"><input type="checkbox" data-act="inc" data-a="' + (n - 1) + '" data-b2="' + a + '"' + (on ? ' checked' : '') + (!on && full ? ' disabled title="' + rules.INCREASE_COUNT + ' already chosen"' : '') + '> ' + a.toUpperCase() + '</label>';
        }).join('') + '<span class="mute">' + esc(chosen.length) + ' of ' + rules.INCREASE_COUNT + '</span></div>';
      }).join('') + '</div>' : '';
    return pointsCard + incCard;
  };

  function choicePicker(C, UI, data, i, entry, here) {
    const rules = SF();
    const id = entry.choice;
    const count = entry.count || 1;
    const picks = asList(here.choices[id]);
    const pool = rules.poolOf(entry, data, here.cls);
    const features = table(data, 'features');
    const cleared = JSON.parse(JSON.stringify(C));
    if (cleared.levels[i].choices) delete cleared.levels[i].choices[id];
    const rows = pool.map((slug) => {
      const on = picks.indexOf(slug) !== -1;
      let ans;
      if (!on && count === 1 && picks.length) ans = rules.allowed('choice', slug, i, cleared, data, { id });
      else if (!on && picks.length >= count) ans = { ok: false, why: 'Unpick one to choose another' };
      else ans = rules.allowed('choice', slug, i, C, data, { id });
      return pickRow(own(features, slug) || { name: slug }, { act: 'pick', a: i, b: slug, cc: id, on, ans });
    });
    const stale = picks.filter((k) => pool.indexOf(k) === -1).map((k) => pickRow(own(features, k) || { name: k }, { act: 'pick', a: i, b: k, cc: id, on: true, ans: { ok: false, why: 'Not an option here' } }));
    return '<h3>' + esc(entry.label || id) + ' <span class="mute">(' + esc(picks.length) + ' of ' + esc(count) + ')</span></h3>' + pickTable(stale.concat(rows), 'tall');
  }

  function skillPicker(C, UI, data, i, entry, here) {
    const rules = SF();
    const SKILLS = rules.SKILLS;
    const count = entry.count || 1;
    const picks = asList(here.choices[entry.skillPick]);
    const boxes = Object.keys(SKILLS).map((k) => {
      const on = picks.indexOf(k) !== -1;
      let ans = rules.allowed('choice', k, i, C, data, { id: entry.skillPick });
      if (ans.ok && !on && count > 1 && picks.length >= count) ans = { ok: false, why: 'Unpick one to choose another' };
      const why = !ans.ok ? ' <span class="why">' + esc(ans.why) + '</span>' : '';
      return '<label class="' + (ans.ok || on ? '' : 'dis') + '"><input type="' + (count === 1 ? 'radio' : 'checkbox') + '" data-act="skillPick" data-a="' + i + '" data-b2="' + esc(k) + '" data-c="' + esc(entry.skillPick) + '"' + (on ? ' checked' : '') + (!ans.ok && !on ? ' disabled' : '') + '> ' + esc(SKILLS[k].name) + why + '</label>';
    }).join('');
    const notes = [entry.classSkill ? 'they become class skills' : '', entry.skillFocus ? 'they gain the Skill Focus bonus' : '', entry.minRanks ? 'needs ' + entry.minRanks + ' rank in the skill' : ''].filter(Boolean).join('; ');
    return '<h3>' + esc(entry.label || entry.skillPick) + ' <span class="mute">(' + esc(picks.length) + ' of ' + esc(entry.count || 1) + ')</span></h3>' + (notes ? '<p class="note">' + esc(cap(notes)) + '</p>' : '') + '<div class="csgrid">' + boxes + '</div>';
  }

  function featureLine(rec, tag) {
    return pickRow(rec, { noButton: true, extra: tag ? esc(tag) : '' });
  }

  U.tabClass = function (C, UI, data, ctx) {
    const rules = SF();
    const lv = levelsOf(C);
    if (!lv.length) return '<div class="card"><p class="note">Add a class level on the Character tab first.</p></div>';
    const i = U.levelIndex(C, UI);
    const here = rules.levelPlan(C, data)[i];
    const features = table(data, 'features');
    const granted = rules.classFeatures(C, data).filter((f) => f.levelIndex === i && f.via === 'grant');
    const fixed = [];
    const parts = [];
    here.entries.forEach((e) => {
      if (e.fixed) fixed.push(featureLine(features[e.fixed] || { name: e.fixed }, 'gained'));
      else if (e.fixedOf) {
        const g = granted.map((f) => featureLine(features[f.slug], 'from your ' + e.fixedOf + ' pick'));
        if (g.length) g.forEach((x) => fixed.push(x));
        else parts.push('<p class="note">Your ' + esc(e.fixedOf) + ' pick grants a feature here once it is chosen.</p>');
      } else if (e.choice) parts.push(choicePicker(C, UI, data, i, e, here));
      else if (e.skillPick) parts.push(skillPicker(C, UI, data, i, e, here));
      else if (e.abilityPick) parts.push(fld(e.label || 'Ability', select('levels.' + i + '.choices.' + e.abilityPick, here.choices[e.abilityPick], abilityAnyOptions())));
      else if (e.bonusFeat) parts.push('<p class="note">Bonus feat slot' + (e.pool === 'combat' ? ' (combat feats only)' : '') + '. ' + btn('goto', 'Fill it on the Feats tab', { c: 'sm', a: 'feats', b: i }) + '</p>');
    });
    const classFeatureEntries = rules.entriesAt(C, data, i).filter((e) => e.rec.kind === 'class');
    classFeatureEntries.forEach((e) => parts.push('<h3>' + esc(e.rec.name) + ' <span class="mute">(' + esc(e.rec.param.kind === 'skill' ? 'skills' : 'energy types') + ')</span></h3>' + U.paramPicker(C, data, i, e)));
    rules.classFeatures(C, data).filter((f) => f.levelIndex === i && features[f.slug].param && features[f.slug].param.derive).forEach((f) => {
      const skills = rules.valuesFor({ rec: features[f.slug], cls: f.cls }, C, data).map((k) => rules.SKILLS[k].name);
      parts.push('<p class="note">' + esc(features[f.slug].name) + ': ' + (skills.length ? 'applies to ' + esc(skills.join(' and ')) + ' from your connection.' : 'your connection fixes no skills (Zeitgeist changes daily, Shaper picks its two above), so it adds nothing to the sheet yet.') + '</p>');
    });
    const head = '<h2>Level ' + (i + 1) + ': ' + esc(className(data, here.cls)) + ' ' + esc(here.classLevel) + '</h2>';
    return U.levelTabs(C, UI, data, ctx, 'class') + '<div class="card">' + head
      + (fixed.length ? '<h3>Features gained</h3>' + pickTable(fixed) : '<p class="note">No new fixed features at this level.</p>')
      + parts.join('') + '</div>';
  };

  Object.assign(U, { ABILITY_NAME, raceFamilies, baseClasses, enhancedOf, enhancedOn });
})(this);
