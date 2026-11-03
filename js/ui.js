(function(root){
  const U = root.SFUI = root.SFUI || {};
  const SF = () => root.SF;
  const { asList, levelsOf, TABS } = U;
  const store = () => root.SFCHAR || null;

  U.blank = () => ({
    v: 1, name: '', race: '', variant: null, theme: '',
    abilities: { pb: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
    levels: [], gear: [], notes: ''
  });
  U.blankUI = () => ({ tab: 'char', lvl: 0, enh: {}, swapFrom: {} });
  U.newLevel = (cls) => ({ class: cls, increases: [], skills: {}, feats: [], choices: {}, spells: {} });

  const placeholder = (title) => '<div class="card"><h2>' + title + '</h2><p class="note">Coming soon.</p></div>';
  U.tabPrint = U.tabPrint || ((C, UI, data, ctx) => (store() && store().tabPrint ? store().tabPrint(C, UI, data, ctx) : placeholder('Print')));
  U.tabIO = U.tabIO || ((C, UI, data, ctx) => (store() && store().tabIO ? store().tabIO(C, UI, data, ctx) : placeholder('Import/Export')));

  const TAB_FN = { char: 'tabChar', abilities: 'tabAbilities', class: 'tabClass', skills: 'tabSkills', feats: 'tabFeats', gear: 'tabGear', spells: 'tabSpells', print: 'tabPrint', io: 'tabIO' };

  U.renderMain = function (C, UI, data, ctx) {
    const x = ctx || U.ctxOf(C, data);
    const visible = U.visibleTabs(C, data).map((t) => t[0]);
    const tab = visible.indexOf(UI.tab) !== -1 ? UI.tab : 'char';
    return U[TAB_FN[tab]](C, UI, data, x);
  };

  U.view = function (C, UI, data) {
    const ctx = U.ctxOf(C, data);
    return {
      top: U.renderTop(C, UI, data, ctx),
      tabs: U.renderTabs(C, UI, data, ctx),
      blockers: U.renderBlockers(C, UI, data, ctx),
      main: U.renderMain(C, UI, data, ctx),
      ctx
    };
  };

  U.normalize = function (C, data) {
    const race = (data.races || {})[C.race];
    C.variant = race ? race.variant || null : null;
    if (!C.abilities) C.abilities = { pb: {} };
    if (!C.abilities.pb) C.abilities.pb = {};
    if (!Array.isArray(C.gear)) C.gear = [];
    levelsOf(C).forEach((l) => {
      if (!l.choices) l.choices = {};
      Object.keys(SF().FEAT_CHOICE).forEach((f) => { if (asList(l.feats).indexOf(f) === -1) delete l.choices[f]; });
    });
    levelsOf(C).forEach((l, i) => {
      Object.keys(l.choices).forEach((k) => { if (SF().isParam(data, k) && !SF().slotsAt(C, data, i, k)) delete l.choices[k]; });
    });
    return C;
  };

  const keyOf = (b) => [b.level, b.tab, b.code, b.msg, b.ref].join('|');

  function nextGearId(C) {
    const n = (Array.isArray(C.gear) ? C.gear : []).reduce((m, g) => {
      const x = /^g(\d+)$/.exec(String(g && g.id));
      return x ? Math.max(m, Number(x[1])) : m;
    }, 0);
    return 'g' + (n + 1);
  }

  function setChoice(lvl, id, list, count) {
    if (!list.length) delete lvl.choices[id];
    else lvl.choices[id] = count > 1 ? list : list[0];
  }

  function entryAt(C, data, i, id) {
    const here = SF().levelPlan(C, data)[i];
    return here ? here.entries.find((e) => e.choice === id || e.skillPick === id) : null;
  }

  function dropInstancePicks(C, data, lvl, slug, k) {
    const rec = SF().paramOf(data, slug);
    const width = rec ? rec.count : SF().FEAT_CHOICE[slug] ? 1 : 0;
    if (!width || !lvl.choices || lvl.choices[slug] === undefined) return;
    const list = asList(lvl.choices[slug]).slice();
    list.splice(k * width, width);
    if (!list.some(Boolean)) delete lvl.choices[slug];
    else lvl.choices[slug] = list.length > 1 ? list : list[0];
  }

  U.actions = {
    tab: (C, UI, data, a) => { UI.tab = a; },
    goto: (C, UI, data, a, b) => { UI.tab = a; if (b !== undefined && b !== null && b !== '') UI.lvl = Number(b); },
    lvl: (C, UI, data, a) => { UI.lvl = Number(a); UI.featSlot = null; },
    race: (C, UI, data, base) => {
      const races = data.races || {};
      const cur = races[C.race];
      if (cur && cur.base === base) return;
      C.race = races[base] ? base : Object.keys(races).find((k) => races[k].base === base) || '';
    },
    theme: (C, UI, data, slug) => { C.theme = slug; },
    enh: (C, UI, data, base) => {
      const enh = U.enhancedOf(data, base);
      const on = !U.enhancedOn(C, UI, data, base);
      UI.enh = Object.assign({}, UI.enh, { [base]: on });
      levelsOf(C).forEach((l) => { if (l.class === base || l.class === enh) l.class = on ? enh : base; });
    },
    addLevel: (C, UI, data, cls) => {
      if (!SF().allowed('class', cls, levelsOf(C).length, C, data).ok || levelsOf(C).length >= 20) return;
      const before = {};
      SF().validate(C, data).forEach((b) => { before[keyOf(b)] = true; });
      C.levels.push(U.newLevel(cls));
      UI.lvl = C.levels.length - 1;
      UI.featSlot = null;
      const fresh = SF().validate(C, data).filter((b) => !before[keyOf(b)]);
      const tab = TABS.map((t) => t[0]).find((k) => fresh.some((b) => b.tab === k));
      if (tab) UI.tab = tab;
    },
    removeLevel: (C, UI) => { C.levels.pop(); UI.lvl = Math.max(0, C.levels.length - 1); },
    inc: (C, UI, data, a, ability) => {
      const i = Number(a);
      const lvl = C.levels[i];
      if (!lvl || SF().increaseAt.indexOf(i + 1) === -1 || SF().ABILITIES.indexOf(ability) === -1) return;
      const list = asList(lvl.increases);
      if (list.indexOf(ability) !== -1) lvl.increases = list.filter((x) => x !== ability);
      else if (list.length < SF().INCREASE_COUNT) lvl.increases = list.concat([ability]);
    },
    pick: (C, UI, data, a, slug, id) => {
      const i = Number(a);
      const lvl = C.levels[i];
      const entry = entryAt(C, data, i, id);
      const count = (entry && entry.count) || 1;
      const list = asList(lvl.choices[id]);
      if (list.indexOf(slug) !== -1) return setChoice(lvl, id, list.filter((k) => k !== slug), count);
      if (count === 1) return setChoice(lvl, id, [slug], count);
      if (list.length < count) setChoice(lvl, id, list.concat([slug]), count);
    },
    skillPick: (C, UI, data, a, skill, id) => {
      const i = Number(a);
      const lvl = C.levels[i];
      const entry = entryAt(C, data, i, id);
      const count = (entry && entry.count) || 1;
      const list = asList(lvl.choices[id]);
      if (list.indexOf(skill) !== -1) return setChoice(lvl, id, list.filter((k) => k !== skill), count);
      if (!SF().allowed('choice', skill, i, C, data, { id }).ok) return;
      if (count === 1) return setChoice(lvl, id, [skill], count);
      if (list.length < count) setChoice(lvl, id, list.concat([skill]), count);
    },
    featSlot: (C, UI, data, a) => { UI.featSlot = Number(a); },
    takeFeat: (C, UI, data, a, slug, slot) => {
      const i = Number(a);
      const j = Number(slot);
      const feats = asList(C.levels[i].feats).slice();
      if (j > feats.length || !SF().allowed('feat', slug, i, C, data, j).ok) return;
      const old = feats[j];
      if (old && old !== slug) dropInstancePicks(C, data, C.levels[i], old, feats.slice(0, j).filter((f) => f === old).length);
      feats[j] = slug;
      C.levels[i].feats = feats;
      UI.featSlot = null;
    },
    dropFeat: (C, UI, data, a) => { const lvl = C.levels[Number(a)]; lvl.feats = asList(lvl.feats).slice(0, -1); UI.featSlot = null; },
    learn: (C, UI, data, a, slug) => {
      const lvl = C.levels[Number(a)];
      lvl.spells = lvl.spells || {};
      const list = asList(lvl.spells.learn);
      if (list.indexOf(slug) !== -1) lvl.spells.learn = list.filter((k) => k !== slug);
      else if (SF().allowed('spell', slug, Number(a), C, data).ok) lvl.spells.learn = list.concat([slug]);
      if (!asList(lvl.spells.learn).length) delete lvl.spells.learn;
    },
    swapTo: (C, UI, data, a, slug) => {
      const i = Number(a);
      const from = (UI.swapFrom || {})[i];
      if (!from || !SF().allowed('spell', slug, i, C, data, { cls: C.levels[i].class, swap: true, from }).ok) return;
      C.levels[i].spells = Object.assign({}, C.levels[i].spells, { swap: { from, to: slug } });
    },
    buy: (C, UI, data, slug) => {
      const rec = (data.items || {})[slug];
      const parent = UI.into && (C.gear || []).find((g) => g.id === UI.into);
      const attach = parent && (rec.type === 'upgrade' || rec.type === 'fusion');
      if (!SF().allowed('item', slug, Math.max(0, levelsOf(C).length - 1), C, data, attach ? { into: UI.into } : undefined).ok) return;
      if (attach && rec.type === 'upgrade') parent.slots = asList(parent.slots).concat([{ item: slug }]);
      else if (attach) parent.fusions = asList(parent.fusions).concat([{ item: slug }]);
      else C.gear.push({ id: nextGearId(C), item: slug, qty: Number(rec.perPack) > 1 ? Number(rec.perPack) : 1, equipped: false });
    },
    dropGear: (C, UI, data, a) => { C.gear.splice(Number(a), 1); },
    detach: (C, UI, data, a, field, j) => {
      const g = C.gear[Number(a)];
      g[field] = asList(g[field]).filter((x, k) => k !== Number(j));
      if (!g[field].length) delete g[field];
    }
  };

  U.selects = {
    featChoice: (C, UI, data, value, a, j) => {
      const i = Number(a);
      const lvl = C.levels[i];
      const feats = asList(lvl.feats);
      const slug = feats[Number(j)];
      const k = feats.slice(0, Number(j)).filter((f) => f === slug).length;
      const total = feats.filter((f) => f === slug).length;
      const list = asList(lvl.choices[slug]).slice();
      list[k] = value;
      const clean = list.slice(0, total).map((v) => (v === undefined ? '' : v));
      if (!clean.some(Boolean)) delete lvl.choices[slug];
      else lvl.choices[slug] = total > 1 ? clean : clean[0];
    },
    paramChoice: (C, UI, data, value, a, c) => {
      const i = Number(a);
      const at = String(c).lastIndexOf('|');
      const slug = String(c).slice(0, at);
      const index = Number(String(c).slice(at + 1));
      const lvl = C.levels[i];
      const total = SF().slotsAt(C, data, i, slug);
      const list = asList(lvl.choices[slug]).slice();
      list[index] = value;
      const clean = list.slice(0, total).map((v) => (v === undefined ? '' : v));
      if (!clean.some(Boolean)) delete lvl.choices[slug];
      else lvl.choices[slug] = total > 1 ? clean : clean[0];
    },
    swapFrom: (C, UI, data, value, a) => {
      const i = Number(a);
      UI.swapFrom = Object.assign({}, UI.swapFrom, { [i]: value || undefined });
      const spells = C.levels[i].spells || {};
      if (spells.swap) delete spells.swap;
    }
  };

  function splitPath(C, UI, p) {
    const src = p.charAt(0) === '$' ? UI : C;
    const keys = (p.charAt(0) === '$' ? p.slice(1) : p).split('.');
    let o = src;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] === undefined || o[keys[i]] === null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    return { o, k: keys[keys.length - 1] };
  }

  U.bind = function (C, UI, path, raw, opts) {
    const x = opts || {};
    const { o, k } = splitPath(C, UI, path);
    if (x.t === 'b') { o[k] = !!raw; return; }
    if (x.t === 'n') {
      let n = raw === '' || raw === null ? null : Math.floor(Number(raw));
      if (n !== null && Number.isFinite(n)) {
        if (Number.isFinite(x.max)) n = Math.min(n, x.max);
        if (Number.isFinite(x.min)) n = Math.max(n, x.min);
      }
      if (n === null || !Number.isFinite(n) || (x.z && n === 0)) { if (x.z || n === null) delete o[k]; return; }
      o[k] = n;
      return;
    }
    o[k] = raw;
  };

  const state = { C: null, UI: U.blankUI() };
  const data = root.SFDATA;

  function publish() { root.C = state.C; root.UI = state.UI; }

  U.setCharacter = function (c) {
    state.C = U.normalize(c, data);
    state.UI.lvl = 0;
    state.UI.featSlot = null;
    state.UI.swapFrom = {};
    publish();
    if (root.document) render();
  };

  function loadInitial() {
    const s = store();
    let c = null;
    try { c = s && typeof s.load === 'function' ? s.load() : null; } catch (e) { c = null; }
    return U.normalize(c && typeof c === 'object' ? c : U.blank(), data);
  }

  function render() {
    const doc = root.document;
    const active = doc.activeElement;
    const focus = active && active.dataset && active.dataset.b ? { b: active.dataset.b, s: active.selectionStart, e: active.selectionEnd } : null;
    const y = root.scrollY;
    U.normalize(state.C, data);
    const v = U.view(state.C, state.UI, data);
    doc.querySelector('.top').innerHTML = v.top;
    doc.getElementById('tabs').innerHTML = v.tabs;
    doc.getElementById('blockers').innerHTML = v.blockers;
    doc.querySelector('main').innerHTML = v.main;
    if (focus) {
      const el = doc.querySelector('[data-b="' + focus.b.replace(/"/g, '\\"') + '"]');
      if (el) {
        el.focus();
        try { if (focus.s !== null && focus.s !== undefined) el.setSelectionRange(focus.s, focus.e); } catch (e) { }
      }
    }
    root.scrollTo(0, y);
    const s = store();
    try { if (s && typeof s.save === 'function') s.save(state.C); } catch (e) { }
  }
  U.render = render;
  root.render = render;

  state.C = loadInitial();
  publish();
  if (!root.document || !root.document.querySelector) return;
  const doc = root.document;

  function applyPhone() {
    const narrow = root.matchMedia && root.matchMedia('(max-width:700px)').matches;
    doc.body.classList.toggle('phone', !!narrow);
  }

  doc.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.b || t.type === 'checkbox' || t.type === 'number' || t.tagName === 'SELECT') return;
    U.bind(state.C, state.UI, t.dataset.b, t.value);
    render();
  });
  doc.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.sel && U.selects[t.dataset.sel]) {
      U.selects[t.dataset.sel](state.C, state.UI, data, t.value, t.dataset.a, t.dataset.c);
      render();
      return;
    }
    if (!t.dataset.b || (t.type !== 'checkbox' && t.type !== 'number' && t.tagName !== 'SELECT')) return;
    const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
    U.bind(state.C, state.UI, t.dataset.b, t.type === 'checkbox' ? t.checked : t.value, { t: t.dataset.t, z: t.dataset.z === 'del', min: num(t.dataset.min), max: num(t.dataset.max) });
    render();
  });
  doc.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const fn = U.actions[t.dataset.act] || (store() && store().actions && store().actions[t.dataset.act]);
    if (!fn) return;
    if (t.tagName === 'A') e.preventDefault();
    fn(state.C, state.UI, data, t.dataset.a, t.dataset.b2, t.dataset.c, t);
    render();
  });
  root.addEventListener('resize', applyPhone);
  applyPhone();
  render();
})(this);
