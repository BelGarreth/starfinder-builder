(function(root){
  const H = root.SFCHAR;
  if (!H) return;
  const SF = () => root.SF;
  const U = () => root.SFUI;
  const esc = (s) => U().esc(s);

  const TEMPLATE = 43;
  const FEAT_ROWS = 44;
  const WEAPON_ROWS = 6;
  const ARMOR_ROWS = 4;
  const EQUIP_ROWS = 19;
  const AUG_ROWS = 20;
  const CORE_SKILLS = 20;
  const FREE_SKILLS = 42;
  const MAX_LEVEL = 20;
  const MARK = '-- Added by the Starfinder builder --';
  const UNMATCHED_HEAD = 'Imported from Myth-Weavers, not matched:';
  const ABILITY_FIELD = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };
  const ABBR = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };
  const SAVES = [['fort', 'fortitude', 'con'], ['ref', 'reflex', 'dex'], ['will', 'will', 'wis']];
  const IDENTITY_TEXT = [['player', 'Player'], ['gender', 'Gender'], ['age', 'Age'], ['height', 'Height'], ['weight', 'Weight'], ['deity', 'Deity'], ['alignment', 'Alignment'],
    ['homeworld', 'Homeworld'], ['campaign', 'Campaign'], ['eyes_color', 'Eyes'], ['hair_color', 'Hair'], ['skin_color', 'Skin'], ['experience', 'Experience']];
  const LINE = { feats: 'More feats', weapons: 'More weapons', armor: 'More armor', equip: 'More equipment', aug: 'More augmentations', ranks: 'Skill ranks', attach: 'Attachments', spells: 'Spells known' };

  const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };

  const SEED = (() => {
    const k = ['name', 'player', 'class', 'race', 'theme', 'size', 'gender', 'age', 'height', 'weight', 'deity', 'alignment', 'homeworld', 'campaign',
      'eyes_color', 'hair_color', 'skin_color', 'experience', 'next_level', 'xp_change', 'xp_speed',
      'hp', 'max_hp', 'stam', 'max_stam', 'res', 'max_res', 'hp_nonlethal', 'hp_damage_reduction', 'hp_spell_resistance',
      'ac_cmac', 'init_dex', 'init_total', 'possessions_worth', 'possessions_weight', 'augmentations_worth', 'augmentations_weight',
      'load_encumbered_load', 'load_overburdened_load', 'movespeed_move', 'movespeed_fly', 'movespeed_swim', 'total_ranks',
      '__txt_statblock', '__txt_other_notes', '__txt_private_notes'];
    Object.keys(ABILITY_FIELD).forEach((a) => ['_score', '_mod', '_temp_score', '_temp_mod'].forEach((s) => k.push(ABILITY_FIELD[a] + s)));
    ['eac', 'kac'].forEach((ac) => ['armor', 'dex', 'dodge', 'natural', 'deflect', 'misc', 'total'].forEach((s) => k.push(ac + '_' + s)));
    SAVES.forEach(([, f, a]) => [a, 'base', 'magic', 'misc', 'temp', 'total'].forEach((s) => k.push(f + '_' + s)));
    [['mab', 'str'], ['rab', 'dex'], ['tab', 'str']].forEach(([p, a]) => ['ab', 'base', 'misc', 'temp', a].forEach((s) => k.push(p + '_' + s)));
    range(1, WEAPON_ROWS).forEach((n) => ['name', 'ab', 'dmg', 'crit', 'type', 'size', 'usage', 'cap', 'special'].concat(n > 1 ? ['range'] : []).forEach((s) => k.push('wpn' + n + '_' + s)));
    range(1, ARMOR_ROWS).forEach((n) => ['_name', 'type', 'eac_bonus', 'kac_bonus', 'max_dex', 'chk_pen', 'speed', 'upg'].forEach((s) => k.push('protect_' + n + s)));
    range(1, CORE_SKILLS).forEach((n) => ['name', 'abil', 'abil_mod', 'skill_mod'].concat(n <= 2 ? ['rank', 'misc', 'acp'] : []).forEach((s) => k.push('skill_' + n + '_' + s)));
    range(CORE_SKILLS + 1, FREE_SKILLS).forEach((n) => k.push('skill_' + n + '_name'));
    range(1, FEAT_ROWS).forEach((n) => k.push('feat_' + n));
    range(1, 18).forEach((n) => k.push('language_' + n));
    range(1, EQUIP_ROWS).forEach((n) => k.push('equip' + n + '_'));
    range(1, AUG_ROWS).forEach((n) => k.push('aug' + n + '_'));
    ['equip1_', 'aug1_'].forEach((p) => ['loc', 'level', 'worth', 'weight'].forEach((s) => k.push(p + s)));
    range(1, 6).forEach((n) => { k.push('__txt_character_' + n); k.push('__txt_character_' + n + '_name'); });
    return k;
  })();

  function expandFamilies(keys) {
    const fam = {};
    const out = {};
    keys.forEach((k) => {
      const m = /^(.*?)(\d+)(.*)$/.exec(k);
      if (!m) { out[k] = true; return; }
      const f = (fam[m[1]] = fam[m[1]] || { idx: {}, suf: {} });
      f.idx[m[2]] = true;
      f.suf[m[3]] = true;
    });
    Object.keys(fam).forEach((p) => {
      const n = Object.keys(fam[p].idx).map(Number);
      range(Math.min.apply(null, n), Math.max.apply(null, n)).forEach((i) => Object.keys(fam[p].suf).forEach((s) => { out[p + i + s] = true; }));
    });
    return Object.keys(out);
  }

  const KEYS = expandFamilies(SEED);
  const KEY_SET = {};
  KEYS.forEach((k) => { KEY_SET[k] = true; });

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const own = (o, k) => (has(o, k) ? o[k] : undefined);
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const table = (data, name) => (data && data[name]) || {};
  const sign = (n) => U().sign(n);
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const stripParen = (s) => String(s).replace(/\s*\([^()]*\)\s*$/, '').trim();
  const lastParen = (s) => { const m = /\(([^()]*)\)\s*$/.exec(String(s)); return m ? m[1].trim() : null; };
  const BULK_LIGHT = 0.1;
  const bulkOf = (raw) => (raw === 'L' || raw === 'l' ? BULK_LIGHT : Number.isFinite(Number(raw)) && raw !== '' && raw !== '-' ? Number(raw) : 0);
  const qtyOf = (g) => (Number.isInteger(g.qty) && g.qty >= 1 ? g.qty : 1);
  const packs = (rec, g) => Math.ceil(qtyOf(g) / (Number(rec.perPack) > 1 ? Number(rec.perPack) : 1));
  const round2 = (n) => Math.round(n * 100) / 100;

  const indexes = typeof WeakMap === 'function' ? new WeakMap() : null;

  function buildIndex(tbl) {
    const full = {};
    const short = {};
    Object.keys(tbl).forEach((slug) => {
      const name = tbl[slug] && tbl[slug].name;
      if (!name) return;
      const f = norm(name);
      if (!has(full, f)) full[f] = slug;
      const s = norm(stripParen(name));
      (short[s] = short[s] || []).push(slug);
    });
    return { full, short, tbl };
  }

  function indexFor(data, name) {
    const tbl = table(data, name);
    let byData = indexes ? indexes.get(data) : null;
    if (!byData) { byData = {}; if (indexes && data && typeof data === 'object') indexes.set(data, byData); }
    if (!byData[name]) byData[name] = buildIndex(tbl);
    return byData[name];
  }

  function exact(idx, s) {
    const n = norm(s);
    if (!n) return null;
    if (has(idx.full, n)) return idx.full[n];
    const list = own(idx.short, n);
    return list && list.length === 1 ? list[0] : null;
  }

  function lookup(idx, s) {
    let name = String(s || '').trim();
    let detail = '';
    for (let i = 0; i < 3 && name; i++) {
      const hit = exact(idx, name);
      if (hit) return { slug: hit, detail };
      const p = lastParen(name);
      if (p === null) break;
      if (!detail) detail = p;
      name = stripParen(name);
    }
    return null;
  }

  function fuzzy(idx, s, preferBase) {
    const hit = lookup(idx, s);
    if (hit) return hit;
    const want = words(s);
    if (!want.length) return null;
    const found = Object.keys(idx.tbl).filter((slug) => {
      const have = words(idx.tbl[slug].name);
      return want.every((w) => have.indexOf(w) !== -1);
    });
    if (found.length === 1) return { slug: found[0], detail: '' };
    if (preferBase) {
      const base = found.filter((slug) => !idx.tbl[slug].variant);
      if (base.length === 1) return { slug: base[0], detail: '' };
    }
    return null;
  }

  function featList(C, data) {
    const rules = SF();
    const feats = table(data, 'feats');
    const out = [];
    U().levelsOf(C).forEach((l, i) => {
      const seen = {};
      rules.grantedAt(C, data, i).forEach((slug) => out.push((own(feats, slug) || { name: slug }).name));
      asList(l.feats).forEach((slug) => {
        const k = seen[slug] || 0;
        seen[slug] = k + 1;
        const detail = H.featDetail(C, data, i, slug, k);
        out.push((own(feats, slug) || { name: slug }).name + (detail ? ' (' + detail + ')' : ''));
      });
    });
    return out;
  }

  function featureList(C, data) {
    const rules = SF();
    const features = table(data, 'features');
    const counts = {};
    const out = rules.classFeatures(C, data).map((f) => {
      const key = f.levelIndex + '|' + f.slug;
      const k = counts[key] || 0;
      counts[key] = k + 1;
      const detail = H.paramDetail(data, C.levels[f.levelIndex].choices || {}, f.slug, k);
      return (own(features, f.slug) || { name: f.slug }).name + (detail ? ' (' + detail + ')' : '');
    });
    rules.levelPlan(C, data).forEach((p) => p.entries.forEach((e) => {
      if (!e.skillPick) return;
      const names = asList(p.choices[e.skillPick]).filter((v) => has(rules.SKILLS, v)).map((v) => rules.SKILLS[v].name);
      if (names.length) out.push((e.label || 'Skill choice') + ': ' + names.join(', '));
    }));
    return out;
  }

  function gearRows(C, data) {
    const items = table(data, 'items');
    const rows = { weapons: {}, armor: [], aug: [], equip: [], attach: [] };
    asList(C.gear).filter((g) => isObject(g) && has(items, g.item)).forEach((g) => {
      const rec = items[g.item];
      const parts = asList(g.slots).map((x) => x && own(items, x.item)).concat(asList(g.fusions).map((x) => own(items, typeof x === 'string' ? x : x && x.item))).filter(Boolean).map((r) => r.name);
      if (parts.length) rows.attach.push(rec.name + ': ' + parts.join(', '));
      if (rec.weapon) rows.weapons[rec.name] = rows.weapons[rec.name] || rec;
      else if (rec.armor) rows.armor.push({ g, rec });
      else if (rec.type === 'augmentation') rows.aug.push({ g, rec });
      else rows.equip.push({ g, rec });
    });
    rows.armor.sort((a, b) => (b.g.equipped ? 1 : 0) - (a.g.equipped ? 1 : 0));
    return rows;
  }

  const qtyLabel = (g) => (qtyOf(g) > 1 ? ' (x' + qtyOf(g) + ')' : '');
  const augLabel = (x) => x.rec.name + (x.g.ability ? ' (' + String(x.g.ability).toUpperCase() + ')' : '');
  const weaponLabel = (a) => a.name + ' (' + [a.attack === undefined || a.attack === null || a.attack === false ? '' : sign(a.attack), a.damage || ''].filter(Boolean).join(', ') + ')';

  function toMythWeavers(C, data) {
    const rules = SF();
    const s = rules.derive(C, data);
    const sd = {};
    const extra = [];
    const set = (k, v) => { if (KEY_SET[k] && v !== undefined && v !== null) sd[k] = String(v); };
    const overflow = (label, list) => { if (list.length) extra.push(label + ': ' + list.join('; ')); };

    const race = own(table(data, 'races'), C.race);
    const theme = own(table(data, 'themes'), C.theme);
    set('name', C.name || '');
    set('class', U().classSummary(C, data));
    if (race) { set('race', race.name); set('size', cap(race.size)); }
    if (theme) set('theme', theme.name);

    rules.ABILITIES.forEach((a) => {
      set(ABILITY_FIELD[a] + '_score', s.abilities[a].score);
      set(ABILITY_FIELD[a] + '_mod', s.abilities[a].mod);
    });
    const m = (a) => s.abilities[a].mod;

    const cur = H.playCurrent(C, s);
    set('hp', cur.hp.current); set('max_hp', s.hp);
    set('stam', cur.sp.current); set('max_stam', s.sp);
    set('res', cur.rp.current); set('max_res', s.rp);
    if (cur.hp.nonlethal) set('hp_nonlethal', cur.hp.nonlethal);

    const armor = rules.equippedArmor(C, data);
    const dexForAc = armor && Number.isFinite(armor.dex) ? Math.min(m('dex'), armor.dex) : m('dex');
    [['eac', s.eac], ['kac', s.kac]].forEach(([ac, total]) => {
      const fromArmor = armor ? armor[ac] || 0 : 0;
      set(ac + '_armor', fromArmor);
      set(ac + '_dex', dexForAc);
      set(ac + '_misc', total - 10 - fromArmor - dexForAc);
      set(ac + '_total', total);
    });
    set('ac_cmac', s.cmd);
    set('init_dex', m('dex'));
    set('init_total', s.initiative);

    SAVES.forEach(([k, f, a]) => {
      const base = rules.baseSave(k, C, data);
      set(f + '_base', base);
      set(f + '_' + a, m(a));
      set(f + '_misc', s[k] - base - m(a));
      set(f + '_total', s[k]);
    });

    const bab = rules.bab(C, data);
    [['mab', 'str'], ['rab', 'dex'], ['tab', 'str']].forEach(([p, a]) => {
      set(p + '_base', bab);
      set(p + '_' + a, m(a));
      set(p + '_misc', s.bab - bab);
      set(p + '_ab', sign(s.bab + m(a)));
    });

    const gear = gearRows(C, data);
    const attacks = asList(s.attacks);
    const typeNames = rules.TYPE_NAME || {};
    attacks.slice(0, WEAPON_ROWS).forEach((a, i) => {
      const p = 'wpn' + (i + 1) + '_';
      const rec = gear.weapons[a.name] || gear.weapons[a.name.replace(/ \(thrown\)$/, '')];
      set(p + 'name', a.name);
      set(p + 'ab', a.attack === undefined || a.attack === null || a.attack === false ? '' : sign(a.attack));
      set(p + 'dmg', a.damage || '');
      set(p + 'crit', a.crit || '');
      set(p + 'range', a.range || '');
      set(p + 'type', rec ? own(typeNames, rec.weapon.type) || rec.weapon.type : own(typeNames, 'basicM'));
      set(p + 'special', a.notes || '');
    });
    overflow(LINE.weapons, attacks.slice(WEAPON_ROWS).map(weaponLabel));

    gear.armor.slice(0, ARMOR_ROWS).forEach((x, i) => {
      const p = 'protect_' + (i + 1);
      const ar = x.rec.armor;
      set(p + '_name', x.rec.name);
      set(p + 'type', cap(ar.type));
      set(p + 'eac_bonus', ar.eac || 0);
      set(p + 'kac_bonus', ar.kac || 0);
      set(p + 'max_dex', Number.isFinite(ar.dex) ? ar.dex : '');
      set(p + 'chk_pen', ar.acp || 0);
      set(p + 'speed', ar.speedAdjust || 0);
      set(p + 'upg', x.rec.slots || 0);
    });
    overflow(LINE.armor, gear.armor.slice(ARMOR_ROWS).map((x) => x.rec.name));

    gear.equip.slice(0, EQUIP_ROWS).forEach((x, i) => {
      const p = 'equip' + (i + 1) + '_';
      set(p, x.rec.name + qtyLabel(x.g));
      set(p + 'loc', x.g.equipped ? 'worn' : x.g.carried === false ? 'stored' : 'carried');
      set(p + 'level', x.rec.level);
      set(p + 'worth', (Number(x.rec.price) || 0) * packs(x.rec, x.g));
      set(p + 'weight', x.rec.bulk);
    });
    overflow(LINE.equip, gear.equip.slice(EQUIP_ROWS).map((x) => x.rec.name + qtyLabel(x.g)));
    gear.aug.slice(0, AUG_ROWS).forEach((x, i) => {
      const p = 'aug' + (i + 1) + '_';
      set(p, augLabel(x));
      set(p + 'loc', x.rec.augSystem && x.rec.augSystem !== 'none' ? x.rec.augSystem : x.g.system || '');
      set(p + 'level', x.rec.level);
      set(p + 'worth', Number(x.rec.price) || 0);
      set(p + 'weight', x.rec.bulk);
    });
    overflow(LINE.aug, gear.aug.slice(AUG_ROWS).map(augLabel));
    overflow(LINE.attach, gear.attach);
    set('possessions_worth', rules.budget(C, data).spent);
    set('possessions_weight', s.bulk.carried);
    set('augmentations_worth', gear.aug.reduce((n, x) => n + (Number(x.rec.price) || 0), 0));
    set('augmentations_weight', round2(gear.aug.reduce((n, x) => n + bulkOf(x.rec.bulk), 0)));
    set('load_encumbered_load', s.bulk.limit / 2);
    set('load_overburdened_load', s.bulk.limit);
    set('movespeed_move', s.speed);

    let totalRanks = 0;
    Object.keys(rules.SKILLS).forEach((k, i) => {
      const sk = s.skills[k];
      const n = i + 1;
      const p = 'skill_' + n + '_';
      const acp = rules.ACP_SKILLS.indexOf(k) !== -1 ? s.acp : 0;
      totalRanks += sk.ranks;
      set(p + 'name', sk.name);
      set(p + 'abil', ABBR[sk.ability]);
      set(p + 'abil_mod', m(sk.ability));
      set(p + 'rank', sk.ranks);
      if (rules.ACP_SKILLS.indexOf(k) !== -1) set(p + 'acp', acp);
      set(p + 'misc', sk.total - sk.ranks - m(sk.ability) - acp);
      set(p + 'skill_mod', sk.trainedOnly && !sk.ranks ? '' : sk.total);
    });
    set('total_ranks', totalRanks);

    const featNames = featList(C, data).concat(featureList(C, data));
    featNames.slice(0, FEAT_ROWS).forEach((f, i) => set('feat_' + (i + 1), f));
    overflow(LINE.feats, featNames.slice(FEAT_ROWS));

    const spells = table(data, 'spells');
    const learned = [];
    U().levelsOf(C).forEach((l) => {
      const sp = (l && l.spells) || {};
      asList(sp.learn).forEach((slug) => learned.push((own(spells, slug) || { name: slug }).name));
      if (sp.swap && sp.swap.to) learned.push((own(spells, sp.swap.to) || { name: sp.swap.to }).name + ' (replaces ' + (own(spells, sp.swap.from) || { name: sp.swap.from }).name + ')');
    });
    overflow(LINE.spells, learned);

    const notes = String(C.notes || '').trim();
    set('__txt_other_notes', extra.length ? (notes ? notes + '\n\n' : '') + MARK + '\n' + extra.join('\n') : notes);

    const now = new Date().toISOString();
    return {
      can_edit: true, created_at: now, deleted_at: null, downloaded_at: null, game: null, game_id: null, id: null, legacy_id: null,
      name: C.name || 'Unnamed character', owner: null, portrait: null, private: false, sheet_data: sd, sheet_template_id: TEMPLATE, updated_at: now
    };
  }

  function splitNotes(raw) {
    const text = String(raw || '');
    const at = text.indexOf(MARK);
    const lines = {};
    if (at === -1) return { notes: text.trim(), lines };
    text.slice(at + MARK.length).split('\n').forEach((line) => {
      const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
      if (m) lines[m[1].trim()] = m[2].split(/;\s*/).map((x) => x.trim()).filter(Boolean);
    });
    return { notes: text.slice(0, at).trim(), lines };
  }

  function typeKey(rules, detail) {
    const want = norm(detail);
    const names = rules.TYPE_NAME || {};
    return Object.keys(names).find((k) => norm(k) === want || norm(names[k]) === want || norm(names[k]).replace(/s$/, '') === want.replace(/s$/, '')) || null;
  }

  function skillKey(rules, s) {
    const n = norm(s);
    return Object.keys(rules.SKILLS).find((k) => norm(rules.SKILLS[k].name) === n || k === n) || null;
  }

  function parsePicks(data, slug, detail) {
    const rules = SF();
    if (!detail) return null;
    const def = own(rules.FEAT_CHOICE, slug);
    if (def) {
      if (def.kind === 'special') { const hit = lookup(indexFor(data, 'items'), detail); return hit ? [hit.slug] : null; }
      const t = typeKey(rules, detail);
      return t ? [t] : null;
    }
    const param = rules.paramOf(data, slug);
    if (!param) return null;
    const parts = detail.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    const picks = parts.map((x) => (param.kind === 'skill' ? skillKey(rules, x) : (rules.ENERGY || []).indexOf(x.toLowerCase()) !== -1 ? x.toLowerCase() : null));
    return picks.length === param.count && picks.every(Boolean) ? picks : null;
  }

  function parseClasses(text, data, miss) {
    const idx = indexFor(data, 'classes');
    const out = [];
    String(text || '').split(/[\/;]/).map((x) => x.trim()).filter(Boolean).forEach((part) => {
      let m = /^(.*?)\s*(\d+)$/.exec(part);
      let name = m ? m[1] : part;
      let n = m ? Number(m[2]) : 1;
      if (!m && (m = /^(\d+)\s+(.*)$/.exec(part))) { name = m[2]; n = Number(m[1]); }
      name = name.replace(/\b(level|lvl|lv)\.?$/i, '').replace(/,\s*$/, '').trim();
      const hit = fuzzy(idx, name);
      if (!hit) { miss('Class', part); return; }
      out.push({ cls: hit.slug, n: Math.max(1, n) });
    });
    return out;
  }

  function featFits(slot, slug, data) {
    if (!slot) return false;
    if (!slot.pool) return true;
    if (slot.pool === 'combat') return !!(own(table(data, 'feats'), slug) || {}).combat;
    return Array.isArray(slot.pool) && slot.pool.indexOf(slug) !== -1;
  }

  function placeFeats(char, data, queue, miss) {
    const rules = SF();
    const granted = rules.grantedFeats(char, data).map((f) => f.slug);
    const slots = rules.featSlots(char, data);
    const byLevel = char.levels.map((l, i) => slots.filter((s) => s.level === i + 1));
    const picks = char.levels.map(() => ({}));
    queue.forEach((f) => {
      const g = granted.indexOf(f.slug);
      if (g !== -1) { granted.splice(g, 1); return; }
      let at = char.levels.findIndex((l, i) => featFits(byLevel[i][l.feats.length], f.slug, data));
      if (at === -1) { at = char.levels.length - 1; miss('Feat without a free slot (placed as an extra feat)', f.name); }
      const lvl = char.levels[at];
      lvl.feats.push(f.slug);
      const def = own(rules.FEAT_CHOICE, f.slug);
      const param = rules.paramOf(data, f.slug);
      const count = def ? 1 : param ? param.count : 0;
      if (!count) return;
      const k = lvl.feats.filter((x) => x === f.slug).length - 1;
      const parsed = parsePicks(data, f.slug, f.detail);
      if (f.detail && !parsed) miss('Feat pick', f.name);
      const list = (picks[at][f.slug] = picks[at][f.slug] || []);
      for (let j = 0; j < count; j++) list[k * count + j] = parsed ? parsed[j] : '';
    });
    picks.forEach((p, i) => Object.keys(p).forEach((slug) => {
      const list = p[slug].map((v) => v || '');
      if (list.some(Boolean)) char.levels[i].choices[slug] = list.length > 1 ? list : list[0];
    }));
  }

  function featureCandidates(char, data) {
    const rules = SF();
    const features = table(data, 'features');
    const set = {};
    rules.classFeatures(char, data).forEach((f) => { set[f.slug] = true; });
    rules.levelPlan(char, data).forEach((p) => p.entries.forEach((e) => {
      if (!e.choice) return;
      rules.poolOf(e, data, p.cls).forEach((slug) => {
        set[slug] = true;
        const grants = (own(features, slug) || {}).grants || {};
        Object.keys(grants).forEach((t) => asList(grants[t]).forEach((g) => { set[g] = true; }));
      });
    }));
    return Object.keys(set).filter((slug) => has(features, slug));
  }

  function matchIn(slugs, tbl, name) {
    let s = String(name).trim();
    let detail = '';
    for (let i = 0; i < 3 && s; i++) {
      const n = norm(s);
      const hit = slugs.find((slug) => norm(tbl[slug].name) === n) || slugs.find((slug) => norm(stripParen(tbl[slug].name)) === n);
      if (hit) return { slug: hit, detail };
      const p = lastParen(s);
      if (p === null) break;
      if (!detail) detail = p;
      s = stripParen(s);
    }
    return null;
  }

  function placeFeatures(char, data, names, miss) {
    const rules = SF();
    const left = names.slice();
    const take = (pred) => {
      const i = left.findIndex(pred);
      return i === -1 ? null : left.splice(i, 1)[0];
    };
    const done = {};
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      const counts = {};
      rules.classFeatures(char, data).forEach((f) => {
        const key = f.levelIndex + '|' + f.slug;
        const k = counts[key] || 0;
        counts[key] = k + 1;
        if (done[key + '|' + k]) return;
        const got = take((x) => x.slug === f.slug);
        if (!got && f.via !== 'choice') return;
        done[key + '|' + k] = true;
        changed = true;
        if (!got || !got.detail) return;
        const param = rules.paramOf(data, f.slug);
        const parsed = param ? parsePicks(data, f.slug, got.detail) : null;
        if (!parsed) { if (param) miss('Class feature pick', got.name); return; }
        const choices = char.levels[f.levelIndex].choices;
        const list = asList(choices[f.slug]).slice();
        parsed.forEach((v, j) => { list[k * param.count + j] = v; });
        choices[f.slug] = list.length > 1 ? list.map((v) => v || '') : list[0];
      });
      rules.levelPlan(char, data).forEach((p) => p.entries.forEach((e) => {
        if (!e.choice || has(p.choices, e.choice)) return;
        const pool = rules.poolOf(e, data, p.cls);
        const picked = [];
        for (let j = 0; j < (e.count || 1); j++) {
          const got = take((x) => pool.indexOf(x.slug) !== -1 && picked.indexOf(x.slug) === -1);
          if (!got) break;
          picked.push(got.slug);
          left.unshift(got);
        }
        if (!picked.length) return;
        char.levels[p.levelIndex].choices[e.choice] = (e.count || 1) > 1 ? picked : picked[0];
        changed = true;
      }));
      if (!changed) break;
    }
    left.forEach((x) => miss('Class feature', x.name));
  }

  function placeSkillPicks(char, data, lines, miss) {
    const rules = SF();
    lines.forEach((line) => {
      const m = /^(.+?):\s*(.+)$/.exec(line);
      const label = norm(m[1]);
      let placed = false;
      rules.levelPlan(char, data).some((p) => p.entries.some((e) => {
        if (!e.skillPick || has(p.choices, e.skillPick) || norm(e.label || 'Skill choice') !== label) return false;
        const keys = m[2].split(/,\s*/).map((x) => skillKey(rules, x)).filter(Boolean).slice(0, e.count || 1);
        if (!keys.length) return false;
        char.levels[p.levelIndex].choices[e.skillPick] = (e.count || 1) > 1 ? keys : keys[0];
        placed = true;
        return true;
      }));
      if (!placed) miss('Class feature', line);
    });
  }

  function isSkillPickLine(char, data, name) {
    const m = /^(.+?):\s*(.+)$/.exec(name);
    if (!m) return false;
    const label = norm(m[1]);
    return SF().levelPlan(char, data).some((p) => p.entries.some((e) => e.skillPick && norm(e.label || 'Skill choice') === label));
  }

  function placeRanks(char, data, wanted, miss) {
    const rules = SF();
    const free = rules.freeRanks(char, data);
    const need = {};
    Object.keys(wanted).forEach((k) => { const n = Math.min(MAX_LEVEL, wanted[k] - (free[k] || 0)); if (n > 0) need[k] = n; });
    const placed = {};
    char.levels.forEach((l, i) => {
      let budget = rules.rankBudget(i, char, data);
      Object.keys(need).sort((a, b) => (need[b] - (placed[b] || 0)) - (need[a] - (placed[a] || 0))).forEach((k) => {
        const room = Math.min(need[k] - (placed[k] || 0), i + 1 - (placed[k] || 0) - (free[k] || 0), budget);
        if (room <= 0) return;
        l.skills[k] = (l.skills[k] || 0) + room;
        placed[k] = (placed[k] || 0) + room;
        budget -= room;
      });
    });
    Object.keys(need).forEach((k) => {
      const short = need[k] - (placed[k] || 0);
      if (short > 0) miss('Skill ranks not placed', rules.SKILLS[k].name + ' ' + short);
    });
  }

  function setAbilities(char, data, sd) {
    const rules = SF();
    const score = (a) => { const n = Number(sd[ABILITY_FIELD[a] + '_score']); return Number.isFinite(n) && sd[ABILITY_FIELD[a] + '_score'] !== '' ? Math.round(n) : null; };
    const best = rules.ABILITIES.slice().sort((a, b) => (score(b) || 0) - (score(a) || 0))[0];
    const race = own(table(data, 'races'), char.race);
    if (race && (race.abilityMods || []).some((x) => x[1] === 'any')) char.abilities.raceAny = best;
    const theme = own(table(data, 'themes'), char.theme);
    if (theme && (char.theme === 'themeless' || rules.ABILITIES.indexOf(theme.ability) === -1)) char.abilities.themeAny = best;
    rules.ABILITIES.forEach((a) => { char.abilities.pb[a] = 0; });
    const base = rules.baseScores(Object.assign({}, char, { levels: [] }), data);
    const maxAt = rules.POINT_BUY.maxAtCreation;
    rules.ABILITIES.forEach((a) => {
      const s = score(a);
      if (s === null) return;
      char.abilities.pb[a] = Math.max(0, Math.min(maxAt - base[a], s - base[a]));
    });
  }

  function readText(sd, k) {
    const v = own(sd, k);
    if (typeof v === 'string') return v.trim();
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }

  function fromMythWeavers(obj, data) {
    const rules = SF();
    if (!isObject(obj)) throw new H.ImportError('That file is not a Myth-Weavers sheet: expected a JSON object.');
    if (!isObject(obj.sheet_data)) throw new H.ImportError('That file has no sheet_data, so it is not a Myth-Weavers sheet export.');
    if (Number(obj.sheet_template_id) !== TEMPLATE) {
      throw new H.ImportError('That Myth-Weavers sheet uses template ' + String(obj.sheet_template_id) + '. Only the Starfinder sheet (template ' + TEMPLATE + ') can be imported.');
    }
    const sd = obj.sheet_data;
    const get = (k) => readText(sd, k);
    const unmatched = [];
    const miss = (cat, v) => { if (v) unmatched.push(cat + ': ' + v); };
    const split = splitNotes(get('__txt_other_notes'));
    const more = (label) => split.lines[label] || [];
    const char = rules.blankCharacter();
    char.name = get('name') || (typeof obj.name === 'string' ? obj.name : '');

    if (get('race')) {
      const hit = fuzzy(indexFor(data, 'races'), get('race'), true);
      if (hit) { char.race = hit.slug; char.variant = table(data, 'races')[hit.slug].variant || null; } else miss('Race', get('race'));
    }
    if (get('theme')) {
      const hit = fuzzy(indexFor(data, 'themes'), get('theme'));
      if (hit) char.theme = hit.slug; else miss('Theme', get('theme'));
    }
    let total = 0;
    parseClasses(get('class'), data, miss).forEach(({ cls, n }) => {
      for (let i = 0; i < n && total < MAX_LEVEL; i++, total++) char.levels.push({ class: cls, increases: [], skills: {}, feats: [], choices: {}, spells: {} });
    });
    if (!char.levels.length && get('class')) miss('Class', get('class'));

    setAbilities(char, data, sd);
    const pro = get('skill_16_abil').toLowerCase();
    if (['int', 'wis'].indexOf(pro) !== -1) char.proAbility = pro;

    const names = range(1, FEAT_ROWS).map((n) => get('feat_' + n)).filter(Boolean).concat(more(LINE.feats));
    if (char.levels.length) {
      const featIdx = indexFor(data, 'features');
      const candidates = featureCandidates(char, data);
      const featQueue = [];
      const featureQueue = [];
      const pickLines = [];
      names.forEach((name) => {
        const asFeature = matchIn(candidates, featIdx.tbl, name);
        if (asFeature) { featureQueue.push(Object.assign({ name }, asFeature)); return; }
        const asFeat = lookup(indexFor(data, 'feats'), name);
        if (asFeat) { featQueue.push(Object.assign({ name }, asFeat)); return; }
        if (isSkillPickLine(char, data, name)) { pickLines.push(name); return; }
        miss('Feat', name);
      });
      placeFeats(char, data, featQueue, miss);
      placeFeatures(char, data, featureQueue, miss);
      placeSkillPicks(char, data, pickLines, miss);

      const wanted = {};
      const keys = Object.keys(rules.SKILLS);
      keys.forEach((k, i) => {
        const raw = get('skill_' + (i + 1) + '_rank');
        if (raw !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0) wanted[k] = Math.floor(Number(raw));
      });
      more(LINE.ranks).forEach((x) => {
        const m = /^(.*?)\s+(\d+)$/.exec(x);
        const k = m && skillKey(rules, m[1]);
        if (k && !has(wanted, k)) wanted[k] = Number(m[2]);
        else if (!k) miss('Skill', x);
      });
      placeRanks(char, data, wanted, miss);
    } else {
      names.forEach((name) => miss('Feat (no class to place it under)', name));
    }

    const items = indexFor(data, 'items');
    let n = 0;
    const add = (slug, extra) => { n += 1; char.gear.push(Object.assign({ id: 'g' + n, item: slug, qty: 1, equipped: false }, extra || {})); };
    const weaponSeen = {};
    range(1, WEAPON_ROWS).map((i) => get('wpn' + i + '_name')).filter(Boolean).concat(more(LINE.weapons)).forEach((name) => {
      if (/^(unarmed strike|natural weapons)/i.test(name)) return;
      const hit = lookup(items, name);
      if (!hit || !table(data, 'items')[hit.slug].weapon) { miss('Weapon', name); return; }
      if (/^thrown$/i.test(hit.detail) && weaponSeen[hit.slug]) return;
      weaponSeen[hit.slug] = true;
      add(hit.slug, { equipped: true });
    });
    let armorOn = false;
    range(1, ARMOR_ROWS).map((i) => get('protect_' + i + '_name')).filter(Boolean).concat(more(LINE.armor)).forEach((name) => {
      const hit = lookup(items, name);
      if (!hit || !table(data, 'items')[hit.slug].armor) { miss('Armor', name); return; }
      add(hit.slug, { equipped: !armorOn });
      armorOn = true;
    });
    range(1, AUG_ROWS).map((i) => get('aug' + i + '_')).filter(Boolean).concat(more(LINE.aug)).forEach((name) => {
      const hit = lookup(items, name);
      if (!hit || table(data, 'items')[hit.slug].type !== 'augmentation') { miss('Augmentation', name); return; }
      const ability = String(hit.detail || '').toLowerCase();
      add(hit.slug, Object.assign({ equipped: true }, rules.ABILITIES.indexOf(ability) !== -1 ? { ability } : {}));
    });
    range(1, EQUIP_ROWS).map((i) => ({ name: get('equip' + i + '_'), loc: get('equip' + i + '_loc') })).filter((x) => x.name)
      .concat(more(LINE.equip).map((name) => ({ name, loc: '' }))).forEach((x) => {
        const q = /\s*\(x(\d+)\)\s*$/i.exec(x.name);
        const name = q ? x.name.slice(0, q.index) : x.name;
        const hit = lookup(items, name);
        if (!hit) { miss('Equipment', x.name); return; }
        add(hit.slug, Object.assign({ equipped: /^(worn|equipped)$/i.test(x.loc) }, q ? { qty: Math.max(1, Number(q[1])) } : {}));
      });

    const notes = [split.notes];
    const identity = IDENTITY_TEXT.filter(([k]) => get(k)).map(([k, label]) => label + ': ' + get(k));
    const languages = range(1, 18).map((i) => get('language_' + i)).filter(Boolean);
    if (languages.length) identity.push('Languages: ' + languages.join(', '));
    if (identity.length) notes.push('Myth-Weavers details:\n' + identity.join('\n'));
    if (get('__txt_private_notes')) notes.push('Private notes:\n' + get('__txt_private_notes'));
    range(1, 6).forEach((i) => {
      const body = get('__txt_character_' + i);
      if (body) notes.push((get('__txt_character_' + i + '_name') || 'Character section ' + i) + ':\n' + body);
    });
    if (get('__txt_statblock')) notes.push('Statblock:\n' + get('__txt_statblock'));
    const counts = {};
    unmatched.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
    unmatched.splice(0, unmatched.length, ...Object.keys(counts).map((x) => (counts[x] > 1 ? x + ' (x' + counts[x] + ')' : x)));
    if (unmatched.length) notes.push(UNMATCHED_HEAD + '\n' + unmatched.map((x) => '- ' + x).join('\n'));
    char.notes = notes.filter(Boolean).join('\n\n');
    return { char: H.migrate(char), unmatched };
  }

  let lastImport = null;

  function tabMythWeavers() {
    const summary = lastImport
      ? '<div class="card"><h2>Last import: ' + esc(lastImport.name || 'Unnamed character') + '</h2>'
        + (lastImport.unmatched.length
          ? '<p class="note">These were not matched and were added to the character\'s notes. Pick them by hand if they belong.</p><ul>' + lastImport.unmatched.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
          : '<p class="note">Everything on the sheet was matched.</p>')
        + '<div class="row c"><button class="btn sm" data-act="clearMythWeavers">Dismiss</button></div></div>'
      : '';
    return '<div class="card"><h2>Myth-Weavers</h2>'
      + '<p class="note">Export a file in the JSON format Myth-Weavers uses for its Starfinder sheet (template 43), or import one exported from there.</p>'
      + '<div class="row c"><button class="btn pri" data-act="exportMythWeavers">Export for Myth-Weavers</button>'
      + '<label class="btn">Import from Myth-Weavers<input type="file" accept=".json,application/json" data-import-mw hidden></label></div>'
      + '<p class="note">Import is best-effort and lossy: Myth-Weavers stores text, not choices, so names are matched against the builder\'s data and anything that doesn\'t match is listed here and kept in the notes. Importing replaces the character you are editing; check the blockers afterwards.</p></div>'
      + summary;
  }

  const mwName = (C) => H.exportName(C).replace(/-sf\.json$/, '-mythweavers.json');

  function readMythWeavers(file) {
    const reader = new root.FileReader();
    reader.onload = () => importMythWeavers(String(reader.result), H.toast);
    reader.onerror = () => H.toast('Could not read that file.');
    reader.readAsText(file);
  }

  function importMythWeavers(text, report) {
    const say = report || H.toast;
    let res;
    try {
      let raw;
      try { raw = JSON.parse(text); } catch (e) { throw new H.ImportError('That file is not valid JSON, it may be truncated.'); }
      res = fromMythWeavers(raw, root.SFDATA);
    } catch (e) {
      say(e instanceof H.ImportError ? e.message : 'Could not read that file.');
      return false;
    }
    const prev = lastImport;
    lastImport = { name: res.char.name, unmatched: res.unmatched };
    if (!H.applyChar(res.char, say)) { lastImport = prev; return false; }
    say('Imported from Myth-Weavers' + (res.unmatched.length ? ', ' + res.unmatched.length + ' not matched' : ''));
    return true;
  }

  Object.assign(H.actions, {
    exportMythWeavers: (C, UIstate, data) => { H.download(JSON.stringify(toMythWeavers(C, data), null, 2), mwName(C), 'application/json'); },
    clearMythWeavers: () => { lastImport = null; }
  });
  Object.assign(H, { toMythWeavers, fromMythWeavers, importMythWeavers, tabMythWeavers, MYTHWEAVERS_KEYS: KEYS, expandMythWeaversKeys: expandFamilies, lastMythWeaversImport: () => lastImport });

  const doc = root.document;
  if (doc && doc.addEventListener) {
    doc.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.dataset || t.dataset.importMw === undefined) return;
      const file = t.files && t.files[0];
      if (file) readMythWeavers(file);
      t.value = '';
    });
  }
})(this);
