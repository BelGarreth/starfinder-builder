(function(root){
  const rules = typeof require !== 'undefined' ? require('./rules.js') : root.SF;

  class FormulaError extends Error {
    constructor(message) { super(message); this.name = 'FormulaError'; }
  }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const bool = (b) => (b ? 1 : 0);

  const FUNCTIONS = {
    floor: (a) => Math.floor(a[0]),
    ceil: (a) => Math.ceil(a[0]),
    round: (a) => Math.round(a[0]),
    abs: (a) => Math.abs(a[0]),
    min: (a) => Math.min.apply(null, a),
    max: (a) => Math.max.apply(null, a),
    sign: (a) => Math.sign(a[0]),
    ternary: (a) => (a[0] ? a[1] : a[2]),
    gte: (a) => bool(a[0] >= a[1]),
    gt: (a) => bool(a[0] > a[1]),
    lt: (a) => bool(a[0] < a[1]),
    lte: (a) => bool(a[0] <= a[1]),
    eq: (a) => bool(a[0] === a[1]),
    lookupRange: (a) => {
      let result = a[1];
      let best = -Infinity;
      for (let i = 2; i + 1 < a.length; i += 2) {
        if (a[i] <= a[0] && a[i] > best) { best = a[i]; result = a[i + 1]; }
      }
      return result;
    }
  };

  const TOKEN = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|@([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)|([A-Za-z_][A-Za-z0-9_]*)|([-+*\/(),]))/y;

  function tokenize(expr) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    let pos = 0;
    while (pos < expr.length) {
      TOKEN.lastIndex = pos;
      const m = TOKEN.exec(expr);
      if (!m) {
        if (/^\s*$/.test(expr.slice(pos))) break;
        throw new FormulaError('Unexpected character in formula: ' + expr);
      }
      pos = TOKEN.lastIndex;
      if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
      else if (m[2] !== undefined) tokens.push({ t: 'path', v: m[2] });
      else if (m[3] !== undefined) tokens.push({ t: 'id', v: m[3] });
      else tokens.push({ t: 'op', v: m[4] });
    }
    return tokens;
  }

  function resolvePath(path, ctx) {
    let cur = ctx;
    const parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !has(cur, parts[i])) return 0;
      cur = cur[parts[i]];
    }
    if (typeof cur === 'number') return Number.isFinite(cur) ? cur : 0;
    if (typeof cur === 'boolean') return bool(cur);
    return 0;
  }

  function evalFormula(expr, ctx) {
    if (typeof expr === 'number') return expr;
    if (typeof expr !== 'string') throw new FormulaError('Formula must be a string');
    const tokens = tokenize(expr);
    const scope = ctx || {};
    let i = 0;
    const peek = () => tokens[i];
    const isOp = (v) => tokens[i] && tokens[i].t === 'op' && tokens[i].v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new FormulaError('Expected "' + v + '" in formula: ' + expr);
      i++;
    };

    function additive() {
      let left = multiplicative();
      while (isOp('+') || isOp('-')) {
        const op = tokens[i++].v;
        const right = multiplicative();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function multiplicative() {
      let left = unary();
      while (isOp('*') || isOp('/')) {
        const op = tokens[i++].v;
        const right = unary();
        if (op === '/' && right === 0) throw new FormulaError('Division by zero in formula: ' + expr);
        left = op === '*' ? left * right : left / right;
      }
      return left;
    }

    function unary() {
      if (isOp('-')) { i++; return -unary(); }
      if (isOp('+')) { i++; return unary(); }
      return primary();
    }

    function primary() {
      const tok = peek();
      if (!tok) throw new FormulaError('Unexpected end of formula: ' + expr);
      i++;
      if (tok.t === 'num') return tok.v;
      if (tok.t === 'path') return resolvePath(tok.v, scope);
      if (tok.t === 'id') {
        if (!has(FUNCTIONS, tok.v)) throw new FormulaError('Unknown function "' + tok.v + '" in formula: ' + expr);
        expect('(');
        const args = [];
        if (!isOp(')')) {
          args.push(additive());
          while (isOp(',')) { i++; args.push(additive()); }
        }
        expect(')');
        return FUNCTIONS[tok.v](args);
      }
      if (tok.v === '(') {
        const v = additive();
        expect(')');
        return v;
      }
      throw new FormulaError('Unexpected "' + tok.v + '" in formula: ' + expr);
    }

    const value = additive();
    if (i < tokens.length) throw new FormulaError('Unexpected trailing input in formula: ' + expr);
    return value;
  }

  function skillRanks(char) {
    const ranks = {};
    (Array.isArray(char && char.levels) ? char.levels : []).forEach((l) => {
      Object.keys((l && l.skills) || {}).forEach((k) => {
        const n = Number(l.skills[k]);
        if (Number.isFinite(n)) ranks[k] = (ranks[k] || 0) + n;
      });
    });
    return ranks;
  }

  function formulaCtx(char, data, derived) {
    const d = derived || {};
    const scores = rules.baseScores(char || {}, data);
    const abilities = {};
    rules.ABILITIES.forEach((a) => { abilities[a] = { value: scores[a], mod: rules.mod(scores[a]) }; });
    const classes = {};
    const levels = rules.classLevels(char || {});
    Object.keys(levels).forEach((slug) => { classes[slug] = { levels: levels[slug], level: levels[slug] }; });
    const skills = {};
    const ranks = skillRanks(char);
    Object.keys(ranks).forEach((k) => { skills[k] = { ranks: ranks[k] }; });
    const speedLand = d.speedLand === undefined ? 30 : d.speedLand;
    const speedBase = d.speedBase === undefined ? 30 : d.speedBase;
    return {
      details: { level: { value: rules.charLevel(char || {}) } },
      classes,
      abilities,
      attributes: {
        baseAttackBonus: { value: rules.bab(char || {}, data) },
        speed: { land: { value: speedLand, base: speedBase } }
      },
      skills,
      resources: {}
    };
  }

  const api = { FormulaError, evalFormula, formulaCtx };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
