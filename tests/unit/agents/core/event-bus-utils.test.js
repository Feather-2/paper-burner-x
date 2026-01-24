import { describe, it, expect } from 'vitest';

import {
  isValidEventName,
  isValidEventPattern,
  assertValidEventName,
  assertValidEventPattern,
  createEventId,
  matchPattern,
} from '../../../../js/agents/core/event-bus-utils.js';

describe('isValidEventName', () => {
  it('should_return_true_when_name_is_global_wildcard', () => {
    // Arrange
    const name = '*';

    // Act
    const result = isValidEventName(name);

    // Assert
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_is_single_segment', () => {
    const result = isValidEventName('user');
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_uses_dot_separators', () => {
    const result = isValidEventName('user.login');
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_uses_colon_separators', () => {
    const result = isValidEventName('user:login');
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_mixes_dot_and_colon_separators', () => {
    const result = isValidEventName('a.b:c');
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_contains_digits_and_underscores', () => {
    const result = isValidEventName('a_b1.c2');
    expect(result).toBe(true);
  });

  it('should_return_false_when_name_is_null', () => {
    const result = isValidEventName(null);
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_undefined', () => {
    const result = isValidEventName(undefined);
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_empty_string', () => {
    const result = isValidEventName('');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_whitespace_string', () => {
    const result = isValidEventName('   ');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_number', () => {
    const result = isValidEventName(0);
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_array', () => {
    const result = isValidEventName([]);
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_object', () => {
    const result = isValidEventName({});
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_is_string_object', () => {
    const result = isValidEventName(new String('abc'));
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_uppercase_letters', () => {
    const result = isValidEventName('Bad.Name');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_hyphen', () => {
    const result = isValidEventName('user-login');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_starts_with_separator', () => {
    const result = isValidEventName('.start');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_ends_with_separator', () => {
    const result = isValidEventName('end.');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_double_dot', () => {
    const result = isValidEventName('a..b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_double_colon', () => {
    const result = isValidEventName('a::b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_adjacent_separators', () => {
    const result = isValidEventName('a.:b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_ends_with_colon', () => {
    const result = isValidEventName('a:');
    expect(result).toBe(false);
  });

  it('should_return_false_when_name_contains_wildcard_characters', () => {
    const result = isValidEventName('user.*');
    expect(result).toBe(false);
  });

  it('should_return_true_when_name_is_very_long', () => {
    const longName = 'file.' + 'a'.repeat(50000);
    const result = isValidEventName(longName);
    expect(result).toBe(true);
  });

  it('should_return_true_when_name_is_deeply_nested', () => {
    const deepName = Array.from({ length: 120 }, () => 'seg').join('.');
    const result = isValidEventName(deepName);
    expect(result).toBe(true);
  });
});

describe('isValidEventPattern', () => {
  it('should_return_true_when_pattern_is_global_wildcard', () => {
    const result = isValidEventPattern('*');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_contains_star_wildcard', () => {
    const result = isValidEventPattern('user.*');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_contains_question_wildcard', () => {
    const result = isValidEventPattern('user.?');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_is_multi_segment_with_wildcards', () => {
    const result = isValidEventPattern('user.*.detail');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_uses_colon_separator_with_wildcard', () => {
    const result = isValidEventPattern('user:*');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_has_wildcard_inside_segment', () => {
    const result = isValidEventPattern('a*b');
    expect(result).toBe(true);
  });

  it('should_return_false_when_pattern_is_null', () => {
    const result = isValidEventPattern(null);
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_undefined', () => {
    const result = isValidEventPattern(undefined);
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_empty_string', () => {
    const result = isValidEventPattern('');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_whitespace_string', () => {
    const result = isValidEventPattern('   ');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_number', () => {
    const result = isValidEventPattern(0);
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_array', () => {
    const result = isValidEventPattern([]);
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_object', () => {
    const result = isValidEventPattern({});
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_is_string_object', () => {
    const result = isValidEventPattern(new String('*'));
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_contains_uppercase_letters', () => {
    const result = isValidEventPattern('Bad.Pattern');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_contains_hyphen', () => {
    const result = isValidEventPattern('user-login');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_starts_with_separator', () => {
    const result = isValidEventPattern('.start');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_ends_with_separator', () => {
    const result = isValidEventPattern('end.');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_contains_double_dot', () => {
    const result = isValidEventPattern('a..b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_contains_double_colon', () => {
    const result = isValidEventPattern('a::b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_contains_adjacent_separators', () => {
    const result = isValidEventPattern('a.:b');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_ends_with_colon', () => {
    const result = isValidEventPattern('a:');
    expect(result).toBe(false);
  });

  it('should_return_true_when_pattern_is_very_long', () => {
    const longPattern = 'a'.repeat(20000) + '*';
    const result = isValidEventPattern(longPattern);
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_is_deeply_nested', () => {
    const deepPattern = Array.from({ length: 80 }, () => 'seg').join('.') + '.*';
    const result = isValidEventPattern(deepPattern);
    expect(result).toBe(true);
  });
});

describe('assertValidEventName', () => {
  it('should_not_throw_when_name_is_valid', () => {
    expect(() => assertValidEventName('user.login')).not.toThrow();
  });

  it('should_throw_typeerror_with_message_when_name_is_invalid', () => {
    expect(() => assertValidEventName(null)).toThrowError(new TypeError('Invalid event name: null'));
  });
});

describe('assertValidEventPattern', () => {
  it('should_not_throw_when_pattern_is_valid', () => {
    expect(() => assertValidEventPattern('user.*')).not.toThrow();
  });

  it('should_throw_typeerror_with_message_when_pattern_is_invalid', () => {
    expect(() => assertValidEventPattern(undefined)).toThrowError(
      new TypeError('Invalid event pattern: undefined')
    );
  });
});

describe('createEventId', () => {
  it('should_return_expected_id_when_runId_is_string', () => {
    const result = createEventId('custom', 0);
    expect(result).toBe('evt_custom_0');
  });

  it('should_fall_back_to_default_runId_when_runId_is_null', () => {
    const result = createEventId(null, 1);
    expect(result).toBe('evt_run_1');
  });

  it('should_fall_back_to_default_runId_when_runId_is_undefined', () => {
    const result = createEventId(undefined, 1);
    expect(result).toBe('evt_run_1');
  });

  it('should_fall_back_to_default_runId_when_runId_is_empty_string', () => {
    const result = createEventId('', 1);
    expect(result).toBe('evt_run_1');
  });

  it('should_fall_back_to_default_runId_when_runId_is_not_string', () => {
    const result = createEventId(123, 1);
    expect(result).toBe('evt_run_1');
  });

  it('should_include_negative_seq_in_id', () => {
    const result = createEventId('runA', -1);
    expect(result).toBe('evt_runA_-1');
  });

  it('should_include_max_safe_integer_seq_in_id', () => {
    const result = createEventId('runA', Number.MAX_SAFE_INTEGER);
    expect(result).toBe(`evt_runA_${Number.MAX_SAFE_INTEGER}`);
  });

  it('should_stringify_seq_when_seq_is_string', () => {
    const result = createEventId('custom', '7');
    expect(result).toBe('evt_custom_7');
  });

  it('should_handle_very_long_runId', () => {
    const longRunId = 'r'.repeat(20000);
    const result = createEventId(longRunId, 2);
    expect(result).toBe(`evt_${longRunId}_2`);
  });

  it('should_return_unique_ids_when_called_concurrently', async () => {
    const ids = await Promise.all(
      Array.from({ length: 50 }, (_, i) => Promise.resolve(createEventId('bulk', i)))
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should_return_expected_id_when_called_rapidly_in_loop', () => {
    let lastId = '';
    for (let i = 0; i < 20; i += 1) lastId = createEventId('fast', i);
    expect(lastId).toBe('evt_fast_19');
  });
});

describe('matchPattern', () => {
  it('should_return_false_when_pattern_is_not_string', () => {
    const result = matchPattern(null, 'user.login');
    expect(result).toBe(false);
  });

  it('should_return_false_when_eventName_is_not_string', () => {
    const result = matchPattern('user.*', undefined);
    expect(result).toBe(false);
  });

  it('should_return_true_when_pattern_is_global_wildcard', () => {
    const result = matchPattern('*', 'any.event');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_equals_event_name', () => {
    const result = matchPattern('user.login', 'user.login');
    expect(result).toBe(true);
  });

  it('should_return_true_when_pattern_and_event_name_are_both_empty', () => {
    const result = matchPattern('', '');
    expect(result).toBe(true);
  });

  it('should_return_false_when_pattern_has_no_star_and_is_not_equal', () => {
    const result = matchPattern('user.logout', 'user.login');
    expect(result).toBe(false);
  });

  it('should_return_false_when_pattern_has_question_mark_but_no_star', () => {
    const result = matchPattern('user.?', 'user.a');
    expect(result).toBe(false);
  });

  it('should_match_prefix_star_pattern_when_event_is_prefix', () => {
    const result = matchPattern('user.*', 'user');
    expect(result).toBe(true);
  });

  it('should_match_prefix_star_pattern_when_event_has_subpath', () => {
    const result = matchPattern('user.*', 'user.login');
    expect(result).toBe(true);
  });

  it('should_not_match_prefix_star_pattern_when_prefix_is_different', () => {
    const result = matchPattern('user.*', 'users.login');
    expect(result).toBe(false);
  });

  it('should_not_match_prefix_star_pattern_when_event_does_not_have_separator', () => {
    const result = matchPattern('user.*', 'userx');
    expect(result).toBe(false);
  });

  it('should_match_general_wildcard_pattern_when_star_matches_empty', () => {
    const result = matchPattern('a*b', 'ab');
    expect(result).toBe(true);
  });

  it('should_match_general_wildcard_pattern_when_star_matches_multiple_chars', () => {
    const result = matchPattern('a*b', 'axxb');
    expect(result).toBe(true);
  });

  it('should_return_false_when_general_wildcard_pattern_does_not_match', () => {
    const result = matchPattern('a*b', 'ac');
    expect(result).toBe(false);
  });

  it('should_match_pattern_with_question_mark_when_star_is_present', () => {
    const result = matchPattern('user.?*', 'user.ab');
    expect(result).toBe(true);
  });

  it('should_match_pattern_with_colon_separator_and_question_mark', () => {
    const result = matchPattern('user:?*', 'user:ab');
    expect(result).toBe(true);
  });

  it('should_match_pattern_when_star_matches_zero_chars', () => {
    const result = matchPattern('user:*', 'user:');
    expect(result).toBe(true);
  });

  it('should_not_match_pattern_with_colon_when_event_uses_dot', () => {
    const result = matchPattern('user:*', 'user.login');
    expect(result).toBe(false);
  });

  it('should_match_pattern_when_prefix_contains_star_and_ends_with_dot_star', () => {
    const result = matchPattern('u*er.*', 'user.login');
    expect(result).toBe(true);
  });

  it('should_match_pattern_with_trailing_star_when_text_is_exact_prefix', () => {
    const result = matchPattern('ab*', 'ab');
    expect(result).toBe(true);
  });

  it('should_match_pattern_with_multiple_stars', () => {
    const result = matchPattern('a**', 'a');
    expect(result).toBe(true);
  });

  it('should_handle_deep_event_names_via_fast_path', () => {
    const deepName = Array.from({ length: 80 }, (_, i) => `seg${i}`).join('.');
    const result = matchPattern('seg0.*', deepName);
    expect(result).toBe(true);
  });

  it('should_handle_very_long_strings_without_backtracking', () => {
    const longName = 'a'.repeat(20000);
    const result = matchPattern('a*', longName);
    expect(result).toBe(true);
  });
});