import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import build_data

ROOT = Path(__file__).resolve().parent.parent
SHA = (ROOT / 'tools' / 'foundry.lock').read_text().strip()


class BuildDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = build_data.fetch_foundry(SHA, ROOT / '.cache' / 'foundry')
        cls.d = build_data.build(cls.src)

    def test_top_level_shape(self):
        self.assertEqual(
            set(self.d),
            {'meta', 'races', 'themes', 'classes', 'feats', 'features', 'spells', 'items', 'progressions', 'overrides'},
        )
        self.assertEqual(set(self.d['overrides']), {'effects'})
        self.assertEqual(self.d['progressions'], {})

    def test_races(self):
        races = self.d['races']
        for slug in ('vesk', 'vesk_(cave)', 'lashunta_(damaya)', 'gnome_(feychild)', 'half-orc'):
            self.assertIn(slug, races)
        self.assertFalse([s for s in races if s.startswith('aasimar')])
        self.assertEqual(races['vesk']['abilityMods'], [[2, 'str'], [2, 'con'], [-2, 'int']])
        self.assertEqual(races['vesk']['hp'], 6)
        self.assertEqual(races['vesk']['size'], 'medium')
        self.assertIsNone(races['vesk']['variant'])
        self.assertEqual(races['lashunta_(damaya)']['base'], 'lashunta')
        self.assertEqual(races['lashunta_(damaya)']['variant'], 'Damaya')
        self.assertEqual(races['half-orc']['abilityMods'], [[2, 'any']])

    def test_race_traits_resolve_to_features(self):
        for slug, race in self.d['races'].items():
            self.assertNotIn('traits', race)
            for trait in race['coreTraits'] + race['altTraits']:
                self.assertIn(trait, self.d['features'], slug)
            self.assertFalse(set(race['coreTraits']) & set(race['altTraits']), slug)
            self.assertTrue(race['coreTraits'], slug)

    def test_core_traits(self):
        races = self.d['races']
        vesk = races['vesk']['coreTraits']
        for slug in ('armor_savant_(vesk)', 'fearless', 'low-light_vision'):
            self.assertIn(slug, vesk)
        for slug in ('vesk_venom', 'cave_senses', 'frilled'):
            self.assertNotIn(slug, vesk)
            self.assertIn(slug, races['vesk']['altTraits'])
        self.assertEqual(races['vesk_(cave)']['coreTraits'], vesk)
        self.assertEqual(races['human']['coreTraits'], ['bonus_feat', 'skilled'])
        self.assertIn('adopted', races['human']['altTraits'])
        self.assertIn('driftborn', races['gnome_(driftborn)']['coreTraits'])
        self.assertNotIn('dimorphic_(gnome)', races['gnome_(driftborn)']['coreTraits'])
        self.assertNotIn('driftborn', races['gnome_(feychild)']['coreTraits'])
        self.assertIn('dimorphic_(gnome)', races['gnome_(feychild)']['coreTraits'])
        self.assertIn('dimorphic_(gnome)', races['gnome_(bleachling_gnebling)']['coreTraits'])
        self.assertIn('student', races['lashunta_(damaya)']['coreTraits'])

    def test_core_trait_map_is_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = json.loads((ROOT / 'tools' / 'race_traits.json').read_text())
            missing_base = {k: v for k, v in good.items() if k != 'vesk'}
            bad_slug = json.loads(json.dumps(good))
            bad_slug['vesk']['core'].append('no_such_feature')
            for name, payload in (('missing.json', missing_base), ('bad.json', bad_slug)):
                path = Path(tmp) / name
                path.write_text(json.dumps(payload))
                with self.assertRaises(ValueError):
                    build_data.build(self.src, core_path=path)

    def test_race_traits_fall_back_to_requirements(self):
        traits = build_data.traits_for_race(
            'Vesk', None, '<p>no links</p>', {}, {'Fearless': ('fearless', 'Vesk'), 'Other': ('other', 'Shirren')}
        )
        self.assertEqual(traits, ['fearless'])

    def test_classes(self):
        classes = self.d['classes']
        soldier = classes['soldier']
        self.assertEqual(
            (soldier['bab'], soldier['fort'], soldier['ref'], soldier['hp'], soldier['sp'], soldier['ranks'], soldier['kas']),
            ('full', 'fast', 'slow', 7, 7, 4, 'str'),
        )
        self.assertIn('ath', soldier['csk'])
        self.assertIn('acr', soldier['csk'])
        self.assertNotIn('blu', soldier['csk'])
        self.assertEqual(classes['envoy_enhanced']['enhancedOf'], 'envoy')
        self.assertIsNone(classes['envoy']['enhancedOf'])
        self.assertEqual(
            {s for s in classes if not s.endswith('_enhanced')},
            {'envoy', 'mechanic', 'mystic', 'operative', 'solarian', 'soldier', 'technomancer'},
        )
        self.assertTrue(classes['mystic']['caster'])
        self.assertEqual(classes['mystic']['spellAbility'], 'wis')
        self.assertFalse(classes['soldier']['caster'])

    def test_themes(self):
        themes = self.d['themes']
        self.assertEqual(len(themes), 60)
        ace = themes['ace_pilot']
        self.assertEqual((ace['ability'], ace['mod'], ace['skill']), ('dex', 1, 'pil'))
        self.assertEqual(len(ace['features']), 3)
        for slug, theme in themes.items():
            for f in theme['features']:
                self.assertIn(f, self.d['features'], slug)

    def test_feats(self):
        feats = self.d['feats']
        self.assertNotIn('_folders', feats)
        sp = [m for m in feats['toughness']['modifiers'] if m['modifier'] == '@details.level.value']
        self.assertEqual(len(sp), 1)
        self.assertEqual(sp[0]['effectType'], 'stamina-points')
        self.assertTrue(all(m for f in feats.values() for m in f['modifiers']))
        self.assertEqual(len(feats), 431)
        self.assertEqual(feats['toughness']['prereq'], {'all': []})
        self.assertGreater(sum(1 for f in feats.values() if f['prereqText']), 300)
        self.assertEqual(feats['great_fortitude']['prereqText'], '')

    def test_feat_prereq_text_from_description(self):
        with_requirements = [f for f in self.d['feats'].values() if f['prereqText']]
        self.assertTrue(all('<' not in f['prereqText'] and '@UUID' not in f['prereqText'] for f in with_requirements))
        self.assertTrue(any(f['prereqText'] == 'Con 13.' for f in with_requirements))

    def test_spells(self):
        spells = self.d['spells']
        self.assertEqual(set(spells['adamantine_shot']['allowedClasses']), {'myst', 'tech', 'precog', 'wysh'})
        self.assertTrue(spells['adamantine_shot']['allowedClasses']['tech'])
        self.assertFalse(spells['adamantine_shot']['allowedClasses']['myst'])
        self.assertEqual(spells['adamantine_shot']['level'], 1)

    def test_items(self):
        items = self.d['items']
        self.assertEqual(
            items['second_skin']['armor'],
            {'type': 'light', 'eac': 1, 'kac': 2, 'dex': 5, 'acp': 0, 'speedAdjust': 0},
        )
        self.assertEqual((items['second_skin']['level'], items['second_skin']['price'], items['second_skin']['bulk']), (1, 250, 'L'))
        self.assertEqual(items['second_skin']['slots'], 1)
        baton = items['baton_tactical']
        self.assertEqual((baton['price'], baton['level']), (90, 1))
        self.assertEqual(baton['weapon']['damage'], [{'formula': '1d4 + @abilities.str.mod', 'types': ['bludgeoning']}])
        self.assertIn('operative', baton['weapon']['properties'])
        self.assertNotIn('armor', baton)
        self.assertEqual(sum(1 for i in items.values() if i['type'] == 'weapon'), 1782)
        self.assertEqual(sum(1 for i in items.values() if i['type'] == 'augmentation'), 500)
        self.assertEqual(sum(1 for i in items.values() if 'armor' in i), 304)
        self.assertTrue(all('augSystem' in i for i in items.values() if i['type'] == 'augmentation'))
        self.assertTrue(all(isinstance(i['fusionLevel'], int) for i in items.values() if i['type'] == 'fusion'))

    def test_every_record_has_aon_and_clean_summary(self):
        for section in ('races', 'themes', 'classes', 'feats', 'features', 'spells', 'items'):
            for slug, rec in self.d[section].items():
                self.assertTrue(rec['aon'].startswith('https://www.aonsrd.com/'), (section, slug))
                self.assertLessEqual(len(rec['summary']), 300, (section, slug))
                self.assertNotIn('<', rec['summary'], (section, slug))
                self.assertNotIn('@UUID', rec['summary'], (section, slug))

    def test_aon_links_by_name(self):
        self.assertEqual(self.d['themes']['ace_pilot']['aon'], 'https://www.aonsrd.com/Themes.aspx?ItemName=Ace%20Pilot')
        self.assertEqual(self.d['races']['vesk_(cave)']['aon'], 'https://www.aonsrd.com/Races.aspx?ItemName=Vesk')
        self.assertEqual(self.d['classes']['envoy_enhanced']['aon'], 'https://www.aonsrd.com/Classes.aspx?ItemName=Envoy')
        self.assertTrue(self.d['items']['baton_tactical']['aon'].startswith('https://www.aonsrd.com/Search.aspx?Query='))

    def test_no_summary_leaks_label_markers(self):
        for section in ('features', 'items'):
            for slug, rec in self.d[section].items():
                self.assertFalse(rec['summary'].startswith('>'), (section, slug))

    def test_write_data_dir_round_trips_through_node_and_stays_small(self):
        with tempfile.TemporaryDirectory() as tmp:
            build_data.write_data_dir(self.d, tmp)
            for name in ('core.js', 'spells.js', 'items.js'):
                text = (Path(tmp) / name).read_text()
                self.assertIn('Object.assign(root.SFDATA || {}', text)
                self.assertLess(len(text.encode()), 3_000_000, name)
            self.assertIn('"foundrySha"', (Path(tmp) / 'core.js').read_text())
            self.assertNotIn('"spells"', (Path(tmp) / 'core.js').read_text()[:200])
            out = subprocess.run(
                ['node', '-e', f"const d=require({json.dumps(str(Path(tmp) / 'index.js'))});process.stdout.write(JSON.stringify([Object.keys(d).sort(),Object.keys(d.races).length]))"],
                capture_output=True, text=True, check=True,
            ).stdout
            keys, races = json.loads(out)
            self.assertEqual(keys, sorted(self.d))
            self.assertEqual(races, len(self.d['races']))


class SummarizeTest(unittest.TestCase):
    def test_strips_html_and_uuid(self):
        out = build_data.summarize('<p>Hit @UUID[Compendium.sfrpg.spells.Item.abc]{Magic Missile} &amp; run.</p><p>Second.</p>')
        self.assertEqual(out, 'Hit Magic Missile & run. Second.')

    def test_drops_unlabelled_uuid(self):
        self.assertEqual(build_data.summarize('<p>See @UUID[Compendium.x.y] now.</p>'), 'See now.')

    def test_inline_rolls(self):
        self.assertEqual(build_data.summarize('<p>Deal [[/r 1d6]] damage, [[/r 2d4]]{two dice}.</p>'), 'Deal 1d6 damage, two dice.')

    def test_takes_whole_sentences_up_to_limit(self):
        text = '<p>' + ' '.join(f'Sentence number {i} is here.' for i in range(40)) + '</p>'
        out = build_data.summarize(text)
        self.assertLessEqual(len(out), 300)
        self.assertTrue(out.endswith('here.'))

    def test_single_long_sentence_truncates_at_word(self):
        out = build_data.summarize('<p>' + 'word ' * 200 + '</p>')
        self.assertLessEqual(len(out), 300)
        self.assertTrue(out.endswith('…'))

    def test_drops_leading_label_paragraph(self):
        self.assertEqual(build_data.summarize('<p>&gt;@UUID[x.y]{Guard}</p>\n<p>Real text.</p>'), 'Real text.')

    def test_no_angle_bracket_survives(self):
        self.assertNotIn('<', build_data.summarize('<p>Less than &lt;5 ft.</p>'))


class PrereqIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = build_data.build(build_data.fetch_foundry(SHA, ROOT / 'tools' / '..' / '.cache' / 'foundry'))

    def checks(self, node):
        for check in node.get('all', []) + node.get('of', []):
            yield check
            if check['k'] == 'any':
                yield from self.checks(check)

    def test_coverage_gate_is_empty(self):
        import prereq
        self.assertEqual(prereq.check_coverage(self.d), [])

    def test_every_feat_has_a_prereq(self):
        for slug, feat in self.d['feats'].items():
            self.assertIsNotNone(feat['prereq'], slug)

    def test_prereq_references_resolve(self):
        for slug, feat in self.d['feats'].items():
            for check in self.checks(feat['prereq']):
                if check['k'] == 'feat':
                    self.assertIn(check['feat'], self.d['feats'], slug)
                if check['k'] == 'classLevel':
                    self.assertIn(check['cls'], build_data.CLASSES, slug)

    def test_uuid_in_prereq_resolved_before_parsing(self):
        rending = self.d['feats']['rending_slash']
        self.assertNotIn('@UUID', rending['prereqText'])
        self.assertEqual([c['k'] for c in rending['prereq']['all']], ['ability', 'ability', 'text'])

    def test_parsed_examples(self):
        feats = self.d['feats']
        self.assertEqual(feats['creature_companion_expert']['prereq']['all'][0], {'k': 'feat', 'feat': 'creature_companion_adept'})
        self.assertEqual(feats['cleave_(combat)']['prereq']['all'][0], {'k': 'ability', 'a': 'str', 'min': 13})

    def test_or_lists_and_structured_clauses_in_real_data(self):
        feats = self.d['feats']
        self.assertEqual(feats['profession_mastery']['prereq']['all'][0], {'k': 'any', 'of': [
            {'k': 'ability', 'a': a, 'min': 13} for a in ('cha', 'int', 'wis')]})
        self.assertEqual(len(feats['master_crafter']['prereq']['all'][0]['of']), 6)
        self.assertIn({'k': 'feat', 'feat': 'weapon_focus_(combat)'}, feats['double_tap_(combat)']['prereq']['all'])
        self.assertEqual([c['group'] for c in feats['heavy_weapon_proficiency_(combat)']['prereq']['all'][1:]], ['small arms', 'longarms'])
        self.assertEqual(feats['protective_fur']['prereq']['all'][0]['of'][1], {'k': 'race', 'race': 'ysoki'})

    def test_effect_overrides_land_in_data_without_notes(self):
        effects = self.d['overrides']['effects']
        self.assertEqual(effects['chitinous_wall'], 'none')
        for slug, value in effects.items():
            if value != 'none':
                self.assertTrue(all(m['modifierType'] in ('formula', 'constant') for m in value), slug)

    def test_every_override_has_why_and_known_target(self):
        import json
        names = set(self.d['feats']) | set(self.d['features'])
        for file in ('prereq_overrides.json', 'effect_overrides.json'):
            for slug, entry in json.loads((ROOT / 'tools' / file).read_text()).items():
                self.assertTrue(entry['_why'], slug)
                self.assertIn(slug.removeprefix('feature:'), names)

    def test_class_features_emitted_for_phase1_classes(self):
        cf = {k: f for k, f in self.d['features'].items() if f['kind'] == 'class'}
        self.assertGreater(len(cf), 400)
        self.assertEqual({f['cls'] for f in cf.values()}, set(build_data.CLASSES))
        for key, f in cf.items():
            self.assertIn('requirements', f)
            self.assertTrue(f['summary'], key)
            self.assertIn('modifiers', f)
            self.assertIsInstance(f['enhanced'], bool)
        self.assertEqual(cf['tactful_tactician_(ex)']['cls'], 'soldier')
        self.assertEqual(cf['tactful_tactician_(ex)']['minLevel'], 1)
        self.assertEqual(cf['tactful_tactician_(ex)']['requirements'], '1st Level (Soldier)')

    def test_class_features_exclude_other_classes(self):
        for f in self.d['features'].values():
            if f['kind'] == 'class':
                self.assertNotRegex(f['requirements'], r'(?i)vanguard|witchwarper|biohacker|evolutionist|nanocyte|precog')

    def test_when_field_only_on_constants_and_known(self):
        for slug, value in self.d['overrides']['effects'].items():
            if value != 'none':
                for m in value:
                    if 'when' in m:
                        self.assertEqual(m['when'], 'armor', slug)
                        self.assertEqual(m['modifierType'], 'constant', slug)
        self.assertEqual(self.d['overrides']['effects']['armor_savant_(vesk)'][0]['when'], 'armor')

    def test_class_features_pick_up_lineage_and_category(self):
        f = self.d['features']
        self.assertEqual((f['dramatic_dive_(ex)']['cls'], f['dramatic_dive_(ex)']['category']), ('operative', 'exploit'))
        self.assertEqual((f['quick_scan_(su)']['cls'], f['quick_scan_(su)']['category']), ('technomancer', 'hack'))
        self.assertEqual((f['debug_curse_(su)']['cls'], f['debug_curse_(su)']['category']), ('mechanic', 'mechanicTrick'))
        self.assertEqual(f['dramatic_dive_(ex)']['minLevel'], 2)
        cats = {x['category'] for x in f.values() if x['kind'] == 'class'}
        self.assertTrue({'exploit', 'revelation', 'hack', 'gearBoost', 'mechanicTrick', 'connection', 'fightingStyle', 'improvisation'} <= cats)
        self.assertEqual(f['exosuit']['cls'], 'soldier')
        self.assertIn('@classes.soldier.levels', self.d['overrides']['effects']['exosuit'][0]['modifier'])

    def test_conditional_bonuses_are_never_constant(self):
        for slug, value in self.d['overrides']['effects'].items():
            if value != 'none':
                for m in value:
                    if m['modifierType'] == 'constant':
                        self.assertFalse(m['condition'], slug)
                    else:
                        self.assertEqual(m['modifierType'], 'formula', slug)
                        self.assertTrue(m['condition'], slug)


if __name__ == '__main__':
    unittest.main()
