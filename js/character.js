(function(root){
  const VERSION = 1;
  const KEY = 'sfbuilder.v1';
  const PROBE = 'sfbuilder.probe';
  const RECOVERED = 'Your saved character could not be read. A copy was kept.';
  const NOT_SAVING = 'Not saving: export to keep your work';

  class ImportError extends Error {
    constructor(message) { super(message); this.name = 'ImportError'; }
  }

  let available = false;
  let recovered = null;

  const UI = () => root.SFUI || {};
  const SF = () => root.SF;
  const esc = (s) => UI().esc(s);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function defaultChar() {
    return {
      v: VERSION, name: '', race: '', variant: null, theme: '',
      abilities: { pb: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
      levels: [], gear: [], notes: ''
    };
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
    const c = Object.assign(defaultChar(), clone(raw), { v: VERSION });
    if (!isObject(c.abilities)) c.abilities = defaultChar().abilities;
    if (!isObject(c.abilities.pb)) c.abilities.pb = {};
    if (!Array.isArray(c.gear)) c.gear = [];
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

  function saveLocal(char) {
    try {
      const s = storage();
      if (!s) throw new Error('no storage');
      s.setItem(KEY, exportJSON(char));
      return true;
    } catch (e) {
      available = false;
      return false;
    }
  }

  function keepBackup(text) {
    const key = KEY + '.backup-' + Date.now();
    recovered = { key, text };
    try { storage().setItem(key, text); } catch (e) { }
  }

  function loadLocal() {
    recovered = null;
    let text = null;
    try {
      const s = storage();
      text = s ? s.getItem(KEY) : null;
    } catch (e) { return null; }
    if (!text) return null;
    try { return importJSON(text); } catch (e) {
      keepBackup(text);
      return null;
    }
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
    UI().setCharacter(c);
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
    const race = u.table(data, 'races')[C.race];
    const theme = u.table(data, 'themes')[C.theme];
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
    const def = rules.FEAT_CHOICE[slug];
    if (def) {
      const v = asList(choices[slug])[k];
      if (!v) return '';
      if (def.kind === 'special') return (UI().table(data, 'items')[v] || {}).name || v;
      return rules.TYPE_NAME[v] || v;
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
      asList(l.feats).forEach((slug) => {
        const k = seen[slug] || 0;
        seen[slug] = k + 1;
        const rec = u.table(data, 'feats')[slug];
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
      const rec = u.table(data, 'features')[f.slug];
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
      const names = asList(p.choices[e.skillPick]).filter((v) => rules.SKILLS[v]).map((v) => rules.SKILLS[v].name);
      if (names.length) features.push(li((e.label || 'Skill choice') + ': ' + names.join(', '), '', u.className(data, p.cls) + ' (level ' + (p.levelIndex + 1) + ')'));
    }));
    if (!feats.length && !features.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Class features</div><div class="pp-list">' + (features.join('') || '<div class="pp-note">None.</div>') + '</div></div>'
      + '<div class="pp-sec"><div class="pp-h">Feats</div><div class="pp-list">' + (feats.join('') || '<div class="pp-note">None.</div>') + '</div></div></section>';
  }

  function spellPage(C, data) {
    const u = UI();
    const spells = u.table(data, 'spells');
    const name = (slug) => (spells[slug] ? spells[slug].name : slug);
    const rows = [];
    u.levelsOf(C).forEach((l, i) => {
      const sp = l.spells || {};
      asList(sp.learn).forEach((slug) => {
        const rec = spells[slug];
        rows.push(li(name(slug), rec && rec.summary, (rec && Number.isFinite(rec.level) ? 'spell level ' + rec.level + ', ' : '') + 'learned at level ' + (i + 1)));
      });
      if (sp.swap && sp.swap.to) rows.push(li(name(sp.swap.to), 'Replaces ' + name(sp.swap.from), 'swapped at level ' + (i + 1)));
    });
    if (!rows.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Spells</div><div class="pp-list">' + rows.join('') + '</div></div></section>';
  }

  function gearPage(C, data) {
    const items = UI().table(data, 'items');
    const nm = (slug) => (items[slug] ? items[slug].name : slug);
    const rows = asList(C.gear).filter(Boolean).map((g) => {
      const parts = asList(g.slots).map((x) => nm(x && x.item)).concat(asList(g.fusions).map((x) => nm(typeof x === 'string' ? x : x && x.item)));
      return '<tr><td>' + esc(nm(g.item)) + (parts.length ? '<div class="pp-note">' + esc(parts.join(', ')) + '</div>' : '') + '</td><td class="num">' + esc(g.qty) + '</td><td>' + (g.equipped ? 'equipped' : '') + '</td></tr>';
    });
    if (!rows.length) return '';
    return '<section class="pp-page"><div class="pp-sec"><div class="pp-h">Gear</div><table><thead><tr><th>Item</th><th class="num">Qty</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></section>';
  }

  function tabPrint(C, UIstate, data, ctx) {
    const x = ctx || UI().ctxOf(C, data);
    const pages = [pageOne(C, data, x.sheet), featPage(C, data), spellPage(C, data), gearPage(C, data)].filter(Boolean);
    return '<div class="card noprint"><h2>Print sheet</h2><p class="note">Use your browser\'s print dialog, or save as PDF.</p><button class="btn pri" data-act="print">Print</button></div>'
      + '<div class="paperwrap"><div class="paper">' + pages.join('') + '</div></div>';
  }

  const actions = {
    print: () => { root.print(); },
    exportFile: (C) => { download(exportJSON(C), exportName(C), 'application/json'); },
    downloadRaw: () => { if (recovered) download(recovered.text, 'sfbuilder-recovered.txt', 'text/plain'); }
  };

  const hook = {
    load: loadLocal,
    save: saveLocal,
    statusLine: () => (available ? '' : '<span class="pill warn">' + esc(NOT_SAVING) + '</span>')
      + (recovered ? ' <span class="pill warn">' + esc(RECOVERED) + '</span> <button class="btn sm" data-act="downloadRaw">Download raw</button>' : ''),
    tabPrint,
    tabIO,
    actions,
    VERSION, KEY, ImportError, defaultChar, migrate, exportJSON, importJSON, saveLocal, loadLocal, exportName, applyImport, probeStorage, recoveredBackup: () => recovered
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
