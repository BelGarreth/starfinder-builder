(function(root){
  const rules = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./rules.js') : root.SF)[k] });
  const bonus = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./bonus.js') : root.SF)[k] });

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const table = (data, name) => (data && data[name]) || {};

  const ENERGY = ['acid', 'cold', 'electricity', 'fire', 'sonic'];
  const EFFECT_TYPE = { skill: 'skill', energy: 'energy-resistance' };
  const NOUN = { skill: 'skill', energy: 'energy type' };

  const recOf = (data, slug) => (has(table(data, 'feats'), slug) ? data.feats[slug] : has(table(data, 'features'), slug) ? data.features[slug] : null);
  const paramOf = (data, slug) => {
    const rec = recOf(data, slug);
    return rec && rec.param && !rec.param.derive ? rec.param : null;
  };
  const isParam = (data, slug) => !!paramOf(data, slug);

  function optionKeys(param) {
    if (Array.isArray(param.from)) return param.from;
    return param.kind === 'skill' ? Object.keys(rules.SKILLS) : ENERGY;
  }

  function optionName(kind, key) {
    if (kind === 'skill') return (rules.SKILLS[key] || {}).name || String(key);
    return String(key).charAt(0).toUpperCase() + String(key).slice(1);
  }

  const entriesOf = (char, data) => bonus.gatherRecords(char, data).filter((e) => e.rec.param && !e.rec.param.derive);
  const tabOf = (e) => (e.kind === 'feat' ? 'feats' : e.rec.kind === 'class' ? 'class' : 'char');
  const entriesAt = (char, data, levelIndex, slug) => entriesOf(char, data).filter((e) => e.levelIndex === levelIndex && (slug === undefined || e.key === slug));

  const slotsAt = (char, data, levelIndex, slug) => entriesAt(char, data, levelIndex, slug).reduce((n, e) => n + e.rec.param.count, 0);

  function picksOf(char, entry) {
    const lvl = levelsOf(char)[entry.levelIndex];
    const flat = asList(lvl && lvl.choices && lvl.choices[entry.key]);
    const count = entry.rec.param.count;
    const out = [];
    for (let s = 0; s < count; s++) out.push(flat[entry.k * count + s]);
    return out;
  }

  const filled = (v) => typeof v === 'string' && v !== '';

  function valuesFor(entry, char, data) {
    const param = entry.rec.param;
    if (param.derive === 'connectionSkills') {
      const conn = rules.pickedFor(rules.levelPlan(char, data), entry.cls, 'connection')[0];
      const rec = has(table(data, 'features'), conn) ? data.features[conn] : null;
      if (rec && asList(rec.associatedSkills).length) return rec.associatedSkills;
      const picked = rec && rec.param ? entriesOf(char, data).find((e) => e.key === conn) : null;
      return picked ? valuesFor(picked, char, data) : [];
    }
    const allowed = optionKeys(param);
    return picksOf(char, entry).filter((v) => filled(v) && allowed.indexOf(v) !== -1);
  }

  function allPicks(char, data, slug) {
    const out = [];
    entriesOf(char, data).filter((e) => e.key === slug).forEach((e) => {
      const count = e.rec.param.count;
      picksOf(char, e).forEach((value, s) => {
        if (filled(value)) out.push({ levelIndex: e.levelIndex, index: e.k * count + s, value });
      });
    });
    return out;
  }

  function problemFor(char, data, slug, levelIndex, index, value) {
    const rec = recOf(data, slug);
    const param = paramOf(data, slug);
    if (!param) return null;
    const label = rec.name;
    if (param.kind === 'skill' && !has(rules.SKILLS, value)) return { code: 'invalid-choice', why: "Skill '" + value + "' does not exist" };
    if (optionKeys(param).indexOf(value) === -1) return { code: 'invalid-choice', why: optionName(param.kind, value) + ' is not an option for ' + label };
    const others = allPicks(char, data, slug).filter((p) => !(p.levelIndex === levelIndex && p.index === index));
    if (param.within) {
      const base = allPicks(char, data, param.within).filter((p) => p.levelIndex <= levelIndex).map((p) => p.value);
      if (base.indexOf(value) === -1) return { code: 'invalid-choice', why: optionName(param.kind, value) + ' needs ' + (recOf(data, param.within) || {}).name + ' first' };
    }
    const count = param.count;
    const clash = others.some((p) => {
      const sameGroup = p.levelIndex === levelIndex && (!Number.isFinite(index) || Math.floor(p.index / count) === Math.floor(index / count));
      if (p.value !== value || !(param.distinct || sameGroup)) return false;
      return p.levelIndex < levelIndex || (p.levelIndex === levelIndex && p.index < index);
    });
    if (clash) return { code: 'duplicate', why: optionName(param.kind, value) + ' is already chosen for ' + label };
    return null;
  }

  function allowedChoice(char, data, levelIndex, slug, value, index) {
    const param = paramOf(data, slug);
    if (!param) return { ok: false, why: 'No ' + slug + ' choice at this level' };
    if (!entriesAt(char, data, levelIndex, slug).length) return { ok: false, why: 'No ' + recOf(data, slug).name + ' choice at this level' };
    const problem = problemFor(char, data, slug, levelIndex, Number.isInteger(index) ? index : Infinity, value);
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }

  function blockersAt(char, data, levelIndex) {
    const out = [];
    entriesAt(char, data, levelIndex).forEach((e) => {
      const param = e.rec.param;
      const picks = picksOf(char, e);
      const missing = picks.filter((v) => !filled(v)).length;
      const push = (code, msg) => out.push({ level: levelIndex + 1, tab: tabOf(e), code, msg, ref: e.key });
      if (missing) push('unspent', 'Choose ' + (missing === 1 ? 'a ' : missing + ' ') + NOUN[param.kind] + (missing === 1 ? '' : 's') + ' for ' + e.rec.name);
      picks.forEach((v, s) => {
        if (!filled(v)) return;
        const problem = problemFor(char, data, e.key, levelIndex, e.k * param.count + s, v);
        if (problem) push(problem.code, problem.why);
      });
    });
    return out;
  }

  const api = { EFFECT_TYPE, ENERGY, isParam, paramOf, optionKeys, optionName, entriesAt, slotsAt, picksOf, valuesFor, allowedChoice, paramBlockers: blockersAt };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
