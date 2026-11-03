(function(root){
  const U = root.SFUI = root.SFUI || {};
  const SF = () => root.SF;
  const { esc, sign, own, asList, levelsOf, table, btn, input, select, fld, pickRow, pickTable, capped, matches, className } = U;

  const noLevels = '<div class="card"><p class="note">Add a class level on the Character tab first.</p></div>';

  U.tabSkills = function (C, UI, data, ctx) {
    const rules = SF();
    if (!levelsOf(C).length) return noLevels;
    const i = U.levelIndex(C, UI);
    const picked = C.levels[i].skills || {};
    const budget = rules.rankBudget(i, C, data);
    const spent = Object.keys(picked).reduce((n, k) => n + (Number(picked[k]) || 0), 0);
    const rows = Object.keys(rules.SKILLS).map((k) => {
      const s = ctx.sheet.skills[k];
      const untrained = s.trainedOnly && s.ranks === 0;
      const pro = k === 'pro' ? ' ' + select('proAbility', C.proAbility || s.ability, rules.SKILLS.pro.variable.map((a) => [a, a.toUpperCase()]), { c: 'sm' }) : '';
      return '<tr><td>' + esc(s.name) + (s.trainedOnly ? ' <span class="mute" title="Trained only">*</span>' : '') + '</td><td class="mute">' + esc(s.ability.toUpperCase()) + pro + '</td><td>' + (s.classSkill ? '<span class="ok">class</span>' : '') + '</td><td>'
        + input(C, UI, 'levels.' + i + '.skills.' + k, { t: 'n', min: 0, max: rules.rankMax(i, C, data, k), z: true, c: 's' }) + '</td><td class="num">' + esc(s.ranks) + '</td><td class="num"><b>' + esc(untrained ? '—' : sign(s.total)) + '</b></td></tr>';
    });
    const left = budget - spent;
    return U.levelTabs(C, UI, data, ctx, 'skills') + '<div class="card"><h2>Skill ranks at level ' + (i + 1) + '</h2><p class="note">Ranks this level: ' + esc(spent) + ' of ' + esc(budget)
      + ' (<b class="' + (left < 0 ? 'bad' : left > 0 ? 'brass' : 'ok') + '">' + esc(left) + ' left</b>). Ranks in a skill can\'t exceed your character level. * trained only: shown as — until it has a rank.</p>'
      + '<div class="scroll"><table class="t"><thead><tr><th>Skill</th><th>Ability</th><th>Class</th><th>Ranks here</th><th class="num">Total ranks</th><th class="num">Bonus</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
  };

  function slotLabel(slot, data) {
    if (slot.kind === 'general') return 'Feat (character level ' + slot.level + ')';
    if (slot.source === 'human') return 'Human bonus feat';
    const who = className(data, slot.source);
    if (slot.pool === 'combat') return who + ' bonus feat (combat)';
    if (Array.isArray(slot.pool)) return who + ' bonus feat (' + slot.pool.map((k) => (own(table(data, 'feats'), k) || {}).name || k).join(' or ') + ')';
    return who + ' bonus feat';
  }

  function featChoiceSelect(C, data, i, j, slug) {
    const rules = SF();
    const def = own(rules.FEAT_CHOICE, slug);
    const feats = asList(C.levels[i].feats);
    const k = feats.slice(0, j).filter((f) => f === slug).length;
    const value = asList((C.levels[i].choices || {})[slug])[k];
    const values = def.kind === 'special'
      ? Object.keys(table(data, 'items')).filter((x) => data.items[x].weapon && data.items[x].weapon.type === 'special').map((x) => [x, data.items[x].name])
      : Object.keys(rules.TYPE_NAME).map((t) => [t, rules.TYPE_NAME[t]]);
    const opts = [['', def.kind === 'special' ? '(choose a special weapon)' : '(choose a weapon type)']].concat(values.map(([v, label]) => {
      const ans = rules.allowed('choice', v, i, C, data, { id: slug });
      return [v, label + (ans.ok ? '' : ' (' + ans.why + ')'), !ans.ok && v !== value];
    }));
    return '<div class="row c">' + fld(def.label + ' choice', select(null, value, opts, { sel: 'featChoice', a: i, cc: j })) + '</div>';
  }

  function featBrowser(C, UI, data, i, j) {
    const rules = SF();
    const feats = table(data, 'feats');
    const q = UI.featQ || '';
    const cat = UI.featCat || 'all';
    const current = asList(C.levels[i].feats)[j];
    const found = Object.keys(feats).filter((k) => matches(feats[k], q) && (cat === 'all' || (cat === 'combat') === !!feats[k].combat));
    const list = U.eligibleOnly(UI, found, (k) => rules.allowed('feat', k, i, C, data, j), (k) => current === k);
    const out = capped(list, (k) => {
      const f = feats[k];
      const ans = rules.allowed('feat', k, i, C, data, j);
      const extra = esc((f.combat ? 'combat' : '') + (f.prereqText ? (f.combat ? ' · ' : '') + 'Prerequisites: ' + f.prereqText : ''));
      return pickRow(f, { act: 'takeFeat', a: i, b: k, cc: j, on: current === k, ans, label: 'Take', extra });
    });
    const cats = [['all', 'All feats'], ['combat', 'Combat'], ['general', 'Non-combat']];
    return '<div class="card"><h2>Choose for slot ' + (j + 1) + '</h2><div class="row">' + fld('Search feats', input(C, UI, '$featQ', { ph: 'Name' })) + fld('Category', select('$featCat', cat, cats)) + '</div>' + U.hideToggle(UI)
      + '<p class="note">' + esc(out.count) + ' feats. Ones you can\'t take yet are greyed out with the reason.</p>' + pickTable(out.rows, 'tall') + out.note + '</div>';
  }

  U.tabFeats = function (C, UI, data, ctx) {
    const rules = SF();
    if (!levelsOf(C).length) return noLevels;
    const i = U.levelIndex(C, UI);
    const slots = rules.featSlots(C, data).filter((s) => s.level === i + 1);
    const feats = asList(C.levels[i].feats);
    const all = table(data, 'feats');
    const tabs = U.levelTabs(C, UI, data, ctx, 'feats');
    const granted = rules.grantedAt(C, data, i).map((slug) => {
      const rec = own(all, slug) || { name: slug };
      return '<tr><td><div class="note">' + esc(className(data, C.levels[i].class)) + ' bonus feat (granted)</div><b>' + esc(rec.name) + '</b> ' + U.aon(own(all, slug)) + (rec.summary ? '<div class="note">' + esc(rec.summary) + '</div>' : '') + '</td><td class="acts"></td></tr>';
    });
    const grantedCard = granted.length ? '<div class="card"><h2>Granted at level ' + (i + 1) + '</h2><div class="scroll"><table class="t pick"><tbody>' + granted.join('') + '</tbody></table></div></div>' : '';
    if (!slots.length && !feats.length) return tabs + grantedCard + '<div class="card"><p class="note">No feat slots at level ' + (i + 1) + '.</p></div>';
    const count = Math.max(slots.length, feats.length);
    const chosen = Number.isInteger(UI.featSlot) && UI.featSlot <= feats.length && UI.featSlot < count;
    const target = chosen ? UI.featSlot : feats.length < count ? feats.length : -1;
    const rows = [];
    for (let j = 0; j < count; j++) {
      const slug = feats[j];
      const label = slots[j] ? slotLabel(slots[j], data) : 'Extra feat (no slot)';
      const rec = slug ? own(all, slug) || { name: "Missing feat '" + slug + "'" } : null;
      const acts = [];
      if (slug) acts.push(btn('featSlot', 'Change', { c: 'sm' + (target === j ? ' pri' : ''), a: j }));
      if (slug && j === feats.length - 1) acts.push(btn('dropFeat', 'Remove', { c: 'sm x', a: i }));
      if (!slug && j === feats.length) acts.push(btn('featSlot', 'Choose', { c: 'sm' + (target === j ? ' pri' : ''), a: j }));
      if (!slug && j > feats.length) acts.push('<span class="mute">Fill slot ' + (feats.length + 1) + ' first</span>');
      const body = rec ? '<b>' + esc(rec.name) + '</b> ' + U.aon(own(all, slug)) + (rec.summary ? '<div class="note">' + esc(rec.summary) + '</div>' : '') : '<span class="mute">Empty</span>';
      const held = feats.slice(0, j).filter((f) => f === slug).length;
      const entry = slug && !own(rules.FEAT_CHOICE, slug) ? rules.entriesAt(C, data, i, slug).find((e) => e.k === held) : null;
      const choice = slug && own(rules.FEAT_CHOICE, slug) ? featChoiceSelect(C, data, i, j, slug) : entry ? U.paramPicker(C, data, i, entry) : '';
      rows.push('<tr><td><div class="note">' + esc(label) + '</div>' + body + choice + '</td><td class="acts">' + acts.join(' ') + '</td></tr>');
    }
    const browser = target >= 0 ? featBrowser(C, UI, data, i, target) : '';
    return tabs + grantedCard + '<div class="card"><h2>Feats at level ' + (i + 1) + '</h2><div class="scroll"><table class="t pick"><tbody>' + rows.join('') + '</tbody></table></div></div>' + browser;
  };

  function heldSpells(C, i, cls) {
    let held = [];
    levelsOf(C).slice(0, i).forEach((l) => {
      if (!l || l.class !== cls) return;
      const s = l.spells || {};
      if (s.swap && typeof s.swap === 'object') {
        const at = held.indexOf(s.swap.from);
        if (at !== -1) { held.splice(at, 1); if (typeof s.swap.to === 'string') held.push(s.swap.to); }
      }
      held = held.concat(asList(s.learn).filter((k) => typeof k === 'string'));
    });
    return held;
  }

  function slotsCard(C, data) {
    const rules = SF();
    const slots = rules.spellSlots(C, data);
    const conn = rules.connectionSpells(C, data);
    return Object.keys(slots).map((cls) => {
      const known = slots[cls].known;
      const perDay = slots[cls].perDay;
      const levels = Object.keys(known).sort((a, b) => a - b);
      const head = levels.map((l) => '<th class="num">' + esc(l) + '</th>').join('');
      const conns = asList(conn[cls]).map((c) => esc((own(table(data, 'spells'), c.slug) || { name: c.slug }).name) + ' (' + esc(c.level) + ')');
      return '<div class="card"><h2>' + esc(className(data, cls)) + ' spells</h2><div class="scroll"><table class="t"><thead><tr><th>Spell level</th>' + head + '</tr></thead><tbody>'
        + '<tr><td>Known</td>' + levels.map((l) => '<td class="num">' + esc(known[l]) + '</td>').join('') + '</tr>'
        + '<tr><td>Per day</td>' + levels.map((l) => '<td class="num">' + esc(l === '0' ? '∞' : perDay[l] || 0) + '</td>').join('') + '</tr></tbody></table></div>'
        + (conns.length ? '<p class="note">Connection spells (not counted as known): ' + conns.join(', ') + '</p>' : '') + '</div>';
    }).join('');
  }

  U.tabSpells = function (C, UI, data, ctx) {
    const rules = SF();
    if (!levelsOf(C).length) return noLevels;
    const i = U.levelIndex(C, UI);
    const lvl = C.levels[i];
    const tabs = U.levelTabs(C, UI, data, ctx, 'spells');
    const key = rules.spellListOf(lvl.class, data);
    if (!key) return tabs + slotsCard(C, data) + '<div class="card"><p class="note">Level ' + (i + 1) + ' is a ' + esc(className(data, lvl.class)) + ' level, which learns no spells.</p></div>';
    const spells = table(data, 'spells');
    const learn = asList(lvl.spells && lvl.spells.learn);
    const swap = lvl.spells && lvl.spells.swap;
    const held = heldSpells(C, i, lvl.class);
    const from = swap ? swap.from : (UI.swapFrom || {})[i];
    const learned = learn.map((k) => '<span class="pill on">' + esc((own(spells, k) || { name: k }).name) + ' ' + btn('learn', '×', { c: 'sm x', a: i, b: k }) + '</span>').join(' ');
    const swapOpts = [['', '(no swap)']].concat(held.map((k) => [k, (own(spells, k) || { name: k }).name]));
    const swapLine = held.length ? '<div class="row c">' + fld('Swap out a known spell', select(null, from || '', swapOpts, { sel: 'swapFrom', a: i }))
      + (swap && swap.to ? '<span class="note">Swapping ' + esc((own(spells, swap.from) || { name: swap.from }).name) + ' for <b>' + esc((own(spells, swap.to) || { name: swap.to }).name) + '</b></span>' : from ? '<span class="note">Pick the replacement below</span>' : '') + '</div>' : '';
    const q = UI.spellQ || '';
    const lvF = UI.spellLvl === undefined ? 'all' : String(UI.spellLvl);
    const listF = UI.spellList || 'class';
    const found = Object.keys(spells).filter((k) => {
      const s = spells[k];
      return matches(s, q) && (lvF === 'all' || String(s.level) === lvF) && (listF === 'all' || (s.allowedClasses && s.allowedClasses[key]));
    }).sort((a, b) => spells[a].level - spells[b].level || (spells[a].name < spells[b].name ? -1 : 1));
    const swapping = !!from && !(swap && swap.to);
    const answerSpell = (k) => (swapping ? rules.allowed('spell', k, i, C, data, { cls: lvl.class, swap: true, from }) : rules.allowed('spell', k, i, C, data));
    const list = U.eligibleOnly(UI, found, answerSpell, (k) => !swapping && learn.indexOf(k) !== -1);
    const out = capped(list, (k) => {
      const s = spells[k];
      const extra = esc('level ' + s.level + (s.school ? ' · ' + s.school : ''));
      if (swapping) {
        const ans = answerSpell(k);
        return pickRow(s, { act: 'swapTo', a: i, b: k, ans, label: 'Swap in', extra });
      }
      const on = learn.indexOf(k) !== -1;
      return pickRow(s, { act: 'learn', a: i, b: k, on, ans: on ? { ok: true } : rules.allowed('spell', k, i, C, data), label: 'Learn', onLabel: 'Learned', extra });
    });
    const lvOpts = [['all', 'All levels']].concat([0, 1, 2, 3, 4, 5, 6].map((n) => [String(n), 'Level ' + n]));
    return tabs + slotsCard(C, data) + '<div class="card"><h2>Spells learned at level ' + (i + 1) + '</h2>' + (learned || '<p class="note">None yet.</p>') + swapLine
      + '<div class="row">' + fld('Search spells', input(C, UI, '$spellQ', { ph: 'Name' })) + fld('Spell level', select('$spellLvl', lvF, lvOpts)) + fld('List', select('$spellList', listF, [['class', className(data, lvl.class) + ' list'], ['all', 'All spells']])) + '</div>' + U.hideToggle(UI)
      + pickTable(out.rows, 'tall') + out.note + '</div>';
  };

  Object.assign(U, { heldSpells, slotLabel });
})(this);
