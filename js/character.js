(function(root){
  const VERSION = 1;
  const KEY = 'sfbuilder.v1';
  const BACKUP_PREFIX = KEY + '.backup-';
  const PROBE = 'sfbuilder.probe';
  const RECOVERED = 'Your saved character could not be read. A copy was kept.';
  const UNBACKED = 'Your saved character could not be read and could not be backed up. Download it before editing.';
  const NOT_SAVING = 'Not saving: export to keep your work';

  class ImportError extends Error {
    constructor(message) { super(message); this.name = 'ImportError'; }
  }

  let available = false;
  let recovered = null;
  let olderBackup = null;

  const UI = () => root.SFUI || {};
  const SF = () => root.SF;
  const esc = (s) => UI().esc(s);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const own = (o, k) => (!!o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

  const defaultChar = () => (typeof module !== 'undefined' ? require('./rules.js') : root.SF).blankCharacter();

  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const PRO_ABILITIES = ['cha', 'int', 'wis'];
  const isAbilityKey = (v) => ABILITY_KEYS.indexOf(v) !== -1;
  const safeKey = (k) => k !== '__proto__';
  const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
  const slug = (v) => (typeof v === 'string' ? v : undefined);
  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? [v] : []);

  function put(out, key, value) {
    if (value !== undefined) out[key] = value;
    return out;
  }

  function cleanMap(v, fn) {
    const out = {};
    if (!isObject(v)) return out;
    Object.keys(v).filter(safeKey).forEach((k) => put(out, k, fn(v[k])));
    return out;
  }

  function cleanChoice(v) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : ''));
    return undefined;
  }

  function cleanSpells(v) {
    if (!isObject(v)) return {};
    const out = {};
    if (v.learn !== undefined) out.learn = strings(v.learn);
    if (isObject(v.swap) && typeof v.swap.from === 'string') out.swap = put({ from: v.swap.from }, 'to', slug(v.swap.to));
    return out;
  }

  function cleanLevel(l) {
    const out = { class: slug(l.class) || '' };
    if (l.increases !== undefined) out.increases = strings(l.increases).filter(isAbilityKey);
    if (l.skills !== undefined) out.skills = cleanMap(l.skills, num);
    if (l.feats !== undefined) out.feats = strings(l.feats);
    if (l.choices !== undefined) out.choices = cleanMap(l.choices, cleanChoice);
    if (l.spells !== undefined) out.spells = cleanSpells(l.spells);
    return out;
  }

  function cleanAttachment(x) {
    if (typeof x === 'string') return { item: x };
    return isObject(x) && typeof x.item === 'string' ? { item: x.item } : null;
  }

  function cleanFusion(x) {
    if (typeof x === 'string') return x;
    if (!isObject(x) || typeof x.item !== 'string') return null;
    const out = { item: x.item };
    put(out, 'level', num(x.level));
    if (x.seal === true) out.seal = true;
    return out;
  }

  function cleanGear(g) {
    const out = {};
    put(out, 'id', text(g.id));
    out.item = g.item;
    if (g.qty !== undefined) put(out, 'qty', num(g.qty));
    if (g.equipped !== undefined) out.equipped = g.equipped === true;
    if (typeof g.carried === 'boolean') out.carried = g.carried;
    put(out, 'system', slug(g.system));
    if (isAbilityKey(g.ability)) out.ability = g.ability;
    if (g.slots !== undefined) out.slots = (Array.isArray(g.slots) ? g.slots : [g.slots]).map(cleanAttachment).filter(Boolean);
    if (g.fusions !== undefined) out.fusions = (Array.isArray(g.fusions) ? g.fusions : [g.fusions]).map(cleanFusion).filter(Boolean);
    return out;
  }

  function cleanAbilities(a) {
    const src = isObject(a) ? a : {};
    const pb = isObject(src.pb) ? src.pb : {};
    const out = { pb: {} };
    ABILITY_KEYS.forEach((k) => { if (pb[k] !== undefined) out.pb[k] = num(pb[k]) === undefined ? 0 : num(pb[k]); });
    if (isAbilityKey(src.raceAny)) out.raceAny = src.raceAny;
    if (isAbilityKey(src.themeAny)) out.themeAny = src.themeAny;
    return out;
  }

  function migrate(raw) {
    if (!isObject(raw)) throw new ImportError('That file is not a character: expected a JSON object.');
    if (typeof raw.v !== 'number' || !Number.isFinite(raw.v)) throw new ImportError('That file has no version number, so it is not a Starfinder builder character.');
    if (raw.v > VERSION) throw new ImportError('That file is version ' + raw.v + ' but this builder reads version ' + VERSION + ' characters. It may come from a newer builder or a different tool.');
    if (raw.v < 1) throw new ImportError('That file has an invalid version number (' + raw.v + ').');
    if (!Array.isArray(raw.levels)) throw new ImportError('That file has no levels list, so it is not a Starfinder builder character.');
    raw.levels.forEach((l, i) => {
      if (!isObject(l)) throw new ImportError('Level ' + (i + 1) + ' in that file is not a valid level.');
    });
    const c = defaultChar();
    put(c, 'name', text(raw.name));
    put(c, 'race', slug(raw.race));
    if (raw.variant === null || typeof raw.variant === 'string') c.variant = raw.variant;
    put(c, 'theme', slug(raw.theme));
    if (PRO_ABILITIES.indexOf(raw.proAbility) !== -1) c.proAbility = raw.proAbility;
    if (raw.abilities !== undefined) c.abilities = cleanAbilities(raw.abilities);
    c.levels = raw.levels.map(cleanLevel);
    c.gear = (Array.isArray(raw.gear) ? raw.gear : []).filter((g) => isObject(g) && typeof g.item === 'string').map(cleanGear);
    put(c, 'notes', text(raw.notes));
    return c;
  }

  const exportJSON = (char) => JSON.stringify(char, null, 2);

  function importJSON(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new ImportError('That file is not valid JSON, it may be truncated.'); }
    return migrate(raw);
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function probeStorage() {
    try {
      const s = storage();
      if (!s) { available = false; return false; }
      s.setItem(PROBE, '1');
      s.removeItem(PROBE);
      available = true;
    } catch (e) { available = false; }
    return available;
  }

  const unbackedPending = () => !!recovered && !recovered.backed;

  function saveLocal(char) {
    if (unbackedPending()) return false;
    try {
      const s = storage();
      if (!s) throw new Error('no storage');
      s.setItem(KEY, exportJSON(char));
      available = true;
      return true;
    } catch (e) {
      available = false;
      return false;
    }
  }

  function keepBackup(text) {
    const key = KEY + '.backup-' + Date.now();
    recovered = { key, text, backed: false };
    try {
      storage().setItem(key, text);
      recovered.backed = true;
    } catch (e) { }
  }

  function newestBackupKey() {
    try {
      const s = storage();
      let best = null;
      let bestAt = -1;
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        const at = typeof k === 'string' && k.indexOf(BACKUP_PREFIX) === 0 ? Number(k.slice(BACKUP_PREFIX.length)) : NaN;
        if (Number.isFinite(at) && at > bestAt) { best = k; bestAt = at; }
      }
      return best;
    } catch (e) { return null; }
  }

  function loadLocal() {
    recovered = null;
    olderBackup = null;
    let text = null;
    try {
      const s = storage();
      text = s ? s.getItem(KEY) : null;
    } catch (e) { return null; }
    let char = null;
    if (text) {
      try { char = importJSON(text); } catch (e) { keepBackup(text); }
    }
    if (!recovered) olderBackup = newestBackupKey();
    return char;
  }

  function exportName(char) {
    const base = String((char && char.name) || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 60);
    return (base || 'character') + '-sf.json';
  }

  function toast(message) {
    const doc = root.document;
    if (!doc || !doc.body) return;
    let el = doc.getElementById('toast');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      doc.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.style.display = 'none'; }, 6000);
  }

  function applyImport(text, report) {
    let c;
    try { c = importJSON(text); } catch (e) {
      (report || toast)(e instanceof ImportError ? e.message : 'Could not read that file.');
      return false;
    }
    return applyChar(c, report);
  }

  function applyChar(c, report) {
    const u = UI();
    const prev = root.C ? clone(root.C) : null;
    try {
      const trial = u.normalize(clone(c), root.SFDATA);
      u.TABS.forEach((t) => u.view(trial, Object.assign(u.blankUI(), { tab: t[0] }), root.SFDATA));
      u.setCharacter(c);
    } catch (e) {
      if (prev) { try { u.setCharacter(prev); } catch (e2) { } }
      (report || toast)('That file could not be shown, so your character was not changed.');
      return false;
    }
    recovered = null;
    return true;
  }

  function download(content, filename, type) {
    const doc = root.document;
    const blob = new root.Blob([content], { type });
    const url = root.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => root.URL.revokeObjectURL(url), 1000);
  }

  function readFile(file) {
    const reader = new root.FileReader();
    reader.onload = () => applyImport(String(reader.result), toast);
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  }

  function tabIO() {
    return '<div class="card"><h2>Save and share</h2>'
      + '<p class="note">Your work is saved in this browser automatically. Export a file to back it up or move it to another device.</p>'
      + '<div class="row c"><button class="btn pri" data-act="exportFile">Export character</button>'
      + '<label class="btn">Import character<input type="file" accept=".json,application/json" data-import hidden></label></div>'
      + '<p class="note">Importing replaces the character you are editing. A file that is not a builder character is refused and nothing changes.</p></div>';
  }

  const stat = (label, value, cls) => '<div class="pp-box ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + esc(value) + '</b></div>';
  const boxes = (list) => '<div class="pp-boxes">' + list.map((x) => stat(x[0], x[1])).join('') + '</div>';

  function skillRows(s) {
    const head = '<div class="pp-sk hd"><span></span><span>Skill</span><span>Abil</span><span class="r">Rk</span><span class="r">Total</span></div>';
    return head + Object.keys(s.skills).map((k) => {
      const sk = s.skills[k];
      const total = sk.trainedOnly && !sk.ranks ? '—' : UI().sign(sk.total);
      return '<div class="pp-sk"><span>' + (sk.classSkill ? '●' : '') + '</span><span class="n">' + esc(sk.name) + '</span><span class="a">' + esc(sk.ability) + '</span><span class="r">' + esc(sk.ranks) + '</span><b>' + esc(total) + '</b></div>';
    }).join('');
  }

  function attackTable(s) {
    if (!s.attacks.length) return '<p class="pp-note">No attacks.</p>';
    return '<table><thead><tr><th>Attack</th><th class="num">Atk</th><th>Damage</th></tr></thead><tbody>'
      + s.attacks.map((a) => '<tr><td>' + esc(a.name) + (a.notes ? '<div class="pp-note">' + esc(a.notes) + '</div>' : '') + '</td><td class="num">' + esc(a.attack === undefined || a.attack === null || a.attack === false ? '—' : UI().sign(a.attack)) + '</td><td>' + esc(a.damage === false ? '—' : a.damage) + '</td></tr>').join('')
      + '</tbody></table>';
  }

  function pageOne(C, data, s) {
    const u = UI();
    const sign = u.sign;
    const race = own(u.table(data, 'races'), C.race);
    const theme = own(u.table(data, 'themes'), C.theme);
    const sub = [race && race.name, theme && theme.name, u.classSummary(C, data)].filter(Boolean).join(' · ');
    const abs = SF().ABILITIES.map((a) => '<div class="pp-ab"><b>' + esc(a.toUpperCase()) + '</b><span class="v">' + esc(s.abilities[a].score) + '</span><span class="m">' + esc(sign(s.abilities[a].mod)) + '</span></div>').join('');
    return '<section class="pp-page"><div class="pp-head"><div><h1>' + esc(C.name || 'Unnamed character') + '</h1><div class="pp-sub">' + esc(sub || 'No race, theme or class yet') + '</div></div>'
      + '<div class="pp-meta">Level ' + esc(u.levelsOf(C).length) + '<br>BAB ' + esc(sign(s.bab)) + '</div></div>'
      + '<div class="pp-abs">' + abs + '</div>'
      + '<div class="pp-cols"><div class="pp-col">'
      + '<div class="pp-sec"><div class="pp-h">Vitals</div>' + boxes([['SP', s.sp], ['HP', s.hp], ['RP', s.rp]]) + '</div>'
      + '<div class="pp-sec"><div class="pp-h">Defense</div>' + boxes([['EAC', s.eac], ['KAC', s.kac], ['CMD', s.cmd]]) + '</div>'
      + '<div class="pp-sec"><div class="pp-h">Saves</div>' + boxes([['Fort', sign(s.fort)], ['Ref', sign(s.ref)], ['Will', sign(s.will)]]) + '</div>'
      + '<div class="pp-sec"><div class="pp-h">Movement and attack</div>' + boxes([['Init', sign(s.initiative)], ['Speed', s.speed + ' ft'], ['BAB', sign(s.bab)]]) + '</div>'
      + '<div class="pp-sec"><div class="pp-h">Attacks</div>' + attackTable(s) + '</div></div>'
      + '<div class="pp-col"><div class="pp-sec"><div class="pp-h">Skills</div><div class="pp-skills">' + skillRows(s) + '</div><div class="pp-note">● class skill. — trained only, no ranks.</div></div></div></div>'
      + '<div class="pp-foot"><span>Starfinder character builder</span><span>Page 1</span></div></section>';
  }

  const li = (name, summary, tag) => '<div class="pp-li"><b>' + esc(name) + '</b>' + (tag ? ' <small>' + esc(tag) + '</small>' : '') + (summary ? '<div><small>' + esc(summary) + '</small></div>' : '') + '</div>';

  function featDetail(C, data, levelIndex, slug, k) {
    const rules = SF();
    const choices = (C.levels[levelIndex] && C.levels[levelIndex].choices) || {};
    const def = own(rules.FEAT_CHOICE, slug);
    if (def) {
      const v = asList(choices[slug])[k];
      if (!v) return '';
      if (def.kind === 'special') return (own(UI().table(data, 'items'), v) || {}).name || v;
      return own(rules.TYPE_NAME, v) || v;
    }
    return paramDetail(data, choices, slug, k);
  }

  function paramDetail(data, choices, slug, k) {
    const param = SF().paramOf(data, slug);
    if (!param) return '';
    const list = asList(choices[slug]).slice(k * param.count, (k + 1) * param.count);
    return list.filter(Boolean).map((v) => SF().optionName(param.kind, v)).join(', ');
  }

  function featPage(C, data) {
    const u = UI();
    const rules = SF();
    const feats = [];
    u.levelsOf(C).forEach((l, i) => {
      const seen = {};
      rules.grantedAt(C, data, i).forEach((slug) => {
        const rec = own(u.table(data, 'feats'), slug);
        feats.push(li(rec ? rec.name : slug, rec && rec.summary, 'granted, level ' + (i + 1)));
      });
      asList(l.feats).forEach((slug) => {
        const k = seen[slug] || 0;
        seen[slug] = k + 1;
        const rec = own(u.table(data, 'feats'), slug);
        const detail = featDetail(C, data, i, slug, k);
        feats.push(li((rec ? rec.name : slug) + (detail ? ' (' + detail + ')' : ''), rec && rec.summary, 'level ' + (i + 1)));
      });
    });
    const plan = rules.levelPlan(C, data);
    const label = (f) => {
      const e = plan[f.levelIndex].entries.find((x) => x.choice === f.choice);
      return e && e.label ? e.label : '';
    };
    const counts = {};
    const features = rules.classFeatures(C, data).map((f) => {
      const rec = own(u.table(data, 'features'), f.slug);
      const key = f.levelIndex + '|' + f.slug;
      const k = counts[key] || 0;
      counts[key] = k + 1;
      const detail = paramDetail(data, C.levels[f.levelIndex].choices || {}, f.slug, k);
      const from = f.via === 'choice' ? label(f) : '';
      const tag = [from, u.className(data, f.cls) + ' (level ' + (f.levelIndex + 1) + ')'].filter(Boolean).join(', ');
      return li((rec ? rec.name : f.slug) + (detail ? ' (' + detail + ')' : ''), rec && rec.summary, tag);
    });
    plan.forEach((p) => p.entries.forEach((e) => {
      if (!e.skillPick) return;
      const names = asList(p.choices[e.skillPick]).filter((v) => own(rules.SKILLS, v)).map((v) => rules.SKILLS[v].name);
      if (names.length) features.push(li((e.label || 'Skill choice') + ': ' + names.join(', '), '', u.className(data, p.cls) + ' (level ' + (p.levelIndex + 1) + ')'));
    }));
    if (!feats.length && !features.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Class features</div><div class="pp-list">' + (features.join('') || '<div class="pp-note">None.</div>') + '</div></div>'
      + '<div class="pp-sec"><div class="pp-h">Feats</div><div class="pp-list">' + (feats.join('') || '<div class="pp-note">None.</div>') + '</div></div></section>';
  }

  function spellPage(C, data) {
    const u = UI();
    const spells = u.table(data, 'spells');
    const name = (slug) => (own(spells, slug) ? spells[slug].name : slug);
    const rows = [];
    u.levelsOf(C).forEach((l, i) => {
      const sp = l.spells || {};
      asList(sp.learn).forEach((slug) => {
        const rec = own(spells, slug);
        rows.push(li(name(slug), rec && rec.summary, (rec && Number.isFinite(rec.level) ? 'spell level ' + rec.level + ', ' : '') + 'learned at level ' + (i + 1)));
      });
      if (sp.swap && sp.swap.to) rows.push(li(name(sp.swap.to), 'Replaces ' + name(sp.swap.from), 'swapped at level ' + (i + 1)));
    });
    if (!rows.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Spells</div><div class="pp-list">' + rows.join('') + '</div></div></section>';
  }

  function gearPage(C, data) {
    const items = UI().table(data, 'items');
    const nm = (slug) => (own(items, slug) ? items[slug].name : slug);
    const rows = asList(C.gear).filter(Boolean).map((g) => {
      const parts = asList(g.slots).map((x) => nm(x && x.item)).concat(asList(g.fusions).map((x) => nm(typeof x === 'string' ? x : x && x.item)), g.ability ? ['raises ' + String(g.ability).toUpperCase()] : []);
      return '<tr><td>' + esc(nm(g.item)) + (parts.length ? '<div class="pp-note">' + esc(parts.join(', ')) + '</div>' : '') + '</td><td class="num">' + esc(g.qty) + '</td><td>' + (g.equipped ? 'equipped' : '') + '</td></tr>';
    });
    if (!rows.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Gear</div><table><thead><tr><th>Item</th><th class="num">Qty</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></section>';
  }

  const bb = (v) => String(v === undefined || v === null ? '' : v).replace(/\[/g, '\uFF3B').replace(/\]/g, '\uFF3D');
  const bbRow = (cells, tag) => '[tr]' + cells.map((c) => '[td]' + (tag === 'b' ? '[b]' + c + '[/b]' : c) + '[/td]').join('') + '[/tr]';
  const bbTable = (rows) => '[table]' + rows.join('') + '[/table]';
  const bbList = (items) => '[list]\n' + items.map((x) => '[*]' + x).join('\n') + '\n[/list]';
  const bbSpoiler = (title, body) => '[spoiler=' + bb(title) + ']\n' + body + '\n[/spoiler]';
  const withDetail = (name, detail) => bb(name) + (detail ? ' (' + bb(detail) + ')' : '');

  function bbFeats(C, data) {
    const u = UI();
    const rules = SF();
    const out = [];
    u.levelsOf(C).forEach((l, i) => {
      const seen = {};
      rules.grantedAt(C, data, i).forEach((slug) => {
        const rec = own(u.table(data, 'feats'), slug);
        out.push(bb(rec ? rec.name : slug) + ' [i](granted, level ' + (i + 1) + ')[/i]');
      });
      asList(l.feats).forEach((slug) => {
        const k = seen[slug] || 0;
        seen[slug] = k + 1;
        const rec = own(u.table(data, 'feats'), slug);
        out.push(withDetail(rec ? rec.name : slug, featDetail(C, data, i, slug, k)) + ' [i](level ' + (i + 1) + ')[/i]');
      });
    });
    return out;
  }

  function bbFeatures(C, data) {
    const u = UI();
    const rules = SF();
    const out = [];
    const counts = {};
    rules.classFeatures(C, data).forEach((f) => {
      const rec = own(u.table(data, 'features'), f.slug);
      const key = f.levelIndex + '|' + f.slug;
      const k = counts[key] || 0;
      counts[key] = k + 1;
      const detail = paramDetail(data, C.levels[f.levelIndex].choices || {}, f.slug, k);
      out.push(withDetail(rec ? rec.name : f.slug, detail) + ' [i](' + bb(u.className(data, f.cls)) + ' ' + (f.levelIndex + 1) + ')[/i]');
    });
    rules.levelPlan(C, data).forEach((p) => p.entries.forEach((e) => {
      if (!e.skillPick) return;
      const names = asList(p.choices[e.skillPick]).filter((v) => own(rules.SKILLS, v)).map((v) => rules.SKILLS[v].name);
      if (names.length) out.push(bb((e.label || 'Skill choice') + ': ' + names.join(', ')) + ' [i](' + bb(u.className(data, p.cls)) + ' ' + (p.levelIndex + 1) + ')[/i]');
    }));
    return out;
  }

  function bbSpells(C, data) {
    const u = UI();
    const rules = SF();
    const spells = u.table(data, 'spells');
    const name = (slug) => (own(spells, slug) ? spells[slug].name : slug);
    const slots = rules.spellSlots(C, data);
    const conn = rules.connectionSpells(C, data);
    const blocks = [];
    Object.keys(slots).forEach((cls) => {
      const known = slots[cls].known;
      const levels = Object.keys(known).sort((a, b) => a - b);
      const head = bbRow(['Spell level'].concat(levels), 'b');
      const rows = [bbRow(['Known'].concat(levels.map((l) => known[l]))), bbRow(['Per day'].concat(levels.map((l) => (l === '0' ? '\u221E' : slots[cls].perDay[l] || 0))))];
      const learned = [];
      u.levelsOf(C).forEach((l) => {
        if (!l || l.class !== cls) return;
        const sp = l.spells || {};
        asList(sp.learn).forEach((slug) => learned.push(bb(name(slug)) + (own(spells, slug) && Number.isFinite(spells[slug].level) ? ' [i](level ' + spells[slug].level + ')[/i]' : '')));
        if (sp.swap && sp.swap.to) learned.push(bb(name(sp.swap.to)) + ' [i](swapped in for ' + bb(name(sp.swap.from)) + ')[/i]');
      });
      asList(conn[cls]).forEach((c) => learned.push(bb(name(c.slug)) + ' [i](connection, level ' + bb(c.level) + ')[/i]'));
      blocks.push('[b]' + bb(u.className(data, cls)) + '[/b]\n' + bbTable([head].concat(rows)) + (learned.length ? '\n' + bbList(learned) : ''));
    });
    return blocks.join('\n');
  }

  function bbGear(C, data) {
    const items = UI().table(data, 'items');
    const nm = (slug) => (own(items, slug) ? items[slug].name : slug);
    const gear = asList(C.gear).filter(Boolean);
    const ordered = gear.filter((g) => g.equipped).concat(gear.filter((g) => !g.equipped));
    return ordered.map((g) => {
      const parts = asList(g.slots).map((x) => nm(x && x.item)).concat(asList(g.fusions).map((x) => nm(typeof x === 'string' ? x : x && x.item)), g.ability ? ['raises ' + String(g.ability).toUpperCase()] : []);
      const qty = Number(g.qty) > 1 ? ' x' + bb(g.qty) : '';
      return bb(nm(g.item)) + qty + (parts.length ? ' [i](' + bb(parts.join(', ')) + ')[/i]' : '') + (g.equipped ? ' [i](equipped)[/i]' : '');
    });
  }

  function toBBCode(C, data) {
    const u = UI();
    const rules = SF();
    const s = rules.derive(C, data);
    const sign = u.sign;
    const race = own(u.table(data, 'races'), C.race);
    const theme = own(u.table(data, 'themes'), C.theme);
    const sub = [race && race.name, theme && theme.name, u.classSummary(C, data)].filter(Boolean).join(' / ');
    const out = [];
    out.push('[b][size=5]' + bb(C.name || 'Unnamed character') + '[/size][/b]');
    out.push('[i]' + bb(sub || 'No race, theme or class yet') + '[/i]');
    out.push('');
    out.push(bbTable([bbRow(rules.ABILITIES.map((a) => a.toUpperCase()), 'b'), bbRow(rules.ABILITIES.map((a) => s.abilities[a].score + ' (' + sign(s.abilities[a].mod) + ')'))]));
    out.push('');
    out.push('[b]SP[/b] ' + s.sp + '  [b]HP[/b] ' + s.hp + '  [b]RP[/b] ' + s.rp);
    out.push('[b]EAC[/b] ' + s.eac + '  [b]KAC[/b] ' + s.kac + '  [b]CMD[/b] ' + s.cmd);
    out.push('[b]Fort[/b] ' + sign(s.fort) + '  [b]Ref[/b] ' + sign(s.ref) + '  [b]Will[/b] ' + sign(s.will));
    out.push('[b]Init[/b] ' + sign(s.initiative) + '  [b]Speed[/b] ' + s.speed + ' ft  [b]BAB[/b] ' + sign(s.bab));
    const attacks = asList(s.attacks);
    if (attacks.length) {
      out.push('');
      out.push('[b]Attacks[/b]');
      out.push(bbList(attacks.map((a) => bb(a.name) + (a.attack === undefined || a.attack === null || a.attack === false ? '' : ' ' + sign(a.attack)) + (a.damage ? ' (' + bb(a.damage) + (a.crit ? ', crit ' + bb(a.crit) : '') + ')' : ''))));
    }
    const skills = Object.keys(s.skills).map((k) => s.skills[k]).filter((k) => k.ranks > 0 || (k.classSkill && !k.trainedOnly));
    if (skills.length) {
      out.push('');
      out.push('[b]Skills[/b]');
      out.push(bbTable([bbRow(['Skill', 'Ability', 'Ranks', 'Total'], 'b')].concat(skills.map((k) => bbRow([bb(k.name) + (k.classSkill ? ' *' : ''), bb(String(k.ability).toUpperCase()), k.ranks, sign(k.total)])))));
      out.push('[i]* class skill[/i]');
    }
    const feats = bbFeats(C, data);
    if (feats.length) out.push('', bbSpoiler('Feats', bbList(feats)));
    const features = bbFeatures(C, data);
    if (features.length) out.push('', bbSpoiler('Class features', bbList(features)));
    const spells = bbSpells(C, data);
    if (spells) out.push('', bbSpoiler('Spells', spells));
    const gear = bbGear(C, data);
    if (gear.length) out.push('', bbSpoiler('Gear', bbList(gear)));
    if (C.notes && String(C.notes).trim()) out.push('', '[b]Notes[/b]', bb(C.notes));
    return out.join('\n');
  }

  function copyText(value) {
    const doc = root.document;
    const fallback = () => {
      const ta = doc.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      toast(ok ? 'Copied' : 'Could not copy. Select the text and copy it by hand.');
    };
    const nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try { nav.clipboard.writeText(value).then(() => toast('Copied'), fallback); return; } catch (e) { }
    }
    fallback();
  }

  function tabBBCode(C, UIstate, data) {
    return '<div class="card"><h2>BBCode</h2>'
      + '<p class="note">A forum-ready block for Myth-Weavers and other BBCode boards. Brackets in your own text are swapped for full-width ones so they can\'t inject tags.</p>'
      + '<div class="row c"><button class="btn pri" data-act="copyBBCode">Copy</button></div>'
      + '<textarea class="w" rows="24" readonly spellcheck="false" aria-label="BBCode">' + esc(toBBCode(C, data)) + '</textarea></div>';
  }

  function tabPrint(C, UIstate, data, ctx) {
    const x = ctx || UI().ctxOf(C, data);
    const pages = [pageOne(C, data, x.sheet), featPage(C, data), spellPage(C, data), gearPage(C, data)].filter(Boolean);
    return '<div class="card noprint"><h2>Print sheet</h2><p class="note">Use your browser\'s print dialog, or save as PDF.</p><button class="btn pri" data-act="print">Print</button></div>'
      + '<div class="paperwrap"><div class="paper">' + pages.join('') + '</div></div>';
  }

  const actions = {
    print: () => { root.print(); },
    copyBBCode: (C, UIstate, data) => { copyText(toBBCode(C, data)); },
    exportFile: (C) => { download(exportJSON(C), exportName(C), 'application/json'); },
    downloadRaw: () => {
      let text = recovered ? recovered.text : null;
      if (text === null && olderBackup) { try { text = storage().getItem(olderBackup); } catch (e) { text = null; } }
      if (text === null || text === undefined) return;
      download(text, 'sfbuilder-recovered.txt', 'text/plain');
      if (recovered) recovered.backed = true;
    },
    startFresh: () => { recovered = null; }
  };

  function recoveryNotice() {
    const raw = ' <button class="btn sm" data-act="downloadRaw">Download raw</button>';
    if (unbackedPending()) return ' <span class="pill warn">' + esc(UNBACKED) + '</span>' + raw + ' <button class="btn sm" data-act="startFresh">Start fresh</button>';
    if (recovered) return ' <span class="pill warn">' + esc(RECOVERED) + '</span>' + raw;
    if (olderBackup) return ' <span class="pill">A backup of an unreadable save is kept.</span>' + raw;
    return '';
  }

  const hook = {
    load: loadLocal,
    save: saveLocal,
    statusLine: () => (available ? '' : '<span class="pill warn">' + esc(NOT_SAVING) + '</span>')
      + recoveryNotice(),
    tabPrint,
    tabIO,
    tabBBCode,
    actions,
    toBBCode, featDetail, paramDetail,
    VERSION, KEY, ImportError, defaultChar, migrate, exportJSON, importJSON, saveLocal, loadLocal, exportName, applyImport, applyChar, download, toast, probeStorage, recoveredBackup: () => recovered
  };
  probeStorage();
  root.SFCHAR = hook;
  if (typeof module !== 'undefined') module.exports = hook;

  const doc = root.document;
  if (doc && doc.addEventListener) {
    doc.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.dataset || t.dataset.import === undefined) return;
      const file = t.files && t.files[0];
      if (file) readFile(file);
      t.value = '';
    });
  }
})(this);
