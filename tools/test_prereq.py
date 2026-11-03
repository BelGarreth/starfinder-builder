import unittest

import prereq

FEATS = {'mobility': 'mobility', 'creature companion expert': 'creature_companion_expert',
         'creature companion adept': 'creature_companion_adept', 'cleave': 'cleave'}
SKILLS = prereq.SKILL_KEYS


def parse(text, **kw):
    return prereq.parse_prereq(text, FEATS, SKILLS, **kw)


def ability(a, n):
    return {'k': 'ability', 'a': a, 'min': n}


class ParsePrereqTest(unittest.TestCase):
    def test_single_ability(self):
        self.assertEqual(parse('Str 15.'), {'all': [ability('str', 15)]})

    def test_bab(self):
        self.assertEqual(parse('Base attack bonus +6'), {'all': [{'k': 'bab', 'min': 6}]})

    def test_two_abilities(self):
        self.assertEqual(parse('Str 13, Dex 13'), {'all': [ability('str', 13), ability('dex', 13)]})

    def test_skill_or(self):
        self.assertEqual(parse('Diplomacy or Intimidate 5 ranks'), {'all': [{'k': 'any', 'of': [
            {'k': 'ranks', 'skill': 'dip', 'min': 5}, {'k': 'ranks', 'skill': 'int', 'min': 5}]}]})

    def test_feat_and_ranks(self):
        self.assertEqual(parse('Creature Companion Expert, Survival 10 ranks.'), {'all': [
            {'k': 'feat', 'feat': 'creature_companion_expert'}, {'k': 'ranks', 'skill': 'sur', 'min': 10}]})

    def test_levels(self):
        self.assertEqual(parse('Character level 5th'), {'all': [{'k': 'level', 'min': 5}]})
        self.assertEqual(parse('Operative level 3rd'), {'all': [{'k': 'classLevel', 'cls': 'operative', 'min': 3}]})

    def test_feat_with_type_suffix_and_ability(self):
        self.assertEqual(parse('Mobility, Dex 13'), {'all': [{'k': 'feat', 'feat': 'mobility'}, ability('dex', 13)]})
        self.assertEqual(parse('Dex 15, Mobility (Combat), base attack bonus +4'), {'all': [
            ability('dex', 15), {'k': 'feat', 'feat': 'mobility'}, {'k': 'bab', 'min': 4}]})

    def test_ability_alternatives_and_long_names(self):
        self.assertEqual(parse('Int 13 or Wis 13'), {'all': [{'k': 'any', 'of': [ability('int', 13), ability('wis', 13)]}]})
        self.assertEqual(parse('11 Constitution'), {'all': [ability('con', 11)]})

    def test_proficiency_and_race_and_feature(self):
        self.assertEqual(parse('Proficiency with grenades'), {'all': [{'k': 'proficiency', 'group': 'grenades'}]})
        self.assertEqual(parse('Shirren.'), {'all': [{'k': 'race', 'race': 'shirren'}]})
        self.assertEqual(parse('Con 13, natural weapons species trait', feature_slugs={'natural weapons': 'nw'}),
                         {'all': [ability('con', 13), {'k': 'feature', 'feature': 'nw'}]})

    def test_comma_or_list_folds_to_any(self):
        self.assertEqual(parse('Cha 13, Int 13, or Wis 13'), {'all': [{'k': 'any', 'of': [
            ability('cha', 13), ability('int', 13), ability('wis', 13)]}]})

    def test_trailing_or_distributes_shared_ranks(self):
        got = parse('Computers, Engineering, Life Science, Mysticism, Physical Science, or Piloting 5 ranks.')
        self.assertEqual(got, {'all': [{'k': 'any', 'of': [{'k': 'ranks', 'skill': k, 'min': 5} for k in ('com', 'eng', 'lsc', 'mys', 'phs', 'pil')]}]})

    def test_or_list_with_unparseable_element_is_none(self):
        self.assertIsNone(parse('Computers, Engineering, or Xenobiology 5 ranks'))

    def test_master_crafter_shape_with_appropriate_profession(self):
        got = parse('Computers, Engineering, or appropriate Profession 5 ranks.')
        self.assertEqual(got, {'all': [{'k': 'any', 'of': [{'k': 'ranks', 'skill': k, 'min': 5} for k in ('com', 'eng', 'pro')]}]})

    def test_profession_specialty_ranks(self):
        self.assertEqual(parse('Profession (musician) 5 ranks'), {'all': [{'k': 'ranks', 'skill': 'pro', 'min': 5}]})

    def test_proficiency_lists(self):
        self.assertEqual(parse('Str 13, proficiency in small arms and longarms'), {'all': [
            ability('str', 13), {'k': 'proficiency', 'group': 'small arms'}, {'k': 'proficiency', 'group': 'longarms'}]})
        self.assertEqual(parse('Proficiency in basic melee weapons or small arms'), {'all': [{'k': 'any', 'of': [
            {'k': 'proficiency', 'group': 'basic melee weapons'}, {'k': 'proficiency', 'group': 'small arms'}]}]})

    def test_semicolon_groups_stay_anded(self):
        self.assertEqual(parse('Dex 13; Mobility'), {'all': [ability('dex', 13), {'k': 'feat', 'feat': 'mobility'}]})

    def test_empty_is_no_requirements(self):
        self.assertEqual(parse(''), {'all': []})

    def test_unparseable_returns_none(self):
        self.assertIsNone(parse('Ability to cast 1st-level spells'))
        self.assertIsNone(parse('Str 13, Ability to cast spells'))

    def test_prerequisites_prefix_stripped(self):
        self.assertEqual(parse('Prerequisites: Dex 13, Mobility'), {'all': [ability('dex', 13), {'k': 'feat', 'feat': 'mobility'}]})


def data(feats=None, features=None, effects=None):
    return {'races': {'r': {'coreTraits': ['core']}}, 'feats': feats or {}, 'features': features or {},
            'overrides': {'effects': effects or {}}}


def feat(summary='ok', prereq_=None, modifiers=None):
    return {'summary': summary, 'prereq': {'all': []} if prereq_ is None else prereq_, 'modifiers': modifiers or []}


def feature(summary='ok', kind='theme', modifiers=None, requirements=''):
    return {'summary': summary, 'kind': kind, 'modifiers': modifiers or [], 'requirements': requirements}


class CoverageTest(unittest.TestCase):
    def test_clean_data_passes(self):
        self.assertEqual(prereq.check_coverage(data(feats={'a': feat()}, features={'b': feature()})), [])

    def test_feat_with_unparsed_prereq_fails(self):
        d = data(feats={'good': feat(), 'bad': {**feat(), 'prereq': None}})
        self.assertEqual(prereq.check_coverage(d), ['bad'])

    def test_bonus_without_modifier_fails_each_source(self):
        text = 'You gain a +2 insight bonus to Perception checks.'
        self.assertEqual(prereq.check_coverage(data(feats={'f': feat(text)})), ['f'])
        self.assertEqual(prereq.check_coverage(data(features={'t': feature(text)})), ['t'])
        self.assertEqual(prereq.check_coverage(data(features={'core': feature(text, kind='race')})), ['core'])
        self.assertEqual(prereq.check_coverage(data(features={'cf': feature(text, kind='race', requirements='Soldier 1st')})), ['cf'])

    def test_alternate_racial_trait_not_gated(self):
        text = '+2 racial bonus to Stealth'
        self.assertEqual(prereq.check_coverage(data(features={'alt': feature(text, kind='race')})), [])

    def test_any_enabled_modifier_or_override_covers(self):
        text = '+1 bonus to AC when fighting defensively'
        mod = [{'modifierType': 'formula'}]
        self.assertEqual(prereq.check_coverage(data(feats={'f': feat(text, modifiers=[{'modifierType': 'constant'}])})), [])
        self.assertEqual(prereq.check_coverage(data(feats={'f': feat(text, modifiers=mod)})), ['f'])
        self.assertEqual(prereq.check_coverage(data(feats={'f': feat(text)}, effects={'f': 'none'})), [])

    def test_bonus_on_phrasing_is_gated(self):
        self.assertEqual(prereq.check_coverage(data(feats={'f': feat('+2 bonus on saving throws against fear')})), ['f'])

    def test_class_feature_gated(self):
        self.assertEqual(prereq.check_coverage(data(features={'c': feature('+1 bonus to AC', kind='class')})), ['c'])

    def test_replaced_modifiers_count_as_covered(self):
        text = '+1 bonus to AC when fighting defensively'
        replaced = {'summary': text, 'kind': 'theme', 'requirements': '', 'modifiers': [{'modifierType': 'formula'}], 'modifiersReplaced': True}
        self.assertEqual(prereq.check_coverage(data(features={'t': replaced})), [])

    def test_single_bad_feat_returns_its_slug(self):
        d = data(feats={'ok': feat('Nothing here'), 'oops': feat('+1 bonus to Will saves')}, features={'t': feature()})
        self.assertEqual(prereq.check_coverage(d), ['oops'])

    def test_colliding_slug_uses_feature_prefix(self):
        text = '+2 bonus to Stealth'
        d = data(feats={'x': feat()}, features={'x': feature(text)})
        self.assertEqual(prereq.check_coverage(d), ['feature:x'])
        d['overrides']['effects']['feature:x'] = 'none'
        self.assertEqual(prereq.check_coverage(d), [])


if __name__ == '__main__':
    unittest.main()
