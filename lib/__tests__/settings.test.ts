/**
 * lib/__tests__/settings.test.ts
 *
 * Unit tests for lib/settings.ts's parsing + typed accessor logic. Mocks the
 * repository layer (getSetting) so these are pure logic tests, not DB tests —
 * lib/db/repository/settings.ts itself is a separate concern.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettingMock = vi.fn<(key: string) => string | null>();

vi.mock('../db/repository/settings.js', () => ({
  getSetting: (key: string) => getSettingMock(key),
}));

import {
  parseSettingValue,
  getLiveLlmCalls,
  getMaxUsers,
  getMaxLlmCallsPerUserPerHour,
  getChatHistoryTurns,
  getChatMaxTokens,
} from '../settings.js';

beforeEach(() => {
  getSettingMock.mockReset();
});

describe('parseSettingValue', () => {
  it('parses bool', () => {
    expect(parseSettingValue('true', 'bool')).toBe(true);
    expect(parseSettingValue('false', 'bool')).toBe(false);
    expect(parseSettingValue('garbage', 'bool')).toBeNull();
  });

  it('parses int', () => {
    expect(parseSettingValue('42', 'int')).toBe(42);
    expect(parseSettingValue('not-a-number', 'int')).toBeNull();
  });

  it('passes through string verbatim', () => {
    expect(parseSettingValue('anything at all', 'string')).toBe('anything at all');
  });
});

describe('getLiveLlmCalls', () => {
  it('fails open (true) when the row is absent', () => {
    getSettingMock.mockReturnValue(null);
    expect(getLiveLlmCalls()).toBe(true);
  });

  it('returns true for "true"', () => {
    getSettingMock.mockReturnValue('true');
    expect(getLiveLlmCalls()).toBe(true);
  });

  it('returns false for "false"', () => {
    getSettingMock.mockReturnValue('false');
    expect(getLiveLlmCalls()).toBe(false);
  });

  it('fails closed (false) on garbage, never fails open', () => {
    getSettingMock.mockReturnValue('not-a-bool');
    expect(getLiveLlmCalls()).toBe(false);
  });
});

describe('getMaxUsers', () => {
  it('returns the catalog default (5) when the row is absent', () => {
    getSettingMock.mockReturnValue(null);
    expect(getMaxUsers()).toBe(5);
  });

  it('returns the stored value when valid', () => {
    getSettingMock.mockReturnValue('20');
    expect(getMaxUsers()).toBe(20);
  });

  it('falls back to 1 (minimum) on an unparseable value', () => {
    getSettingMock.mockReturnValue('abc');
    expect(getMaxUsers()).toBe(1);
  });

  it('falls back to 1 on a value below the minimum', () => {
    getSettingMock.mockReturnValue('0');
    expect(getMaxUsers()).toBe(1);
  });
});

describe('getMaxLlmCallsPerUserPerHour', () => {
  it('returns the catalog default (15) when the row is absent', () => {
    getSettingMock.mockReturnValue(null);
    expect(getMaxLlmCallsPerUserPerHour()).toBe(15);
  });

  it('returns the stored value when valid', () => {
    getSettingMock.mockReturnValue('50');
    expect(getMaxLlmCallsPerUserPerHour()).toBe(50);
  });

  it('falls back to 1 on an invalid value', () => {
    getSettingMock.mockReturnValue('-5');
    expect(getMaxLlmCallsPerUserPerHour()).toBe(1);
  });
});

describe('getChatHistoryTurns', () => {
  it('returns the catalog default (10) when the row is absent', () => {
    getSettingMock.mockReturnValue(null);
    expect(getChatHistoryTurns()).toBe(10);
  });

  it('returns the stored value when valid, including 0 (disables history)', () => {
    getSettingMock.mockReturnValue('0');
    expect(getChatHistoryTurns()).toBe(0);
  });

  it('falls back to 0 on an invalid/negative value', () => {
    getSettingMock.mockReturnValue('-3');
    expect(getChatHistoryTurns()).toBe(0);
  });
});

describe('getChatMaxTokens', () => {
  it('returns the catalog default (8192) when the row is absent', () => {
    getSettingMock.mockReturnValue(null);
    expect(getChatMaxTokens()).toBe(8192);
  });

  it('returns the stored value when valid', () => {
    getSettingMock.mockReturnValue('30000');
    expect(getChatMaxTokens()).toBe(30000);
  });

  it('falls back to the catalog minimum (1024) below that floor', () => {
    getSettingMock.mockReturnValue('10');
    expect(getChatMaxTokens()).toBe(1024);
  });

  it('falls back to the catalog minimum on an unparseable value', () => {
    getSettingMock.mockReturnValue('nope');
    expect(getChatMaxTokens()).toBe(1024);
  });
});
