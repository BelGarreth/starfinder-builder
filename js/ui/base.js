(function(root){
  const U = root.SFUI = root.SFUI || {};
  const SF = () => root.SF;

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const sign = (n) => { const v = Number(n) || 0; return (v >= 0 ? '+' : '') + v; };
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const own = (o, k) => (has(o, k) ? o[k] : undefined);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const levelsOf = (C) => (C && Array.isArray(C.levels) ? C.levels : []);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const table = (data, name) => (data && data[name]) || {};
  const ROW_CAP = 200;

  const TABS = [
    ['char', 'Character'], ['abilities', 'Abilities'], ['class', 'Class features'], ['skills', 'Skills'],
    ['feats', 'Feats'], ['gear', 'Gear'], ['spells', 'Spells'], ['print', 'Print'], ['io', 'Import/Export'], ['bbcode', 'BBCode'], ['mythweavers', 'Myth-Weavers']
  ];
  const TAB_LABEL = {};
  TABS.forEach(([k, l]) => { TAB_LABEL[k] = l; });

  const searchUrl = (name) => 'https://www.aonsrd.com/Search.aspx?Query=' + encodeURIComponent(name);
  const aon = (rec) => (rec ? '<a class="aon" href="' + esc(rec.aon || searchUrl(rec.name || '')) + '" target="_blank" rel="noopener">AoN ↗</a>' : '');

  function attrs(o) {
    return Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== false)
      .map((k) => (o[k] === true ? ' ' + k : ' ' + k + '="' + esc(o[k]) + '"')).join('');
  }

  function btn(act, label, o) {
    const x = o || {};
    return '<button' + attrs({ class: 'btn ' + (x.c || ''), 'data-act': act, 'data-a': x.a, 'data-b2': x.b, 'data-c': x.cc, disabled: !!x.d, title: x.title }) + '>' + label + '</button>';
  }

  function getPath(C, UI, p) {
    const src = p.charAt(0) === '$' ? UI : C;
    const q = p.charAt(0) === '$' ? p.slice(1) : p;
    return q.split('.').reduce((a, k) => (a === undefined || a === null ? a : a[k]), src);
  }

  function input(C, UI, p, o) {
    const x = o || {};
    const v = getPath(C, UI, p);
    if (x.t === 'n') {
      return '<input type="number"' + attrs({ 'data-b': p, 'data-t': 'n', 'data-z': x.z ? 'del' : undefined, min: x.min, max: x.max, 'data-min': x.min, 'data-max': x.max, class: 'n ' + (x.c || ''), value: v === undefined || v === null ? '' : v }) + '>';
    }
    if (x.t === 'ta') return '<textarea' + attrs({ 'data-b': p, rows: x.rows || 3, class: 'w' }) + '>' + esc(v) + '</textarea>';
    return '<input type="text"' + attrs({ 'data-b': p, value: v === undefined || v === null ? '' : v, placeholder: x.ph, class: x.c || 'w' }) + '>';
  }

  function select(p, value, options, o) {
    const x = o || {};
    const opts = options.map((op) => '<option' + attrs({ value: op[0], selected: String(op[0]) === String(value === undefined || value === null ? '' : value), disabled: !!op[2] }) + '>' + esc(op[1]) + '</option>').join('');
    return '<select' + attrs({ 'data-b': x.sel ? undefined : p, 'data-sel': x.sel, 'data-a': x.a, 'data-c': x.cc, class: x.c }) + '>' + opts + '</select>';
  }

  function paramPicker(C, data, i, entry) {
    const rules = SF();
    const p = entry.rec.param;
    const noun = p.kind === 'skill' ? 'skill' : 'energy type';
    const keys = rules.optionKeys(p);
    const selects = rules.picksOf(C, entry).map((value, s) => {
      const index = entry.k * p.count + s;
      const opts = [['', '(choose a ' + noun + ')']].concat(keys.map((k) => {
        const ans = rules.allowed('choice', k, i, C, data, { id: entry.key, index });
        return [k, ans.ok ? rules.optionName(p.kind, k) : ans.why, !ans.ok && k !== value];
      }));
      return fld(entry.rec.name + (p.count > 1 ? ' ' + (s + 1) : ''), select(null, value, opts, { sel: 'paramChoice', a: i, cc: entry.key + '|' + index }));
    });
    return '<div class="row c">' + selects.join('') + '</div>';
  }

  const fld = (label, html, c) => '<label class="fld ' + (c || '') + '">' + esc(label) + html + '</label>';

  function pickRow(rec, o) {
    const x = o || {};
    const ans = x.ans || { ok: true };
    const label = x.on ? (x.onLabel || 'Chosen') : (x.label || 'Choose');
    const why = ans.why && !ans.quiet ? '<div class="why' + (ans.ok ? ' soft' : '') + '">' + esc(ans.why) + '</div>' : '';
    const extra = x.extra ? ' <span class="mute">' + x.extra + '</span>' : '';
    const summary = rec && rec.summary ? '<div class="note">' + esc(rec.summary) + '</div>' : '';
    const button = x.noButton ? '' : btn(x.act, label, { c: 'sm' + (x.on ? ' pri' : ''), a: x.a, b: x.b, cc: x.cc, d: !x.on && !ans.ok, title: !ans.ok ? ans.why : undefined });
    return '<tr class="' + (ans.ok || x.on ? '' : 'dis') + (x.on ? ' on' : '') + '"><td><b class="nm">' + esc(rec ? rec.name : x.slug) + '</b>' + extra + summary + why + '</td><td class="acts">' + aon(rec) + ' ' + button + '</td></tr>';
  }

  const pickTable = (rows, cls) => '<div class="scroll ' + (cls || '') + '"><table class="t pick"><tbody>' + rows.join('') + '</tbody></table></div>';

  function capped(list, render) {
    const shown = list.slice(0, ROW_CAP).map(render);
    const more = list.length > ROW_CAP ? '<p class="note">Showing ' + ROW_CAP + ' of ' + fmt(list.length) + '. Refine your search to see the rest.</p>' : '';
    const none = list.length ? '' : '<p class="note">Nothing matches.</p>';
    return { rows: shown, note: more + none, count: list.length };
  }

  const hideToggle = (UI) => '<label class="note tog"><input type="checkbox" data-b="$hideIneligible" data-t="b"' + (UI && UI.hideIneligible ? ' checked' : '') + '> Hide options I don\'t qualify for</label>';

  const eligibleOnly = (UI, list, answer, keep) => (UI && UI.hideIneligible ? list.filter((k) => (keep && keep(k)) || answer(k).ok) : list);

  const matches = (rec, q) => !q || String(rec.name || '').toLowerCase().indexOf(String(q).toLowerCase().trim()) !== -1;

  function isCaster(C, data) {
    return levelsOf(C).some((l) => l && !!SF().spellListOf(l.class, data));
  }

  const visibleTabs = (C, data) => TABS.filter((t) => t[0] !== 'spells' || isCaster(C, data));

  const ctxOf = (C, data) => ({ sheet: SF().derive(C, data), blockers: SF().validate(C, data) });

  const className = (data, slug) => (own(table(data, 'classes'), slug) || {}).name || String(slug);

  function classSummary(C, data) {
    const out = [];
    const seen = {};
    levelsOf(C).forEach((l) => {
      if (!l) return;
      if (!seen[l.class]) { seen[l.class] = 0; out.push(l.class); }
      seen[l.class]++;
    });
    return out.map((k) => className(data, k) + ' ' + seen[k]).join(' / ');
  }

  function blockerMsg(b, C) {
    if (b.tab === 'char' && b.code === 'missing' && !C.race && (b.ref === C.race || b.ref === undefined)) return 'Choose a race';
    return b.msg;
  }

  function renderTop(C, UI, data, ctx) {
    const x = ctx || ctxOf(C, data);
    const s = x.sheet;
    const race = own(table(data, 'races'), C.race);
    const theme = own(table(data, 'themes'), C.theme);
    const lvl = levelsOf(C).length;
    const sub = [race && race.name, theme && theme.name, classSummary(C, data), lvl ? 'level ' + lvl : ''].filter(Boolean);
    const stat = (k, v) => '<span>' + k + ' <b>' + esc(v) + '</b></span>';
    const bulk = s.bulk && s.bulk.state !== 'ok'
      ? '<span class="pill warn" title="Carrying too much is legal but slows you down">' + (s.bulk.state === 'overburdened' ? 'Overburdened' : 'Encumbered') + ' (bulk ' + esc(s.bulk.carried) + ' of ' + esc(s.bulk.limit) + ')</span>'
      : '';
    const store = root.SFCHAR;
    const status = store && typeof store.statusLine === 'function' ? store.statusLine(C, UI, data) : '';
    return '<div class="who"><h1>' + esc(C.name || 'Unnamed character') + '</h1><div class="sub">' + esc(sub.join(' · ') || 'No race, theme or class yet') + '</div></div>'
      + '<div class="wallet stats">' + stat('SP', s.sp) + stat('HP', s.hp) + stat('RP', s.rp) + stat('EAC', s.eac) + stat('KAC', s.kac)
      + stat('Fort', sign(s.fort)) + stat('Ref', sign(s.ref)) + stat('Will', sign(s.will)) + stat('Init', sign(s.initiative)) + bulk + '</div>'
      + '<div class="acts">' + status + '</div>';
  }

  function renderTabs(C, UI, data, ctx) {
    const x = ctx || ctxOf(C, data);
    const counts = {};
    x.blockers.forEach((b) => { counts[b.tab] = (counts[b.tab] || 0) + 1; });
    return visibleTabs(C, data).map(([k, l]) => '<button data-act="tab" data-a="' + k + '" class="' + (UI.tab === k ? 'on' : '') + '">' + l + (counts[k] ? ' <span class="cnt">' + esc(counts[k]) + '</span>' : '') + '</button>').join('');
  }

  function renderBlockers(C, UI, data, ctx) {
    const x = ctx || ctxOf(C, data);
    if (!x.blockers.length) return '';
    const groups = {};
    x.blockers.forEach((b) => { (groups[b.tab] = groups[b.tab] || []).push(b); });
    const order = TABS.map((t) => t[0]).filter((k) => groups[k]).concat(Object.keys(groups).filter((k) => !TAB_LABEL[k]));
    return '<div class="blockers"><b class="bad">Still to do</b>' + order.map((tab) => '<div class="blg"><span class="mute">' + esc(TAB_LABEL[tab] || tab) + '</span>'
      + groups[tab].map((b) => '<button class="blb" data-act="goto" data-a="' + esc(tab) + '"' + (b.level ? ' data-b2="' + (b.level - 1) + '"' : '') + '>' + esc(blockerMsg(b, C)) + '</button>').join('') + '</div>').join('') + '</div>';
  }

  function levelTabs(C, UI, data, ctx, tab) {
    const lv = levelsOf(C);
    if (!lv.length) return '';
    const flagged = {};
    ctx.blockers.forEach((b) => { if (b.tab === tab && b.level) flagged[b.level - 1] = true; });
    const plan = SF().levelPlan(C, data);
    return '<div class="sub-tabs">' + lv.map((l, i) => '<button data-act="lvl" data-a="' + i + '" class="' + (U.levelIndex(C, UI) === i ? 'on' : '') + '">' + (i + 1) + ' · ' + esc(className(data, l && l.class)) + ' ' + esc((plan[i] || {}).classLevel || '') + (flagged[i] ? ' <span class="bad">•</span>' : '') + '</button>').join('') + '</div>';
  }

  U.levelIndex = (C, UI) => Math.max(0, Math.min(levelsOf(C).length - 1, Number(UI.lvl) || 0));

  Object.assign(U, {
    hideToggle, eligibleOnly, esc, sign, has, own, asList, levelsOf, fmt, table, ROW_CAP, TABS, TAB_LABEL, aon, attrs, btn, getPath, input, select, fld,
    paramPicker, pickRow, pickTable, capped, matches, isCaster, visibleTabs, ctxOf, className, classSummary, blockerMsg,
    renderTop, renderTabs, renderBlockers, levelTabs
  });
})(this);
