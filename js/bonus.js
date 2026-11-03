(function(root){
  const rules = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./rules.js') : root.SF)[k] });
  const formula = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./formula.js') : root.SF)[k] });
  const params = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./params.js') : root.SF)[k] });
  const gearLib = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./gear.js') : root.SF)[k] });

  const UNTYPED = 'untyped';
  const CIRCUMSTANCE = 'circumstance';
  const THEME_FEATURE_DEFAULT_LEVEL = 1;
  const SAVE_KEY = { fort: 'fort', reflex: 'ref', ref: 'ref', will: 'will' };

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const table = (data, name) => (data && data[name]) || {};

  function stack(bonuses) {
    let total = 0;
    const bestByType = {};
    const circumstanceBySource = {};
    let anonymous = 0;
    bonuses.forEach((b) => {
      const v = Number(b.value);
      if (!Number.isFinite(v) || v === 0) return;
      if (v < 0) { total += v; return; }
      const type = String(b.type || UNTYPED).toLowerCase();
      if (type === UNTYPED) { total += v; return; }
      if (type === CIRCUMSTANCE) {
        const src = b.source === undefined || b.source === null ? '#' + (anonymous++) : String(b.source);
        circumstanceBySource[src] = Math.max(circumstanceBySource[src] || 0, v);
        return;
      }
      bestByType[type] = Math.max(bestByType[type] || 0, v);
    });
    Object.keys(circumstanceBySource).forEach((s) => { total += circumstanceBySource[s]; });
    Object.keys(bestByType).forEach((t) => { total += bestByType[t]; });
    return total;
  }

  function target(mod, strict) {
    const va = mod.valueAffected === undefined || mod.valueAffected === null ? '' : String(mod.valueAffected);
    const fail = () => {
      if (strict) throw new Error('Unknown effectType ' + mod.effectType + (va ? '/' + va : ''));
      return [];
    };
    switch (mod.effectType) {
      case 'ac':
        return va === 'eac' ? ['eac'] : va === 'kac' ? ['kac'] : ['eac', 'kac'];
      case 'save':
        if (va === 'lowest') return ['save.lowest'];
        return has(SAVE_KEY, va) ? [SAVE_KEY[va]] : ['fort', 'ref', 'will'];
      case 'saves':
        return ['fort', 'ref', 'will'];
      case 'initiative': return ['initiative'];
      case 'stamina-points': return ['sp'];
      case 'hit-points': return ['hp'];
      case 'resolve-points': return ['rp'];
      case 'base-attack-bonus': return ['bab'];
      case 'specific-speed': return ['speed.' + (va || 'land')];
      case 'all-speeds': return ['speed.all'];
      case 'skill': return va ? ['skill.' + va] : ['skills.all'];
      case 'all-skills': return ['skills.all'];
      case 'ability-skills': return va ? ['ability-skills.' + va] : fail();
      case 'skill-ranks': return va ? ['ranks.' + va] : ['ranks.all'];
      case 'skill-points': return ['skill-points'];
      case 'all-attacks': return ['attack.all'];
      case 'melee-attacks': return ['attack.melee'];
      case 'ranged-attacks': return ['attack.ranged'];
      case 'weapon-attacks': return ['attack.weapon'];
      case 'all-damage': return ['damage.all'];
      case 'melee-damage': return ['damage.melee'];
      case 'ranged-damage': return ['damage.ranged'];
      case 'weapon-damage': return ['damage.weapon'];
      case 'weapon-property-damage': return ['damage.property' + (va ? '.' + va : '')];
      case 'weapon-ammo-usage-multiplier': return ['ammo-multiplier'];
      case 'cmd': return ['cmd'];
      case 'ability-score': return va ? ['ability.' + va] : fail();
      case 'ability-check': return va ? ['check.' + va] : fail();
      case 'spell-save-dc': return ['spell-dc'];
      case 'energy-resistance': return ['resist' + (va ? '.' + va : '')];
      case 'damage-reduction': return ['dr'];
      case 'bulk': return ['bulk'];
      case 'acp': return ['acp'];
      default: return fail();
    }
  }

  const WHEN = {
    armor: (s) => s.armorType !== null && s.armorType !== undefined,
    lightOrNoArmor: (s) => (s.armorType === null || s.armorType === undefined || s.armorType === 'light') && !s.encumbered
  };

  function whenHolds(when, state) {
    if (when === undefined || when === null || when === '') return true;
    if (!has(WHEN, when)) throw new Error('Unknown modifier condition ' + when);
    return WHEN[when](state || {});
  }

  function armorTypeOf(char, data) {
    const items = table(data, 'items');
    const gear = Array.isArray(char && char.gear) ? char.gear : [];
    for (let i = 0; i < gear.length; i++) {
      const g = gear[i];
      const rec = g && g.equipped && has(items, g.item) ? items[g.item] : null;
      if (rec && rec.armor) return rec.armor.type || null;
    }
    return null;
  }

  function overrideKeys(key, kind, data) {
    if (kind === 'feature') return ['feature:' + key].concat(has(table(data, 'feats'), key) ? [] : [key]);
    return [key];
  }

  function gatherRecords(char, data) {
    const out = [];
    const seen = {};
    const feats = table(data, 'feats');
    const features = table(data, 'features');
    const add = (kind, key, rec, levelIndex, k, cls, gear) => {
      const id = kind + ':' + key;
      if (!rec) return;
      const repeats = !!(rec.param && rec.param.perInstance) || !!gear;
      if (seen[id] && !repeats) return;
      seen[id] = true;
      const entry = { kind, key, rec, levelIndex, k: k || 0, cls };
      if (gear) entry.gear = gear;
      out.push(entry);
    };
    const total = rules.charLevel(char || {});

    const raceKey = char && char.race;
    const races = table(data, 'races');
    if (raceKey && has(races, raceKey)) {
      add('race', raceKey, races[raceKey], 0);
      asList(races[raceKey].coreTraits).forEach((k) => { if (has(features, k)) add('feature', k, features[k], 0); });
    }

    const themeKey = char && char.theme;
    const themes = table(data, 'themes');
    if (themeKey && has(themes, themeKey)) {
      add('theme', themeKey, themes[themeKey], 0);
      asList(themes[themeKey].features).forEach((k) => {
        const f = has(features, k) ? features[k] : null;
        const gate = f && typeof f.level === 'number' ? f.level : THEME_FEATURE_DEFAULT_LEVEL;
        if (gate <= total) add('feature', k, f, Math.max(gate - 1, 0));
      });
    }

    const granted = rules.grantedFeats(char || {}, data);
    levelsOf(char).forEach((lvl, i) => {
      const held = {};
      granted.filter((g) => g.levelIndex === i).map((g) => g.slug).concat(asList(lvl && lvl.feats)).forEach((k) => {
        if (!has(feats, k)) return;
        held[k] = (held[k] || 0) + 1;
        add('feat', k, feats[k], i, held[k] - 1);
      });
    });
    const grants = {};
    rules.classFeatures(char || {}, data).forEach((f) => {
      const id = f.levelIndex + '|' + f.slug;
      grants[id] = (grants[id] || 0) + 1;
      if (has(features, f.slug)) add('feature', f.slug, features[f.slug], f.levelIndex, grants[id] - 1, f.cls);
    });

    const items = table(data, 'items');
    const gear = Array.isArray(char && char.gear) ? char.gear : [];
    gear.forEach((g) => {
      if (!g || !g.equipped) return;
      const addItem = (k) => { if (typeof k === 'string' && has(items, k)) add('item', k, items[k]); };
      if (typeof g.item === 'string' && has(items, g.item) && gearLib.isPersonal(items[g.item])) add('item', g.item, items[g.item], undefined, 0, undefined, g);
      else addItem(g.item);
      asList(g.slots).forEach((s) => addItem(s && s.item));
      asList(g.fusions).forEach((f) => addItem(f && typeof f === 'object' ? f.item : f));
    });
    return out;
  }

  function modifiersOf(entry, data) {
    const effects = (data && data.overrides && data.overrides.effects) || {};
    const own = asList(entry.rec.modifiers);
    if (entry.kind === 'item') return entry.gear ? gearLib.personalModifiers(entry.rec, entry.gear) : own;
    const key = overrideKeys(entry.key, entry.kind, data).find((k) => has(effects, k));
    const extra = key && Array.isArray(effects[key]) ? effects[key] : [];
    return own.concat(extra);
  }

  function chosenModifiers(entry, mods, char, data) {
    const param = entry.rec.param;
    if (!param) return mods;
    const effectType = params.EFFECT_TYPE[param.kind];
    const matching = mods.filter((m) => m.effectType === effectType);
    if (!matching.length) return mods;
    const values = params.valuesFor(entry, char, data);
    const chosen = values.map((v, j) => Object.assign({}, matching[j] || matching[0], { valueAffected: v }, param.bonusType ? { type: param.bonusType } : {}));
    return mods.filter((m) => m.effectType !== effectType).concat(chosen);
  }

  function collectModifiers(char, data, opts) {
    const o = opts || {};
    const state = Object.assign({ armorType: armorTypeOf(char, data), encumbered: false }, o.state);
    const constants = [];
    const situational = [];
    const inactive = [];
    gatherRecords(char, data).forEach((entry) => {
      chosenModifiers(entry, modifiersOf(entry, data), char, data).forEach((m) => {
        const tagged = Object.assign({}, m, { source: entry.rec.name || entry.key, sourceKey: entry.key, kind: entry.kind });
        if (m.modifierType !== 'constant') situational.push(tagged);
        else if (whenHolds(m.when, state)) constants.push(tagged);
        else inactive.push(tagged);
      });
    });
    return { constants, situational, inactive };
  }

  function resolve(char, data, opts) {
    const o = opts || {};
    const collected = collectModifiers(char, data, o);
    const ctx = formula.formulaCtx(char, data, o.derived);
    const constants = [];
    collected.constants.forEach((m) => {
      const targets = target(m, !!o.strict);
      if (!targets.length) return;
      let value;
      try {
        value = formula.evalFormula(m.modifier, ctx);
      } catch (e) {
        if (o.strict || !(e instanceof formula.FormulaError)) throw e;
        return;
      }
      constants.push(Object.assign({}, m, { value, targets }));
    });
    return { constants, situational: collected.situational, inactive: collected.inactive };
  }

  function totalFor(char, data, key, opts) {
    const bonuses = resolve(char, data, opts).constants
      .filter((m) => m.targets.indexOf(key) !== -1)
      .map((m) => ({ type: m.type, value: m.value, source: m.kind + ':' + m.sourceKey }));
    return stack(bonuses);
  }

  const api = { stack, target, whenHolds, armorTypeOf, overrideKeys, collectModifiers, gatherRecords, resolve, totalFor };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
