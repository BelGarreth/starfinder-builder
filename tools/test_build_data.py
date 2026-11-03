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
        self.assertEqual(set(self.d['progressions']), set(build_data.CLASSES))

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
        self.assertEqual(items['arrows']['perPack'], 20)
        self.assertNotIn('perPack', items['baton_tactical'])
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

    def test_feat_aon_links_use_feat_display_without_type_suffix(self):
        feats = self.d['feats']
        self.assertEqual(feats['blind-fight_(combat)']['aon'], 'https://www.aonsrd.com/FeatDisplay.aspx?ItemName=Blind-Fight')
        self.assertEqual(feats['toughness']['aon'], 'https://www.aonsrd.com/FeatDisplay.aspx?ItemName=Toughness')
        teamwork = [f for f in feats.values() if f['name'].endswith('(Combat, Teamwork)')]
        self.assertTrue(teamwork)
        for f in feats.values():
            self.assertTrue(f['aon'].startswith('https://www.aonsrd.com/FeatDisplay.aspx?ItemName='), f['name'])
            self.assertNotIn('%28', f['aon'], f['name'])

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


    def test_stale_files_ignores_built_date_and_names_changed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            build_data.write_data_dir(dict(self.d, meta=dict(self.d['meta'], built='2000-01-01')), tmp)
            self.assertEqual(build_data.stale_files(dict(self.d, meta=dict(self.d['meta'], built='2099-12-31')), tmp), [])
            items = Path(tmp) / 'items.js'
            items.write_text(items.read_text().replace('"items":{', '"items":{"x":{},', 1))
            (Path(tmp) / 'index.js').unlink()
            self.assertEqual(build_data.stale_files(self.d, tmp), ['items.js', 'index.js'])

    def test_check_flag_exits_nonzero_and_names_the_stale_file(self):
        script = str(ROOT / 'tools' / 'build_data.py')
        with tempfile.TemporaryDirectory() as tmp:
            build_data.write_data_dir(dict(self.d, meta={'foundrySha': SHA, 'built': '2000-01-01'}), tmp)
            ok = subprocess.run(['python3', script, '--check', '--out', tmp], capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stderr)
            spells = Path(tmp) / 'spells.js'
            spells.write_text(spells.read_text().replace('"spells":{', '"spells":{"x":{},', 1))
            bad = subprocess.run(['python3', script, '--check', '--out', tmp], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 1)
            self.assertIn('spells.js', bad.stderr)
            self.assertNotIn('core.js', bad.stderr)

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

    def test_player_choice_records_carry_a_param_or_an_exemption(self):
        import json
        entries = json.loads((ROOT / 'tools' / 'choice_params.json').read_text())
        records = {**self.d['feats'], **self.d['features']}
        for slug, entry in entries.items():
            self.assertTrue(entry['_why'], slug)
            self.assertEqual('param' in entry, 'param' in records[slug], slug)
        for slug in ('skill_focus', 'student', 'channel_skill_(su)', 'resistance_(ex_exocortex)', 'greater_resistance_(ex_exocortex)',
                     'resistant_energy_(ex)', 'improved_resistant_energy_(ex)'):
            self.assertIn('param', records[slug], slug)
        self.assertEqual(records['student']['param'], {'kind': 'skill', 'count': 2})
        self.assertEqual(records['channel_skill_(su)']['param']['derive'], 'connectionSkills')
        self.assertEqual(records['healer']['associatedSkills'], ['med', 'mys'])
        self.assertFalse([k for k, r in records.items() if '_modTab' in r])

    def test_build_fails_on_an_unlisted_player_choice_record(self):
        import json, tempfile
        entries = json.loads((ROOT / 'tools' / 'choice_params.json').read_text())
        del entries['student']
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'choice_params.json'
            path.write_text(json.dumps(entries))
            with self.assertRaisesRegex(ValueError, 'student'):
                build_data.build(build_data.fetch_foundry(SHA, ROOT / 'tools' / '..' / '.cache' / 'foundry'), choice_params_path=path)

    def test_build_rejects_a_bad_param(self):
        import json, tempfile
        entries = json.loads((ROOT / 'tools' / 'choice_params.json').read_text())
        entries['student']['param'] = {'kind': 'skill', 'count': 2, 'from': ['nope']}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'choice_params.json'
            path.write_text(json.dumps(entries))
            with self.assertRaisesRegex(ValueError, 'nope'):
                build_data.build(build_data.fetch_foundry(SHA, ROOT / 'tools' / '..' / '.cache' / 'foundry'), choice_params_path=path)

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

    def test_replace_override_swaps_record_modifiers_and_stays_out_of_effects(self):
        effects = self.d['overrides']['effects']
        aa = self.d['features']['armored_advantage_(ex)']
        self.assertTrue(aa['modifiersReplaced'])
        self.assertEqual(len(aa['modifiers']), 1)
        self.assertEqual((aa['modifiers'][0]['modifierType'], aa['modifiers'][0]['when']), ('constant', 'armor'))
        self.assertNotIn('armored_advantage_(ex)', effects)
        ub = self.d['features']['unyielding_bulwark_(ex)']['modifiers']
        self.assertEqual([(m['modifierType'], bool(m['condition'])) for m in ub], [('formula', True)])
        self.assertEqual(self.d['features']['sneaky_(halfling)']['modifiers'][0]['modifier'], '2')
        self.assertEqual(self.d['features']['fading_shadow_(su)']['modifiers'], [])

    def test_replaced_modifiers_are_never_unconditional_constants_without_reason(self):
        for slug, rec in {**self.d['feats'], **self.d['features']}.items():
            if rec.get('modifiersReplaced'):
                for m in rec['modifiers']:
                    if m['modifierType'] == 'constant' and slug not in ('sneaky_(halfling)', 'toughness'):
                        self.assertIn(m.get('when'), ('armor', 'lightOrNoArmor'), slug)

    def test_quick_movement_is_a_light_armor_constant(self):
        for slug in ('quick_movement_(ex)', 'improved_quick_movement_(ex)'):
            mods = self.d['features'][slug]['modifiers']
            self.assertEqual([(m['modifierType'], m['when'], m['effectType']) for m in mods],
                             [('constant', 'lightOrNoArmor', 'specific-speed')], slug)

    def test_when_field_only_on_constants_and_known(self):
        for slug, value in self.d['overrides']['effects'].items():
            if value != 'none':
                for m in value:
                    if 'when' in m:
                        self.assertIn(m['when'], ('armor', 'lightOrNoArmor'), slug)
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
        self.assertEqual(self.d['overrides']['effects']['exosuit'], 'none')
        self.assertEqual(self.d['features']['the_only_mech_for_me_(ex)']['modifiers'][0]['valueAffected'], 'pil')

    def test_conditional_bonuses_are_never_constant(self):
        for slug, value in self.d['overrides']['effects'].items():
            if value != 'none':
                for m in value:
                    if m['modifierType'] == 'constant':
                        self.assertFalse(m['condition'], slug)
                    else:
                        self.assertEqual(m['modifierType'], 'formula', slug)
                        self.assertTrue(m['condition'], slug)


    def test_review_features_are_mapped_to_their_class(self):
        f = self.d['features']
        expect = {
            'electric_arc_(ex_7th_level)': ('soldier', 'gearBoost'), 'exocortex_mods_(ex)': ('mechanic', None),
            'memory_module_(ex)': ('mechanic', None), 'multitasking_(ex)': ('mechanic', None),
            'twin_tracking_(ex)': ('mechanic', None), 'quad_tracking_(ex)': ('mechanic', None),
            'wireless_hack_(ex)': ('mechanic', None), 'disciple': ('operative', 'specialization'),
            'class-daredevil': ('operative', 'specialization'), 'rapid_response_(ex)_(1st)': ('soldier', None),
        }
        for slug, (cls, category) in expect.items():
            self.assertEqual((f[slug]['cls'], f[slug]['category']), (cls, category), slug)
        self.assertEqual(f['memory_module_(ex)']['parent'], 'exocortex')
        self.assertNotIn('intuitive_deconstruction_(ex)', f)

    def test_option_grants_follow_the_option_text(self):
        f = self.d['features']
        self.assertEqual(f['blitz']['grants'], {
            '1': ['rapid_response_(ex)_(1st)'], '5': ['charge_attack_(ex)_(2nd)'], '9': ['keep_fighting_(ex)_(3rd)'],
            '13': ['perfect_opportunity_(ex)_(4th)'], '17': ['against_the_odds_(ex)_(5th)']})
        self.assertEqual(sorted(f['healer']['grants'], key=int), ['1', '3', '6', '9', '12', '15', '18'])
        self.assertEqual(f['class-daredevil']['grants'], {'5': ['versatile_movement_(ex)'], '11': ['terrain_attack_(ex)']})
        self.assertEqual(f['class-daredevil']['skillFocus'], ['acr', 'ath'])
        self.assertEqual(f['bully']['skillFocus'], ['ath', 'int'])
        for slug, rec in f.items():
            for granted in [g for tier in rec.get('grants', {}).values() for g in tier]:
                self.assertIn(granted, f, slug)

    def test_connection_spells_resolve_fixed_and_variable_lists(self):
        features = self.d['features']
        self.assertEqual(features['overlord']['connectionSpells']['fixed']['4'], 'confusion')
        healer = features['healer']['connectionSpells']
        self.assertEqual(healer['variable'], 'mystic_cure')
        self.assertEqual(healer['fixed']['1'], 'remove_condition_lesser')
        for slug, rec in features.items():
            if rec.get('category') != 'connection':
                continue
            found = rec['connectionSpells']
            fixed = set(found['fixed'])
            full = {'1', '2', '3', '4', '5', '6'}
            self.assertTrue(fixed == full or ('variable' in found and fixed == full - {'6'}), slug)
            for spell in list(found['fixed'].values()) + ([found['variable']] if 'variable' in found else []):
                self.assertIn(spell, self.d['spells'], slug)

    def test_progressions_cover_levels_and_resolve(self):
        prog = self.d['progressions']
        for cls in build_data.CLASSES:
            self.assertEqual(sorted(prog[cls]['levels'], key=int), [str(n) for n in range(1, 21)], cls)
        soldier1 = prog['soldier']['levels']['1']
        style = next(e for e in soldier1 if e.get('choice') == 'fightingStyle')
        self.assertIn('blitz', style['pool'])
        self.assertIn({'fixedOf': 'fightingStyle', 'tier': 1}, soldier1)
        self.assertIn({'bonusFeat': True, 'pool': 'combat'}, prog['soldier']['levels']['2'])
        self.assertEqual([e for e in prog['mechanic']['levels']['1'] if e.get('choice') == 'ai'][0]['pool'], ['exocortex'])
        self.assertIn('enhanced', prog['technomancer'])
        self.assertEqual(self.d['features']['flight_system_(ex_exocortex)']['minLevel'], 11)

    def test_progression_build_fails_on_bad_slug_or_missing_level(self):
        source = json.loads((ROOT / 'tools' / 'class_progressions.json').read_text())
        features = json.loads(json.dumps(self.d['features']))
        bad_slug = json.loads(json.dumps(source))
        bad_slug['soldier']['levels']['20'].append({'fixed': 'no_such_feature'})
        with self.assertRaisesRegex(ValueError, 'no_such_feature'):
            build_data.build_progressions(bad_slug, features, self.d['feats'])
        missing = json.loads(json.dumps(source))
        del missing['envoy']['levels']['7']
        with self.assertRaisesRegex(ValueError, 'envoy lacks levels 7'):
            build_data.build_progressions(missing, features, self.d['feats'])
        dangling = json.loads(json.dumps(source))
        dangling['mystic']['levels']['3'].append({'fixedOf': 'nope', 'tier': 3})
        with self.assertRaisesRegex(ValueError, 'nope'):
            build_data.build_progressions(dangling, features, self.d['feats'])


    def test_option_requirements_parse_into_needs(self):
        f = self.d['features']
        self.assertEqual(f["improved_get_'em_(ex)"]['needs'], ["get_'em_(ex)"])
        self.assertEqual(f['improved_seize_the_advantage_(ex)']['needs'], ['seize_the_advantage_(ex)'])
        self.assertEqual(f['superior_overcharge_(ex)']['needs'], ['overcharge_(ex)', 'improved_overcharge_(ex)'])
        self.assertEqual(f['prototype_tinkerer_(ex)']['needs'], [['experimental_armor_prototype', 'experimental_explosives_(ex)',
                                                                  'experimental_vehicle_(ex)', 'experimental_weapon_prototype_(ex)']])
        self.assertEqual(f['repair_drone_(ex)']['needs'], ['drone'])
        self.assertEqual(f['ambusher']['needsClassSkill'], ['ste'])
        self.assertEqual(f['geomagnetic_charge_(ex)']['minLevel'], 8)
        self.assertIn('four or more arms', f['fourfold_tactician']['needsText'][0])
        for rec in f.values():
            for need in rec.get('needs', []):
                for slug in (need if isinstance(need, list) else [need]):
                    self.assertIn(slug, f)

    def test_stellar_types_and_stellar_mode(self):
        f = self.d['features']
        for slug, rec in f.items():
            if rec.get('category') == 'zenithRevelation':
                self.assertIn(rec.get('stellarType'), ('graviton', 'photon'), slug)
        self.assertEqual(f['quantum_entrapment_(su)']['stellarType'], 'graviton')
        self.assertEqual(f['stellar_mode_(su)']['cls'], 'solarian')
        self.assertIn({'fixed': 'stellar_mode_(su)'}, self.d['progressions']['solarian']['levels']['1'])

    def test_mechanic_trick_pool_has_no_drone_tricks(self):
        pool = next(e for e in self.d['progressions']['mechanic']['levels']['2'] if e.get('choice') == 'trick')['pool']
        for slug in ('repair_drone_(ex)', 'artificial_pilot_(ex)', 'exploration_routine_(ex)', 'protective_programming_(ex)',
                     'melded_mod_(ex)', 'drone_meld_(ex)'):
            self.assertNotIn(slug, pool)
        self.assertIn('combat_boost_(ex)', pool)

    def test_distinct_choice_needs_the_field_on_every_option(self):
        source = json.loads((ROOT / 'tools' / 'class_progressions.json').read_text())
        features = json.loads(json.dumps(self.d['features']))
        del features['starquake_(su)']['stellarType']
        with self.assertRaisesRegex(ValueError, 'starquake'):
            build_data.build_progressions(source, features, self.d['feats'])


    def test_requirement_sentences_are_always_parsed(self):
        f = self.d['features']
        self.assertEqual(f['quick_shoo!_(ex)']['needs'], ['shoo!_(ex)'])
        self.assertTrue(f['energy_reflection_(ex)'].get('needs') or f['energy_reflection_(ex)'].get('needsText'))
        self.assertFalse([k for k, v in f.items() if any(key.startswith('_') for key in v)])
        fake = {'x': {'_needDetected': True}, 'y': {'_needDetected': True, '_needLevel': True}}
        with self.assertRaisesRegex(ValueError, 'not parsed for pool options: x'):
            build_data.check_needs_parsed({'c': {'levels': {'1': [{'choice': 'a', 'pool': ['x', 'y']}]}}}, fake)

    def test_specializations_use_their_associated_skills_for_free_ranks(self):
        for slug, rec in self.d['features'].items():
            if rec.get('category') == 'specialization':
                self.assertTrue(rec['freeRanks'], slug)
                self.assertFalse([m for m in rec['modifiers'] if m['effectType'] == 'skill-ranks'], slug)
        self.assertEqual(self.d['features']['disciple']['skillFocus'], ['mys', 'per'])


if __name__ == '__main__':
    unittest.main()
