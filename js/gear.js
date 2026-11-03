(function(root){
  const rules = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./rules.js') : root.SF)[k] });
  const bonus = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./bonus.js') : root.SF)[k] });
  const formula = new Proxy({}, { get: (_, k) => (typeof module !== 'undefined' ? require('./formula.js') : root.SF)[k] });

  const WEALTH = {
    1: 1000, 2: 2000, 3: 4000, 4: 6000, 5: 9000, 6: 15000, 7: 23000, 8: 33000, 9: 45000, 10: 66000,
    11: 100000, 12: 150000, 13: 225000, 14: 333000, 15: 500000, 16: 750000, 17: 1125000, 18: 1700000, 19: 2550000, 20: 3775000
  };
  // AoN Rules.aspx?ID=230 (Gaining Wealth) sets no hard cap; item level at most character level follows its APL guideline
  const ITEM_LEVEL_CAP = (lvl) => lvl;

  const WEAPON_PROFICIENCY = {
    basicM: 'bmelee', advancedM: 'amelee', smallA: 'sarms', longA: 'larms', heavy: 'hweap', sniper: 'snipe', grenade: 'gren', special: 'spec', solarian: 'solarian'
  };
  // CRB pp. 191-192 fusion price by weapon item level; AoN Rules ID=86 gives the formulas but not the table
  const FUSION_PRICE = {};
  const SEAL_MARKUP = 1.1;
  const CONSUMABLE_DISCOUNT = 0.5;
  const ARMOR_PROFICIENCY = { light: 'lgt', heavy: 'hvy', power: 'pwr' };
  const FEAT_PROFICIENCY = {
    'basic_melee_weapon_proficiency_(combat)': { weapon: ['bmelee'] },
    'advanced_melee_weapon_proficiency_(combat)': { weapon: ['amelee'] },
    'small_arm_proficiency_(combat)': { weapon: ['sarms'] },
    'longarm_proficiency_(combat)': { weapon: ['larms'] },
    'heavy_weapon_proficiency_(combat)': { weapon: ['hweap'] },
    'sniper_weapon_proficiency_(combat)': { weapon: ['snipe'] },
    'grenade_proficiency_(combat)': { weapon: ['gren'] },
    'light_armor_proficiency_(combat)': { armor: ['lgt'] },
    'heavy_armor_proficiency_(combat)': { armor: ['hvy'] },
    'powered_armored_proficiency_(combat)': { armor: ['pwr'] },
    'shield_proficiency_(combat)': { armor: ['shl'] }
  };
  const FEATURE_PROFICIENCY = { 'combat_tracking_(ex)': { weapon: ['larms'], armor: ['hvy'] } };
  const TYPE_NAME = {
    basicM: 'basic melee weapons', advancedM: 'advanced melee weapons', smallA: 'small arms', longA: 'longarms', heavy: 'heavy weapons',
    sniper: 'sniper weapons', grenade: 'grenades', solarian: 'solarian weapons'
  };
  const SPECIAL_PROFICIENCY_FEAT = 'special_weapon_proficiency_(combat)';
  const FEAT_CHOICE = {
    'weapon_focus_(combat)': { kind: 'type', label: 'Weapon Focus' },
    'weapon_specialization_(combat)': { kind: 'type', label: 'Weapon Specialization' },
    'special_weapon_proficiency_(combat)': { kind: 'special', label: 'Special Weapon Proficiency' }
  };
  const COMBAT_TRACKING = 'combat_tracking_(ex)';
  const COMBAT_TRACKING_SPEC_LEVEL = 3;
  const CHOSEN_TYPE_FEATS = ['weapon_focus_(combat)', 'weapon_specialization_(combat)'];
  const SPEC_FEAT = 'weapon_specialization_(combat)';
  const SPEC_FEAT_MIN_LEVEL = 3;
  const SPEC_TYPE = 'weapon-specialization';
  const NONPROFICIENT_PENALTY = -4;
  const MELEE_TYPES = ['basicM', 'advancedM', 'solarian'];
  const BULK_LIGHT = 0.1;
  const UNARMED = { name: 'Unarmed strike', dice: '1d3', type: 'basicM' };
  const SYSTEM_PARTS = {
    none: [], eye: ['eyes'], eyes: ['eyes'], brainAndEyes: ['brain', 'eyes'], brainHeartLungs: ['brain', 'heart', 'lungs'],
    allHands: ['hand'], hand: ['hand'], armAndHand: ['arm', 'hand'], allArms: ['arm'], arm: ['arm'],
    allLegs: ['legs'], allFeet: ['feet'], allLegsAndFeet: ['legs', 'feet'], lungsAndThroat: ['lungs', 'throat'], skinAndThroat: ['skin', 'throat']
  };

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const table = (data, name) => (data && data[name]) || {};
  const own = (o, k) => (has(o, k) ? o[k] : undefined);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
  const gearOf = (char) => (Array.isArray(char && char.gear) ? char.gear.filter((g) => g && typeof g === 'object') : []);
  const levelsOf = (char) => (char && Array.isArray(char.levels) ? char.levels : []);
  const itemOf = (data, slug) => (has(table(data, 'items'), slug) ? table(data, 'items')[slug] : null);
  const validQty = (g) => g.qty === undefined || (Number.isInteger(g.qty) && g.qty >= 1);
  const qtyOf = (g) => (g.qty === undefined ? 1 : validQty(g) ? g.qty : 0);
  const packsOf = (rec, g) => Math.ceil(qtyOf(g) / (Number(rec.perPack) > 1 ? Number(rec.perPack) : 1));
  const fusionSlug = (f) => (f && typeof f === 'object' ? f.item : f);
  const fusionLevelOf = (data, f) => {
    const rec = itemOf(data, fusionSlug(f));
    const own = rec ? Number(rec.fusionLevel) || Number(rec.level) || 0 : 0;
    return f && typeof f === 'object' && Number.isFinite(f.level) ? f.level : own;
  };
  const fusionBase = (level) => (has(FUSION_PRICE, level) && Number.isFinite(FUSION_PRICE[level]) ? FUSION_PRICE[level] : null);
  const isConsumableWeapon = (rec) => !!rec && (rec.type === 'ammunition' || (!!rec.weapon && rec.weapon.type === 'grenade'));
  const isSeal = (f) => !!f && typeof f === 'object' && f.seal === true;
  function fusionPrice(data, parent, f) {
    if (isSeal(f)) {
      const base = fusionBase(fusionLevelOf(data, f));
      return base === null ? null : Math.round(base * SEAL_MARKUP);
    }
    const base = fusionBase(Number(parent && parent.level) || 0);
    if (base === null) return null;
    return isConsumableWeapon(parent) ? Math.round(base * CONSUMABLE_DISCOUNT) : base;
  }
  const fusionCounted = (data, f) => (isSeal(f) ? fusionLevelOf(data, f) : Number((itemOf(data, fusionSlug(f)) || {}).fusionLevel) || Number((itemOf(data, fusionSlug(f)) || {}).level) || 0);
  const level = (char) => Math.max(1, rules.charLevel(char));
  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const PERSONAL_LIMIT = 3;
  const PERSONAL_TYPE = 'personal-upgrade';
  const isPersonal = (rec) => !!rec && rec.type === 'augmentation' && rec.augType === 'personal';
  const personalAmount = (rec) => (asList(rec.modifiers).filter((m) => m && m.effectType === 'ability-score').map((m) => Number(m.modifier)).find((n) => Number.isFinite(n)) || 0);

  function personalModifiers(rec, g) {
    const own = asList(rec.modifiers);
    if (!isPersonal(rec)) return own;
    const ability = g && ABILITY_KEYS.indexOf(g.ability) !== -1 ? g.ability : null;
    return own.filter((m) => m.effectType !== 'ability-score' || ability)
      .map((m) => (m.effectType === 'ability-score' ? Object.assign({}, m, { valueAffected: ability, type: PERSONAL_TYPE }) : m));
  }

  function personalUpgrades(char, data, upToLevels) {
    const cap = upToLevels === undefined ? Infinity : upToLevels;
    return gearOf(char).map((g, index) => ({ g, index, rec: itemOf(data, g.item) }))
      .filter((x) => x.g.equipped && isPersonal(x.rec) && !(Number(x.rec.level) > cap))
      .map((x) => ({ index: x.index, id: x.g.id, item: x.g.item, rec: x.rec, ability: ABILITY_KEYS.indexOf(x.g.ability) !== -1 ? x.g.ability : null, amount: personalAmount(x.rec) }));
  }

  function upgradeBonuses(char, data, upToLevels) {
    const out = {};
    personalUpgrades(char, data, upToLevels).forEach((u) => {
      if (u.ability) out[u.ability] = Math.max(out[u.ability] || 0, u.amount);
    });
    return out;
  }

  function personalProblem(char, data, gearIndex, ability) {
    const g = gearOf(char)[gearIndex];
    const rec = g ? itemOf(data, g.item) : null;
    if (!isPersonal(rec)) return { code: 'invalid-choice', why: 'Only a personal upgrade raises an ability score' };
    if (ability === undefined || ability === null || ability === '') return { code: 'unspent', why: 'Choose the ability ' + rec.name + ' raises' };
    if (ABILITY_KEYS.indexOf(ability) === -1) return { code: 'invalid-choice', why: "Ability '" + ability + "' does not exist" };
    const others = personalUpgrades(char, data).filter((u) => u.index !== gearIndex);
    if (others.some((u) => u.ability === ability)) return { code: 'duplicate', why: 'Each personal upgrade must raise a different ability, and ' + ability.toUpperCase() + ' already has one' };
    return null;
  }

  function personalAllowed(char, data, ability, opts) {
    const gear = gearOf(char);
    const o = opts || {};
    const at = Number.isInteger(o.index) ? (o.index < gear.length ? o.index : -1) : o.gear !== undefined ? gear.findIndex((g) => g.id === o.gear) : -1;
    if (at === -1) return { ok: false, why: 'No such item' };
    const problem = personalProblem(char, data, at, ability);
    return problem ? { ok: false, why: problem.why } : { ok: true };
  }
  const fmt = (n) => n.toLocaleString('en-US');

  function budget(char, data) {
    const lvl = Math.min(20, level(char));
    const credits = WEALTH[lvl];
    let spent = 0;
    gearOf(char).forEach((g) => {
      const main = itemOf(data, g.item);
      if (main) spent += (Number(main.price) || 0) * packsOf(main, g);
      asList(g.slots).forEach((s) => { const r = itemOf(data, s && s.item); if (r) spent += Number(r.price) || 0; });
      asList(g.fusions).forEach((f) => { if (itemOf(data, fusionSlug(f))) spent += fusionPrice(data, main, f) || 0; });
    });
    return { credits, spent, left: credits - spent };
  }

  function bulkOf(raw) {
    if (raw === 'L' || raw === 'l') return BULK_LIGHT;
    const n = Number(raw);
    return raw === '-' || raw === '' || !Number.isFinite(n) ? 0 : n;
  }

  function bulkState(char, data, strScore) {
    let carried = 0;
    gearOf(char).forEach((g) => {
      const rec = g.carried === false ? null : itemOf(data, g.item);
      if (rec) carried += bulkOf(rec.bulk) * packsOf(rec, g);
    });
    carried = Math.round(carried * 10) / 10;
    const state = carried > strScore ? 'overburdened' : carried > strScore / 2 ? 'encumbered' : 'ok';
    return { carried, limit: strScore, state };
  }

  function systemsOf(rec, g) {
    const key = rec.augSystem || (g && g.system) || 'none';
    return has(SYSTEM_PARTS, key) ? SYSTEM_PARTS[key] : [key];
  }

  function blockersFor(char, data, ctx) {
    const out = [];
    const lvl = level(char);
    const at = ctx && ctx.level !== undefined ? ctx.level : null;
    const push = (code, msg, ref) => {
      const b = { level: at, tab: 'gear', code, msg };
      if (ref !== undefined) b.ref = ref;
      out.push(b);
    };
    const b = budget(char, data);
    if (b.left < 0) push('over-budget', 'Gear costs ' + fmt(b.spent) + ' of ' + fmt(b.credits) + ' credits');

    const cap = ITEM_LEVEL_CAP(lvl);
    const seenLevel = {};
    const checkLevel = (slug) => {
      const rec = itemOf(data, slug);
      if (!rec || seenLevel[slug] || !(Number(rec.level) > cap)) return;
      seenLevel[slug] = true;
      push('item-level', rec.name + ' is item level ' + rec.level + ', above the level ' + cap + ' limit', slug);
    };

    const systems = {};
    const equippedArmor = [];
    gearOf(char).forEach((g) => {
      const rec = itemOf(data, g.item);
      if (!rec) return;
      checkLevel(g.item);
      if (g.equipped && rec.armor) equippedArmor.push(rec.name);
      if (!validQty(g)) push('qty', rec.name + ' quantity must be a whole number of 1 or more', g.item);
      const slotted = asList(g.slots).map((x) => x && x.item).filter((x) => itemOf(data, x));
      slotted.forEach(checkLevel);
      slotted.forEach((x) => {
        if (!rec.armor || itemOf(data, x).type !== 'upgrade') push('attachment-kind', itemOf(data, x).name + ' is an armor upgrade and only fits armor', g.id + ':' + x);
      });
      if (rec.armor) {
        const used = slotted.filter((x) => itemOf(data, x).type === 'upgrade').reduce((n, x) => n + (Number(itemOf(data, x).slotCost) || 1), 0);
        if (used > (Number(rec.slots) || 0)) push('upgrade-slots', rec.name + ' has ' + (Number(rec.slots) || 0) + ' upgrade slots, ' + used + ' used', g.item);
      }
      const fusions = asList(g.fusions).filter((f) => itemOf(data, fusionSlug(f)));
      fusions.forEach((f) => {
        const frec = itemOf(data, fusionSlug(f));
        checkLevel(fusionSlug(f));
        if (!rec.weapon || frec.type !== 'fusion') push('attachment-kind', frec.name + ' is a weapon fusion and only fits weapons', g.id + ':' + fusionSlug(f));
        else if (fusionPrice(data, rec, f) === null) push('price-unknown', 'Fusion pricing not available yet for ' + frec.name, g.id + ':' + fusionSlug(f));
        else if (isSeal(f) && fusionLevelOf(data, f) < (Number(frec.fusionLevel) || 0)) push('fusion-seal-level', frec.name + ' seal is level ' + fusionLevelOf(data, f) + ', below the fusion level ' + frec.fusionLevel, g.id + ':' + fusionSlug(f));
      });
      const fusionTotal = fusions.reduce((n, f) => n + fusionCounted(data, f), 0);
      if (rec.weapon && fusions.length && fusionTotal > (Number(rec.level) || 0)) push('fusion-level', rec.name + ' (level ' + rec.level + ') holds fusions totalling level ' + fusionTotal, g.item);
      if (rec.type === 'augmentation' && g.equipped !== false) {
        systemsOf(rec, g).forEach((part) => {
          (systems[part] = systems[part] || []).push(rec.name);
        });
      }
    });
    const upgrades = personalUpgrades(char, data);
    upgrades.forEach((u) => {
      const problem = personalProblem(char, data, u.index, u.ability === null ? gearOf(char)[u.index].ability : u.ability);
      if (problem && (problem.code !== 'duplicate' || upgrades.findIndex((x) => x.ability === u.ability) !== upgrades.indexOf(u))) push(problem.code, problem.why, u.id === undefined ? u.item : u.id);
    });
    if (upgrades.length > PERSONAL_LIMIT) push('personal-limit', 'You can have only ' + PERSONAL_LIMIT + ' personal upgrades, ' + upgrades.length + ' are equipped');
    const models = {};
    upgrades.forEach((u) => { (models[u.amount] = models[u.amount] || []).push(u.rec.name); });
    Object.keys(models).forEach((n) => { if (models[n].length > 1) push('personal-model', 'Each personal upgrade must be a different model: ' + models[n].join(', ')); });
    Object.keys(systems).forEach((part) => {
      if (systems[part].length > 1) push('augmentation-system', 'Two augmentations share the ' + part + ' system: ' + systems[part].join(', '), part);
    });
    if (equippedArmor.length > 1) push('armor-count', 'Only one armor can be worn: ' + equippedArmor.join(', '));
    return out;
  }

  function itemAllowed(char, data, slug, opts) {
    const rec = itemOf(data, slug);
    if (!rec) return { ok: false, why: "Item '" + slug + "' no longer exists" };
    const o = opts || {};
    const cap = ITEM_LEVEL_CAP(level(char));
    if (Number(rec.level) > cap) return { ok: false, why: 'Item level ' + rec.level + ' is above the level ' + cap + ' limit' };
    const b = budget(char, data);
    const sealed = o.into === undefined || o.seal === true;
    const entry = { item: slug, level: Number.isFinite(o.level) ? o.level : fusionLevelOf(data, slug), seal: sealed };
    const intoParent = o.into !== undefined ? gearOf(char).find((g) => g.id === o.into) : null;
    const parentRec = intoParent ? itemOf(data, intoParent.item) : null;
    let price;
    if (rec.type === 'fusion') {
      const priced = fusionPrice(data, parentRec, entry);
      if (priced === null) return { ok: false, why: 'Fusion pricing not available yet' };
      price = priced;
    } else {
      price = (Number(rec.price) || 0) * packsOf(rec, { qty: Number.isInteger(o.qty) && o.qty >= 1 ? o.qty : 1 });
    }
    if (price > b.left) return { ok: false, why: 'Costs ' + fmt(price) + ' credits, ' + fmt(Math.max(0, b.left)) + ' left' };
    const copy = JSON.parse(JSON.stringify(Object.assign({}, char, { gear: gearOf(char) })));
    if (o.into !== undefined) {
      const parent = copy.gear.find((g) => g.id === o.into);
      if (!parent) return { ok: false, why: 'No such item to attach to' };
      if (rec.type === 'fusion') parent.fusions = asList(parent.fusions).concat([entry]);
      else parent.slots = asList(parent.slots).concat([{ item: slug }]);
    } else if (rec.type === 'augmentation') {
      copy.gear.push({ id: '#candidate', item: slug, qty: 1, equipped: true });
    } else {
      return { ok: true };
    }
    const held = {};
    blockersFor(char, data, {}).forEach((x) => { const k = x.code + '|' + x.ref; held[k] = (held[k] || 0) + 1; });
    const added = blockersFor(copy, data, {}).filter((x) => {
      const k = x.code + '|' + x.ref;
      if (x.code === 'over-budget' || (x.code === 'unspent' && x.ref === '#candidate')) return false;
      if (held[k] > 0) { held[k]--; return false; }
      return true;
    });
    return added.length ? { ok: false, why: added[0].msg } : { ok: true };
  }

  function proficiency(char, data) {
    const weapon = {};
    const armor = {};
    const features = table(data, 'features');
    const grant = (g) => {
      asList(g && g.weapon).forEach((k) => { weapon[k] = true; });
      asList(g && g.armor).forEach((k) => { armor[k] = true; });
    };
    const classes = table(data, 'classes');
    Object.keys(rules.classLevels(char)).forEach((slug) => {
      const prof = has(classes, slug) ? classes[slug].prof : null;
      Object.keys((prof && prof.weapon) || {}).forEach((k) => { if (prof.weapon[k]) weapon[k] = true; });
      Object.keys((prof && prof.armor) || {}).forEach((k) => { if (prof.armor[k]) armor[k] = true; });
      if (/^solarian/.test(slug)) weapon.solarian = true;
    });
    levelsOf(char).forEach((l) => asList(l && l.feats).forEach((f) => { if (has(FEAT_PROFICIENCY, f)) grant(FEAT_PROFICIENCY[f]); }));
    rules.classFeatures(char, data).forEach((f) => { if (has(FEATURE_PROFICIENCY, f.slug) && has(features, f.slug)) grant(FEATURE_PROFICIENCY[f.slug]); });
    const specialItems = [];
    levelsOf(char).forEach((l) => {
      if (l && asList(l.feats).indexOf(SPECIAL_PROFICIENCY_FEAT) !== -1) asList(l.choices && l.choices[SPECIAL_PROFICIENCY_FEAT]).forEach((k) => specialItems.push(k));
    });
    return { weapon, armor, specialItems };
  }

  function weaponTypeChoices(char, data, levelIndex) {
    const prof = proficiency(rules.charAt(char, levelIndex + 1), data);
    return Object.keys(TYPE_NAME).filter((t) => !!prof.weapon[WEAPON_PROFICIENCY[t]]);
  }

  function featChoiceProblem(char, data, levelIndex, slug, value) {
    const def = has(FEAT_CHOICE, slug) ? FEAT_CHOICE[slug] : null;
    if (!def) return null;
    if (def.kind === 'special') {
      const rec = itemOf(data, value);
      return rec && rec.weapon && rec.weapon.type === 'special' ? null : 'Choose a special weapon for ' + def.label;
    }
    if (!has(TYPE_NAME, value)) return 'Choose a weapon type for ' + def.label;
    return weaponTypeChoices(char, data, levelIndex).indexOf(value) === -1 ? 'Not proficient in ' + TYPE_NAME[value] + ' for ' + def.label : null;
  }

  function chosenTypes(char, slug) {
    const out = [];
    levelsOf(char).forEach((l) => {
      if (!l || asList(l.feats).indexOf(slug) === -1) return;
      asList(l.choices && l.choices[slug]).forEach((t) => { if (out.indexOf(t) === -1) out.push(t); });
    });
    return out;
  }

  const DICE = /([+-]?)\s*(\d*d\d+)/g;

  function damageText(parts, ctx) {
    const dice = [];
    let flat = 0;
    asList(parts).forEach((p) => {
      const text = String((p && p.formula) === undefined ? '' : p.formula);
      let rest = text.replace(DICE, (_, sign, d) => { dice.push((sign === '-' ? '-' : '') + d); return ' '; });
      rest = rest.replace(/[+\-*/\s]+$/, '').replace(/^[\s+]+/, '');
      if (rest.replace(/\s/g, '') === '') return;
      try { flat += formula.evalFormula(rest, ctx); } catch (e) { if (!(e instanceof formula.FormulaError)) throw e; }
    });
    return { dice, flat };
  }

  function joinDamage(dice, flat) {
    let s = dice.join('+').replace(/\+-/g, '-');
    if (flat) s += (s ? (flat > 0 ? '+' : '') : '') + flat;
    return s || '0';
  }

  const isOperative = (rec) => asList(rec.weapon && rec.weapon.properties).indexOf('operative') !== -1;
  const halfSpec = (type, operative) => type === 'smallA' || operative;
  const knownTypes = Object.keys(WEAPON_PROFICIENCY);

  function attackLines(char, data, sheet) {
    const s = sheet || rules.derive(char, data);
    const lvl = rules.charLevel(char);
    const prof = proficiency(char, data);
    const armorRec = rules.equippedArmor(char, data);
    const armorKey = armorRec ? ARMOR_PROFICIENCY[armorRec.type] : null;
    const armorUntrained = !!armorRec && !(armorKey && prof.armor[armorKey]);
    const acpPenalty = armorUntrained ? Math.min(0, s.acp) : 0;
    const resolved = bonus.resolve(char, data, { state: { encumbered: !!s.bulk && s.bulk.state !== 'ok' } });
    const baseCtx = formula.formulaCtx(char, data);
    const raceRec = own(table(data, 'races'), char.race);
    const features = rules.classFeatures(char, data).map((f) => f.slug);
    const mechanicLevels = rules.classLevels(char).mechanic || 0;

    const weaponSources = {};
    gearOf(char).forEach((g) => {
      const rec = itemOf(data, g.item);
      if (!rec || !rec.weapon) return;
      [g.item].concat(asList(g.slots).map((x) => x && x.item), asList(g.fusions).map(fusionSlug)).forEach((k) => { weaponSources[k] = true; });
    });

    function scopeFor(m, line) {
      const targets = m.targets;
      const va = m.valueAffected === undefined || m.valueAffected === null ? '' : String(m.valueAffected);
      const kinds = line.melee ? ['melee'] : ['ranged'];
      const matches = (area) => ['all', 'weapon'].concat(kinds).some((k) => targets.indexOf(area + '.' + k) !== -1);
      const propHit = targets.some((t) => t === 'damage.property.' + va) && line.properties.indexOf(va) !== -1;
      const typed = va !== '' && knownTypes.indexOf(va) !== -1;
      let attack = matches('attack');
      let damage = matches('damage');
      if (va !== '' && !typed) { attack = false; damage = false; }
      if (typed) {
        let types = [va];
        if (m.kind === 'feat' && CHOSEN_TYPE_FEATS.indexOf(m.sourceKey) !== -1) types = chosenTypes(char, m.sourceKey);
        if (types.indexOf(line.type) === -1) { attack = false; damage = false; }
      } else if (m.kind === 'feat' && CHOSEN_TYPE_FEATS.indexOf(m.sourceKey) !== -1) {
        attack = false; damage = false;
      }
      if (m.kind === 'item' && weaponSources[m.sourceKey] && line.sources.indexOf(m.sourceKey) === -1) { attack = false; damage = false; }
      return { attack, damage: damage || propHit };
    }

    function valueFor(m, line) {
      const ctx = Object.assign({}, baseCtx, { item: { properties: line.propertyMap } });
      let v;
      try { v = formula.evalFormula(m.modifier, ctx); } catch (e) { if (!(e instanceof formula.FormulaError)) throw e; return null; }
      return Math.floor(v);
    }

    function build(line) {
      const attackBonuses = [];
      const damageBonuses = [];
      resolved.constants.forEach((m) => {
        const scope = scopeFor(m, line);
        if (!scope.attack && !scope.damage) return;
        const v = valueFor(m, line);
        if (v === null) return;
        const entry = { type: m.type, value: v, source: m.kind + ':' + m.sourceKey };
        if (scope.attack && m.targets.some((t) => t.indexOf('attack.') === 0)) attackBonuses.push(entry);
        if (scope.damage && m.targets.some((t) => t.indexOf('damage.') === 0)) damageBonuses.push(entry);
      });
      chosenTypes(char, SPEC_FEAT).forEach((t) => {
        if (t === line.type && lvl >= SPEC_FEAT_MIN_LEVEL) {
          damageBonuses.push({ type: SPEC_TYPE, value: halfSpec(t, line.operative) ? Math.floor(lvl / 2) : lvl, source: 'feat:' + SPEC_FEAT });
        }
      });
      if (features.indexOf(COMBAT_TRACKING) !== -1 && mechanicLevels >= COMBAT_TRACKING_SPEC_LEVEL && line.type === 'longA') {
        damageBonuses.push({ type: SPEC_TYPE, value: lvl, source: 'feature:' + COMBAT_TRACKING });
      }
      if (line.extraDamage) damageBonuses.push(line.extraDamage);
      return { attack: bonus.stack(attackBonuses), damage: bonus.stack(damageBonuses) };
    }

    const lines = [];
    function addLine(name, line, parts, rec) {
      const ability = line.melee
        ? (line.operative ? Math.max(s.abilities.str.mod, s.abilities.dex.mod) : s.abilities.str.mod)
        : s.abilities.dex.mod;
      const mods = build(line);
      const key = WEAPON_PROFICIENCY[line.type];
      const trained = line.alwaysProficient || (key !== undefined && !!prof.weapon[key])
        || (line.type === 'special' && prof.specialItems.indexOf(line.sources[0]) !== -1);
      const notes = [];
      if (key === undefined) notes.push('Unknown weapon type ' + line.type + ', treated as not proficient');
      if (!trained) notes.push('Not proficient (-4)');
      if (acpPenalty) notes.push('Armor penalty ' + acpPenalty + ' (not proficient)');
      asList(line.types).length && notes.push(asList(line.types).join('/'));
      if (line.properties.length) notes.push(line.properties.join(', '));
      if (rec && rec.weapon && rec.weapon.special) notes.push(rec.weapon.special);
      if (line.notes) notes.push(line.notes);
      const d = damageText(parts, Object.assign({}, baseCtx, { item: { properties: line.propertyMap } }));
      lines.push({
        name,
        attack: s.bab + ability + mods.attack + (trained ? 0 : NONPROFICIENT_PENALTY) + acpPenalty,
        damage: joinDamage(d.dice, d.flat + mods.damage),
        crit: rec && rec.weapon ? rec.weapon.crit || '' : '',
        range: rec && rec.weapon ? rec.weapon.range || '' : line.range || '',
        notes: notes.join('; ')
      });
    }

    gearOf(char).forEach((g) => {
      const rec = itemOf(data, g.item);
      if (!rec || !rec.weapon) return;
      const w = rec.weapon;
      const properties = asList(w.properties);
      const propertyMap = {};
      properties.forEach((p) => { propertyMap[p] = true; });
      const sources = [g.item].concat(asList(g.slots).map((x) => x && x.item), asList(g.fusions).map(fusionSlug));
      const operative = properties.indexOf('operative') !== -1;
      const thrown = properties.indexOf('thrown') !== -1;
      const base = { type: w.type, properties, propertyMap, sources, operative, types: asList(w.damage).reduce((a, p) => a.concat(asList(p.types)), []) };
      const melee = MELEE_TYPES.indexOf(w.type) !== -1 || (w.type === 'special' && !w.range);
      addLine(rec.name, Object.assign({}, base, { melee }), w.damage, rec);
      if (melee && thrown) addLine(rec.name + ' (thrown)', Object.assign({}, base, { melee: false, operative: false }), w.damage, rec);
    });

    const unarmedBase = { type: UNARMED.type, properties: [], propertyMap: {}, sources: [], melee: true, operative: false, alwaysProficient: true, range: '' };
    const strMod = s.abilities.str.mod;
    const strikeParts = [{ formula: UNARMED.dice + ' + ' + strMod }];
    const natural = !!raceRec && raceRec.base === 'vesk';
    const naturalSpec = natural && lvl >= SPEC_FEAT_MIN_LEVEL ? Math.floor(lvl * 1.5) : 0;
    if (natural) {
      const extra = naturalSpec ? { type: SPEC_TYPE, value: naturalSpec, source: 'race:vesk' } : null;
      addLine('Natural weapons (vesk)', Object.assign({}, unarmedBase, { types: ['lethal'], notes: 'Not archaic, threatens squares', extraDamage: extra }), strikeParts, null);
    }
    else addLine(UNARMED.name, Object.assign({}, unarmedBase, { types: ['nonlethal'] }), strikeParts, null);
    return lines;
  }

  const api = { WEALTH, ITEM_LEVEL_CAP, WEAPON_PROFICIENCY, ARMOR_PROFICIENCY, FUSION_PRICE, FEAT_CHOICE, TYPE_NAME, weaponTypeChoices, featChoiceProblem, budget, bulkState, isPersonal, personalModifiers, personalUpgrades, upgradeBonuses, personalAllowed, gearBlockers: blockersFor, itemAllowed, proficiency, attackLines };
  if (typeof module !== 'undefined') module.exports = api; else root.SF = Object.assign(root.SF || {}, api);
})(this);
