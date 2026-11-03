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

  const bonusLib = () => (typeof module !== 'undefined' ? require('./bonus.js') : root.SF);

  function cleanPlay(v) {
    if (!isObject(v)) return undefined;
    const out = {};
    const whole = (x) => { const n = num(x); return n === undefined ? undefined : Math.min(1000000, Math.max(0, Math.floor(n))); };
    [['hp', ['current', 'nonlethal']], ['sp', ['current']], ['rp', ['current']]].forEach(([k, fields]) => {
      if (!isObject(v[k])) return;
      const o = {};
      fields.forEach((f) => put(o, f, whole(v[k][f])));
      if (Object.keys(o).length) out[k] = o;
    });
    if (isObject(v.temp)) {
      const lib = bonusLib();
      const limit = lib.PLAY_TEMP_LIMIT;
      const temp = {};
      Object.keys(v.temp).forEach((k) => {
        const n = num(v.temp[k]);
        if (!safeKey(k) || !lib.playTargets(k) || n === undefined) return;
        const w = Math.max(-limit, Math.min(limit, Math.floor(n)));
        if (w !== 0) temp[k] = w;
      });
      if (Object.keys(temp).length) out.temp = temp;
    }
    put(out, 'conditions', text(v.conditions));
    put(out, 'notes', text(v.notes));
    return Object.keys(out).length ? out : undefined;
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
    put(c, 'play', cleanPlay(raw.play));
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

  const skillTotal = (sk) => (sk.trainedOnly && !sk.ranks ? '—' : UI().sign(sk.total));
  const attackBonus = (a) => (a.attack === undefined || a.attack === null || a.attack === false ? '—' : UI().sign(a.attack));
  const attackDamage = (a) => (a.damage === false ? '—' : a.damage);

  function skillRows(s) {
    const head = '<div class="pp-sk hd"><span></span><span>Skill</span><span>Abil</span><span class="r">Rk</span><span class="r">Total</span></div>';
    return head + Object.keys(s.skills).map((k) => {
      const sk = s.skills[k];
      const total = skillTotal(sk);
      return '<div class="pp-sk"><span>' + (sk.classSkill ? '●' : '') + '</span><span class="n">' + esc(sk.name) + '</span><span class="a">' + esc(sk.ability) + '</span><span class="r">' + esc(sk.ranks) + '</span><b>' + esc(total) + '</b></div>';
    }).join('');
  }

  function attackTable(s) {
    if (!s.attacks.length) return '<p class="pp-note">No attacks.</p>';
    return '<table><thead><tr><th>Attack</th><th class="num">Atk</th><th>Damage</th></tr></thead><tbody>'
      + s.attacks.map((a) => '<tr><td>' + esc(a.name) + (a.notes ? '<div class="pp-note">' + esc(a.notes) + '</div>' : '') + '</td><td class="num">' + esc(attackBonus(a)) + '</td><td>' + esc(attackDamage(a)) + '</td></tr>').join('')
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

  function featEntries(C, data) {
    const u = UI();
    const rules = SF();
    const out = [];
    u.levelsOf(C).forEach((l, i) => {
      const seen = {};
      rules.grantedAt(C, data, i).forEach((slug) => {
        const rec = own(u.table(data, 'feats'), slug);
        out.push({ rec, name: rec ? rec.name : slug, summary: rec && rec.summary, tag: 'granted, level ' + (i + 1), level: i + 1, granted: true });
      });
      asList(l.feats).forEach((slug) => {
        const k = seen[slug] || 0;
        seen[slug] = k + 1;
        const rec = own(u.table(data, 'feats'), slug);
        const detail = featDetail(C, data, i, slug, k);
        out.push({ rec, name: (rec ? rec.name : slug) + (detail ? ' (' + detail + ')' : ''), summary: rec && rec.summary, tag: 'level ' + (i + 1), level: i + 1 });
      });
    });
    return out;
  }

  function featureEntries(C, data) {
    const u = UI();
    const rules = SF();
    const plan = rules.levelPlan(C, data);
    const label = (f) => {
      const e = plan[f.levelIndex].entries.find((x) => x.choice === f.choice);
      return e && e.label ? e.label : '';
    };
    const counts = {};
    const out = rules.classFeatures(C, data).map((f) => {
      const rec = own(u.table(data, 'features'), f.slug);
      const key = f.levelIndex + '|' + f.slug;
      const k = counts[key] || 0;
      counts[key] = k + 1;
      const detail = paramDetail(data, C.levels[f.levelIndex].choices || {}, f.slug, k);
      const from = f.via === 'choice' ? label(f) : '';
      const tag = [from, u.className(data, f.cls) + ' (level ' + (f.levelIndex + 1) + ')'].filter(Boolean).join(', ');
      return { rec, name: (rec ? rec.name : f.slug) + (detail ? ' (' + detail + ')' : ''), summary: rec && rec.summary, tag, from, cls: f.cls, level: f.levelIndex + 1 };
    });
    plan.forEach((p) => p.entries.forEach((e) => {
      if (!e.skillPick) return;
      const names = asList(p.choices[e.skillPick]).filter((v) => own(rules.SKILLS, v)).map((v) => rules.SKILLS[v].name);
      if (names.length) out.push({ rec: null, name: (e.label || 'Skill choice') + ': ' + names.join(', '), summary: '', tag: u.className(data, p.cls) + ' (level ' + (p.levelIndex + 1) + ')', from: '', cls: p.cls, level: p.levelIndex + 1 });
    }));
    return out;
  }

  function featPage(C, data) {
    const feats = featEntries(C, data).map((e) => li(e.name, e.summary, e.tag));
    const features = featureEntries(C, data).map((e) => li(e.name, e.summary, e.tag));
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

  const gearName = (data, slug) => { const items = UI().table(data, 'items'); return own(items, slug) ? items[slug].name : slug; };
  const gearParts = (data, g) => asList(g.slots).map((x) => gearName(data, x && x.item))
    .concat(asList(g.fusions).map((x) => gearName(data, typeof x === 'string' ? x : x && x.item)), g.ability ? ['raises ' + String(g.ability).toUpperCase()] : []);

  function gearPage(C, data) {
    const nm = (slug) => gearName(data, slug);
    const rows = asList(C.gear).filter(Boolean).map((g) => {
      const parts = gearParts(data, g);
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

  const playPath = (C) => { if (!isObject(C.play)) C.play = {}; return C.play; };
  const wholeOr = (v, fallback) => { const n = num(v); return n === undefined ? fallback : Math.max(0, Math.floor(n)); };

  function playCurrent(C, s) {
    const play = isObject(C.play) ? C.play : {};
    const cur = (key, max) => Math.min(max, wholeOr(isObject(play[key]) ? play[key].current : undefined, max));
    return {
      hp: { current: cur('hp', s.hp), max: s.hp, nonlethal: wholeOr(isObject(play.hp) ? play.hp.nonlethal : undefined, 0) },
      sp: { current: cur('sp', s.sp), max: s.sp },
      rp: { current: cur('rp', s.rp), max: s.rp }
    };
  }

  function playAdjust(C, data, key, delta) {
    const cur = playCurrent(C, SF().derive(C, data));
    const step = Math.floor(Number(delta));
    if (!Number.isFinite(step)) return;
    const play = playPath(C);
    if (key === 'nonlethal') {
      play.hp = Object.assign({}, play.hp, { nonlethal: Math.max(0, cur.hp.nonlethal + step) });
      return;
    }
    if (!isObject(cur[key]) || key === 'nonlethal') return;
    play[key] = Object.assign({}, play[key], { current: Math.max(0, Math.min(cur[key].max, cur[key].current + step)) });
  }

  const tempOf = (C, key) => (isObject(C.play) && isObject(C.play.temp) && C.play.temp[key] ? C.play.temp[key] : '');
  const tempInput = (C, key, label) => '<input' + UI().attrs({ type: 'number', class: 'n s', 'data-sel': 'playTemp', 'data-c': key, min: -99, max: 99, value: tempOf(C, key), 'aria-label': 'Temporary bonus to ' + label, placeholder: 'temp' }) + '>';
  const tempNote = (delta) => (delta ? ' <small class="tmp">(temp ' + UI().sign(delta) + ')</small>' : '');
  const sheetStat = (label, value, o) => '<div class="stat"><small>' + esc(label) + '</small><span class="big">' + esc(value) + '</span>' + tempNote(o && o.delta) + (o && o.input ? '<div>' + o.input + '</div>' : '') + '</div>';
  const sheetCard = (title, boxes) => '<div class="card"><h2>' + esc(title) + '</h2><div class="csbox">' + boxes.join('') + '</div></div>';
  const named = (rec, name) => '<b>' + esc(name) + '</b> ' + UI().aon(rec);
  const sheetEntry = (e) => '<div class="csli">' + named(e.rec, e.name) + (e.from || e.level ? ' <small class="mute">' + esc([e.from, e.level ? 'level ' + e.level : ''].filter(Boolean).join(', ')) + '</small>' : '') + (e.summary ? '<div class="note">' + esc(e.summary) + '</div>' : '') + '</div>';

  function sheetIdentity(C, data, s) {
    const u = UI();
    const race = own(u.table(data, 'races'), C.race);
    const theme = own(u.table(data, 'themes'), C.theme);
    const size = race && race.size ? String(race.size).charAt(0).toUpperCase() + String(race.size).slice(1) : '';
    const kv = [['Race', race ? race.name : ''], ['Theme', theme ? theme.name : ''], ['Classes', u.classSummary(C, data)], ['Level', u.levelsOf(C).length || ''], ['Size', size], ['Speed', s.speed + ' ft']]
      .map((r) => '<span>' + esc(r[0]) + '</span><span>' + (r[1] === '' ? '<span class="mute">None</span>' : esc(r[1])) + '</span>').join('');
    const links = [race && u.aon(race), theme && u.aon(theme)].filter(Boolean).join(' ');
    return '<div class="card"><h1 class="csname">' + esc(C.name || 'Unnamed character') + '</h1><div class="kv">' + kv + '</div>' + (links ? '<div class="note">' + links + '</div>' : '') + '</div>';
  }

  function sheetPlay(C, UIstate, data, s) {
    const u = UI();
    const cur = playCurrent(C, s);
    const meter = (key, label, extra) => {
      const m = cur[key];
      const input = '<input' + u.attrs({ type: 'number', class: 'n s', 'data-b': 'play.' + key + '.current', 'data-t': 'n', min: 0, max: m.max, 'data-min': 0, 'data-max': m.max, value: m.current, 'aria-label': 'Current ' + label }) + '>';
      return '<div class="stat"><small>' + esc(label) + '</small><div class="curow">' + u.btn('playAdj', '−', { c: 'sm', a: key, b: -1, title: label + ' −1' }) + input + u.btn('playAdj', '+', { c: 'sm', a: key, b: 1, title: label + ' +1' }) + '</div><span class="note">of ' + esc(m.max) + '</span>' + (extra || '') + '</div>';
    };
    const nonlethal = '<div class="curow">' + u.btn('playAdj', '−', { c: 'sm', a: 'nonlethal', b: -1, title: 'Nonlethal −1' }) + '<input' + u.attrs({ type: 'number', class: 'n s', 'data-b': 'play.hp.nonlethal', 'data-t': 'n', 'data-z': 'del', min: 0, 'data-min': 0, value: cur.hp.nonlethal || '', 'aria-label': 'Nonlethal damage', placeholder: '0' }) + '>' + u.btn('playAdj', '+', { c: 'sm', a: 'nonlethal', b: 1, title: 'Nonlethal +1' }) + '</div><span class="note">nonlethal</span>';
    const actions = '<div class="row c">' + u.btn('playRest', 'Rest', { title: 'Restore SP and RP to max' }) + u.btn('playHeal', 'Heal to full', { title: 'Restore HP to max and clear nonlethal damage' }) + u.btn('playResetTemp', 'Reset temp bonuses') + '</div>';
    const play = isObject(C.play) ? C.play : {};
    const conditions = '<label class="fld">Conditions<input type="text" class="w" data-b="play.conditions" value="' + esc(play.conditions || '') + '"></label>';
    const notes = '<label class="fld">Session notes<textarea class="w" rows="3" data-b="play.notes">' + esc(play.notes || '') + '</textarea></label>';
    return '<div class="card"><h2>Vitals</h2><div class="csbox">' + meter('hp', 'HP', nonlethal) + meter('sp', 'SP') + meter('rp', 'RP') + '</div>' + actions + '<div class="g2">' + conditions + notes + '</div></div>';
  }

  function sheetAbilities(C, p, b) {
    const u = UI();
    return '<div class="card"><h2>Abilities</h2><div class="csbox">' + SF().ABILITIES.map((a) => '<div class="ab"><b>' + esc(a.toUpperCase()) + '</b><div class="tot">' + esc(p.abilities[a].score) + '</div>' + tempNote(p.abilities[a].score - b.abilities[a].score) + '<div class="md">' + esc(u.sign(p.abilities[a].mod)) + '</div><div>' + tempInput(C, a, a.toUpperCase()) + '</div></div>').join('') + '</div></div>';
  }

  function sheetAttacks(C, p, b) {
    const head = '<tr><th>Attack</th><th class="num">Atk</th><th>Damage</th><th>Crit</th><th>Range</th><th>Notes</th></tr>';
    const rows = p.attacks.map((a, i) => '<tr><td>' + esc(a.name) + '</td><td class="num"><b>' + esc(attackBonus(a)) + '</b>' + (b.attacks[i] && Number.isFinite(a.attack) && Number.isFinite(b.attacks[i].attack) ? tempNote(a.attack - b.attacks[i].attack) : '') + '</td><td>' + esc(attackDamage(a)) + '</td><td>' + esc(a.crit || '—') + '</td><td>' + esc(a.range || '—') + '</td><td class="note">' + esc(a.notes) + '</td></tr>').join('');
    const temps = '<div class="row c">' + [['attack.melee', 'Melee attack'], ['attack.ranged', 'Ranged attack'], ['damage.all', 'All damage']].map((t) => '<label class="fld">' + esc(t[1]) + tempInput(C, t[0], t[1]) + '</label>').join('') + '</div>';
    return '<div class="card"><h2>Attacks</h2>' + (rows ? '<div class="scroll"><table class="t">' + head + rows + '</table></div>' : '<p class="note">No attacks.</p>') + temps + '</div>';
  }

  function sheetSkills(C, p, b) {
    const rows = Object.keys(p.skills).map((k) => {
      const sk = p.skills[k];
      return '<tr><td class="skcol">' + (sk.classSkill ? '●' : '') + '</td><td>' + esc(sk.name) + '</td><td class="mute">' + esc(sk.ability.toUpperCase()) + '</td><td class="num">' + esc(sk.ranks) + '</td><td class="num"><b>' + esc(skillTotal(sk)) + '</b>' + tempNote(sk.total - b.skills[k].total) + '</td><td>' + tempInput(C, 'skill.' + k, sk.name) + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>Skills</h2><div class="scroll"><table class="t"><tr><th></th><th>Skill</th><th>Abil</th><th class="num">Ranks</th><th class="num">Total</th><th>Temp</th></tr>' + rows + '</table></div><p class="note">● class skill. — trained only, no ranks.</p></div>';
  }

  function sheetSituational(s) {
    const u = UI();
    const rows = asList(s.situational).map((m) => {
      const v = /^-?\d+$/.test(String(m.modifier)) ? u.sign(m.modifier) : m.modifier;
      const what = [v, m.effectType, m.valueAffected].filter((x) => x !== undefined && x !== null && x !== '').join(' ');
      return '<div class="csli"><b>' + esc(m.source) + '</b> ' + esc(what) + (m.condition ? ' <small class="mute">' + esc(m.condition) + '</small>' : '') + (m.notes ? '<div class="note">' + esc(m.notes) + '</div>' : '') + '</div>';
    });
    return rows.length ? '<div class="card"><h2>Situational</h2>' + rows.join('') + '</div>' : '';
  }

  function sheetFeats(C, data) {
    const rows = featEntries(C, data).map(sheetEntry);
    return '<div class="card"><h2>Feats</h2>' + (rows.join('') || '<p class="note">None.</p>') + '</div>';
  }

  function sheetFeatures(C, data) {
    const u = UI();
    const groups = [];
    featureEntries(C, data).forEach((e) => {
      let g = groups.find((x) => x.cls === e.cls);
      if (!g) { g = { cls: e.cls, rows: [] }; groups.push(g); }
      g.rows.push(e);
    });
    const body = groups.map((g) => '<h3>' + esc(u.className(data, g.cls)) + '</h3>' + g.rows.map(sheetEntry).join('')).join('');
    return '<div class="card"><h2>Class features</h2>' + (body || '<p class="note">None.</p>') + '</div>';
  }

  function sheetTraits(C, data) {
    const u = UI();
    const features = u.table(data, 'features');
    const total = SF().charLevel(C);
    const race = own(u.table(data, 'races'), C.race);
    const theme = own(u.table(data, 'themes'), C.theme);
    const rec = (k) => own(features, k);
    const gated = (k) => !(typeof rec(k).level === 'number') || rec(k).level <= total;
    const entry = (k) => sheetEntry({ rec: rec(k), name: rec(k).name, summary: rec(k).summary });
    const racial = asList(race && race.coreTraits).filter(rec).map(entry);
    const thematic = asList(theme && theme.features).filter((k) => rec(k) && gated(k)).map(entry);
    const block = (title, rows) => (rows.length ? '<h3>' + esc(title) + '</h3>' + rows.join('') : '');
    const body = block('Racial traits', racial) + block('Theme', thematic);
    return '<div class="card"><h2>Traits</h2>' + (body || '<p class="note">None.</p>') + '</div>';
  }

  function knownSpellsOf(C, cls) {
    const known = [];
    UI().levelsOf(C).forEach((l) => {
      if (!l || l.class !== cls) return;
      const sp = l.spells || {};
      asList(sp.learn).forEach((k) => { if (known.indexOf(k) === -1) known.push(k); });
      if (sp.swap && sp.swap.to) {
        const at = known.indexOf(sp.swap.from);
        if (at !== -1) known.splice(at, 1);
        if (known.indexOf(sp.swap.to) === -1) known.push(sp.swap.to);
      }
    });
    return known;
  }

  function sheetSpells(C, data) {
    const u = UI();
    const rules = SF();
    const spells = u.table(data, 'spells');
    const slots = rules.spellSlots(C, data);
    const conn = rules.connectionSpells(C, data);
    return Object.keys(slots).map((cls) => {
      const levels = Object.keys(slots[cls].known).sort((a, b) => a - b);
      const grid = '<div class="scroll"><table class="t"><tr><th>Spell level</th>' + levels.map((l) => '<th class="num">' + esc(l) + '</th>').join('') + '</tr>'
        + '<tr><td>Known</td>' + levels.map((l) => '<td class="num">' + esc(slots[cls].known[l]) + '</td>').join('') + '</tr>'
        + '<tr><td>Per day</td>' + levels.map((l) => '<td class="num">' + (l === '0' ? '∞' : esc(slots[cls].perDay[l] || 0)) + '</td>').join('') + '</tr></table></div>';
      const entries = knownSpellsOf(C, cls).map((k) => ({ slug: k, connection: false }))
        .concat(asList(conn[cls]).map((c) => ({ slug: c.slug, connection: true, level: c.level })));
      const byLevel = {};
      entries.forEach((e) => {
        const r = own(spells, e.slug);
        const lvl = r && Number.isFinite(r.level) ? r.level : e.level === undefined ? '?' : e.level;
        (byLevel[lvl] = byLevel[lvl] || []).push(Object.assign({ rec: r }, e));
      });
      const lists = Object.keys(byLevel).sort((a, b) => a - b).map((lvl) => '<h3>Level ' + esc(lvl) + '</h3>' + byLevel[lvl].map((e) => sheetEntry({ rec: e.rec, name: e.rec ? e.rec.name : e.slug, summary: e.rec && e.rec.summary, from: e.connection ? 'connection' : '' })).join('')).join('');
      return '<div class="card"><h2>Spells: ' + esc(u.className(data, cls)) + '</h2>' + grid + lists + '</div>';
    }).join('');
  }

  function sheetGear(C, data, s) {
    const u = UI();
    const items = u.table(data, 'items');
    const b = SF().budget(C, data);
    const gear = asList(C.gear).filter(Boolean);
    const ordered = gear.filter((g) => g.equipped).concat(gear.filter((g) => !g.equipped));
    const state = s.bulk.state === 'ok' ? '<span class="pill on">Unencumbered</span>' : '<span class="pill warn">' + (s.bulk.state === 'overburdened' ? 'Overburdened' : 'Encumbered') + '</span>';
    const rows = ordered.map((g) => {
      const rec = own(items, g.item);
      const parts = gearParts(data, g);
      const bulk = rec && rec.bulk !== undefined && rec.bulk !== '' && rec.bulk !== '-' ? rec.bulk : '—';
      return '<tr><td>' + named(rec, rec ? rec.name : g.item) + (parts.length ? '<div class="note">' + esc(parts.join(', ')) + '</div>' : '') + '</td><td class="num">' + esc(g.qty) + '</td><td class="num">' + esc(bulk) + '</td><td>' + (g.equipped ? 'equipped' : '') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>Gear</h2><div class="wallet"><span>Credits left <b class="' + (b.left < 0 ? 'bad' : '') + '">' + esc(u.fmt(b.left)) + '</b></span><span>Bulk <b>' + esc(s.bulk.carried) + '</b> of ' + esc(s.bulk.limit) + '</span>' + state + '</div>'
      + (rows ? '<div class="scroll"><table class="t"><tr><th>Item</th><th class="num">Qty</th><th class="num">Bulk</th><th></th></tr>' + rows + '</table></div>' : '<p class="note">No gear.</p>') + '</div>';
  }

  function tabSheet(C, UIstate, data, ctx) {
    const u = UI();
    const build = (ctx || u.ctxOf(C, data)).sheet;
    const p = SF().derive(C, data, { play: true });
    const sign = u.sign;
    const d = (k) => p[k] - build[k];
    const t = (key, label, value, delta) => sheetStat(label, value, { delta, input: tempInput(C, key, label) });
    const notes = C.notes ? '<div class="card"><h2>Notes</h2><div class="csnotes">' + esc(C.notes) + '</div></div>' : '';
    const hasTemp = isObject(C.play) && isObject(C.play.temp) && Object.keys(C.play.temp).length;
    const reset = hasTemp ? '<p class="note">Temporary bonuses are untyped, shown on this tab only, and never change the build, Print or exports.</p>' : '';
    return '<div class="cs">' + sheetIdentity(C, data, p) + sheetPlay(C, UIstate, data, p) + sheetAbilities(C, p, build)
      + sheetCard('Defense', [t('eac', 'EAC', p.eac, d('eac')), t('kac', 'KAC', p.kac, d('kac')), t('cmd', 'CMD', p.cmd, d('cmd')), t('fort', 'Fort', sign(p.fort), d('fort')), t('ref', 'Ref', sign(p.ref), d('ref')), t('will', 'Will', sign(p.will), d('will'))])
      + sheetCard('Offense', [t('initiative', 'Init', sign(p.initiative), d('initiative')), sheetStat('BAB', sign(p.bab)), t('speed.land', 'Speed', p.speed + ' ft', d('speed'))])
      + reset + sheetAttacks(C, p, build) + sheetSkills(C, p, build) + sheetSituational(p) + sheetFeats(C, data) + sheetFeatures(C, data) + sheetTraits(C, data)
      + sheetSpells(C, data) + sheetGear(C, data, p) + notes + '</div>';
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
    startFresh: () => { recovered = null; },
    playAdj: (C, UIstate, data, key, delta) => { playAdjust(C, data, key, delta); },
    playRest: (C) => { if (isObject(C.play)) { delete C.play.sp; delete C.play.rp; } },
    playHeal: (C) => { if (isObject(C.play)) delete C.play.hp; },
    playResetTemp: (C) => { if (isObject(C.play)) delete C.play.temp; }
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
    tabSheet,
    tabIO,
    tabBBCode,
    actions,
    toBBCode, featDetail, paramDetail,
    VERSION, KEY, ImportError, defaultChar, migrate, exportJSON, importJSON, saveLocal, loadLocal, exportName, applyImport, applyChar, download, toast, probeStorage, recoveredBackup: () => recovered, playCurrent, playAdjust
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
