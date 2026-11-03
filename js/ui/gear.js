(function(root){
  const U = root.SFUI = root.SFUI || {};
  const SF = () => root.SF;
  const { esc, sign, own, asList, levelsOf, table, fmt, btn, input, select, fld, pickRow, pickTable, capped, matches } = U;

  const TYPE_LABEL = {
    weapon: 'Weapons', equipment: 'Armor and equipment', shield: 'Shields', upgrade: 'Armor upgrades', fusion: 'Weapon fusions',
    weaponAccessory: 'Weapon accessories', ammunition: 'Ammunition', augmentation: 'Augmentations', technological: 'Technological items',
    magic: 'Magic items', hybrid: 'Hybrid items', consumable: 'Consumables', goods: 'Goods', container: 'Containers'
  };
  const ATTACHABLE = ['upgrade', 'fusion'];

  function categories(data) {
    const rules = SF();
    const seen = {};
    Object.keys(table(data, 'items')).forEach((k) => { seen[data.items[k].type] = true; });
    const out = [['all', 'All items'], ['armor', 'Armor']];
    Object.keys(seen).sort().forEach((t) => {
      out.push([t, TYPE_LABEL[t] || t]);
      if (t === 'weapon') Object.keys(rules.TYPE_NAME).concat(['special']).forEach((w) => out.push(['weapon:' + w, '  Weapons: ' + (rules.TYPE_NAME[w] || 'special weapons')]));
    });
    return out;
  }

  function inCategory(rec, cat) {
    if (cat === 'all') return true;
    if (cat === 'armor') return !!rec.armor;
    if (cat.indexOf('weapon:') === 0) return !!rec.weapon && rec.weapon.type === cat.slice(7);
    return rec.type === cat;
  }

  const bulkText = (b) => (b === undefined || b === null || b === '' ? '-' : String(b));

  function inventory(C, UI, data) {
    const items = table(data, 'items');
    const gear = Array.isArray(C.gear) ? C.gear : [];
    if (!gear.length) return '<p class="note">Nothing yet. Buy from the shop below.</p>';
    const rules = SF();
    const rows = gear.map((g, k) => {
      const rec = own(items, g.item);
      if (!rec) return '<tr><td colspan="6" class="bad">Item \'' + esc(g.item) + '\' no longer exists</td><td class="acts">' + btn('dropGear', 'Remove', { c: 'sm x', a: k }) + '</td></tr>';
      const attached = asList(g.slots).map((s, j) => '<div class="note">Upgrade: ' + esc((own(items, s && s.item) || { name: s && s.item }).name) + ' ' + btn('detach', '×', { c: 'sm x', a: k, b: 'slots', cc: j }) + '</div>')
        .concat(asList(g.fusions).map((f, j) => '<div class="note">Fusion: ' + esc((own(items, f && f.item) || { name: f && f.item }).name) + ' ' + btn('detach', '×', { c: 'sm x', a: k, b: 'fusions', cc: j }) + '</div>'));
      const slots = rec.armor ? ' <span class="mute">' + esc(asList(g.slots).length) + ' of ' + esc(Number(rec.slots) || 0) + ' upgrade slots</span>' : '';
      const pick = rules.isPersonal(rec) ? abilityPicker(C, data, g, k) : '';
      const per = Number(rec.perPack) > 1 ? ' <span class="mute">(' + esc(rec.perPack) + ' per pack)</span>' : '';
      return '<tr><td><b>' + esc(rec.name) + '</b> ' + U.aon(rec) + slots + attached.join('') + pick + '</td><td class="num">' + esc(rec.level) + '</td><td>' + input(C, UI, 'gear.' + k + '.qty', { t: 'n', min: 1, c: 's' }) + per
        + '</td><td><input type="checkbox" data-b="gear.' + k + '.equipped" data-t="b"' + (g.equipped ? ' checked' : '') + ' title="Equipped"></td><td class="num">' + esc(fmt(rec.price)) + '</td><td class="num">' + esc(bulkText(rec.bulk)) + '</td><td class="acts">' + btn('dropGear', 'Remove', { c: 'sm x', a: k }) + '</td></tr>';
    });
    return '<div class="scroll"><table class="t"><thead><tr><th>Item</th><th class="num">Level</th><th>Qty</th><th>Equipped</th><th class="num">Price</th><th class="num">Bulk</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function abilityPicker(C, data, g, k) {
    const rules = SF();
    const li = Math.max(0, levelsOf(C).length - 1);
    const opts = [['', '(choose an ability)']].concat(rules.ABILITIES.map((a) => {
      const ans = rules.allowed('ability', a, li, C, data, { index: k });
      return [a, U.ABILITY_NAME[a] + (ans.ok ? '' : ' (' + ans.why + ')'), !ans.ok && a !== g.ability];
    }));
    return '<div class="row c">' + fld('Raises', select(null, g.ability || '', opts, { sel: 'gearAbility', a: k })) + '</div>';
  }

  function attacks(ctx) {
    const rows = asList(ctx.sheet.attacks).map((a) => '<tr><td><b>' + esc(a.name) + '</b></td><td class="num brass"><b>' + esc(sign(a.attack)) + '</b></td><td>' + esc(a.damage) + '</td><td>' + esc(a.crit) + '</td><td>' + esc(a.range) + '</td><td class="note">' + esc(a.notes) + '</td></tr>');
    return '<div class="card"><h2>Attacks</h2><div class="scroll"><table class="t"><thead><tr><th>Weapon</th><th class="num">Attack</th><th>Damage</th><th>Critical</th><th>Range</th><th>Notes</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
  }

  function shop(C, UI, data) {
    const rules = SF();
    const items = table(data, 'items');
    const q = UI.shopQ || '';
    const cat = UI.shopCat || 'all';
    const gear = Array.isArray(C.gear) ? C.gear : [];
    const targets = gear.filter((g) => own(items, g.item) && (items[g.item].armor || items[g.item].weapon));
    const into = targets.some((g) => g.id === UI.into) ? UI.into : '';
    const li = Math.max(0, levelsOf(C).length - 1);
    const list = Object.keys(items).filter((k) => matches(items[k], q) && inCategory(items[k], cat));
    const out = capped(list, (k) => {
      const rec = items[k];
      const attach = into && ATTACHABLE.indexOf(rec.type) !== -1;
      const ans = rules.allowed('item', k, li, C, data, attach ? { into } : undefined);
      const extra = esc('level ' + rec.level + ' · ' + fmt(rec.price) + ' cr · bulk ' + bulkText(rec.bulk));
      return pickRow(rec, { act: 'buy', a: k, ans, label: attach ? 'Install' : 'Buy', extra });
    });
    const targetOpts = [['', 'Inventory']].concat(targets.map((g) => [g.id, items[g.item].name]));
    return '<div class="card"><h2>Shop</h2><div class="row">' + fld('Search items', input(C, UI, '$shopQ', { ph: 'Name' })) + fld('Category', select('$shopCat', cat, categories(data)))
      + fld('Put upgrades and fusions into', select('$into', into, targetOpts)) + '</div><p class="note">' + esc(fmt(out.count)) + ' items. Item level is capped at your character level.</p>' + pickTable(out.rows, 'tall') + out.note + '</div>';
  }

  U.tabGear = function (C, UI, data, ctx) {
    const rules = SF();
    const b = rules.budget(C, data);
    const bulk = ctx.sheet.bulk;
    const bulkPill = bulk.state === 'ok' ? '<span class="pill on">Unencumbered</span>' : '<span class="pill warn">' + (bulk.state === 'overburdened' ? 'Overburdened' : 'Encumbered') + '</span> <span class="note">Allowed, but it slows you down.</span>';
    const summary = '<div class="card"><h2>Gear</h2><div class="wallet"><span>Credits <b>' + esc(fmt(b.credits)) + '</b></span><span>Spent <b>' + esc(fmt(b.spent)) + '</b></span><span>Left <b class="' + (b.left < 0 ? 'bad' : '') + '">' + esc(fmt(b.left)) + '</b></span><span>Bulk <b>' + esc(bulk.carried) + '</b> of ' + esc(bulk.limit) + '</span>' + bulkPill + '</div>'
      + inventory(C, UI, data) + '</div>';
    return summary + attacks(ctx) + shop(C, UI, data);
  };

  Object.assign(U, { TYPE_LABEL, gearCategories: categories });
})(this);
