import { describe, expect, it } from 'vitest';
import { isAdminCharacter, isAffiliationAllowed, parseIdList, parseNameList } from '../../server/src/lib/eveSso.js';

describe('parseIdList', () => {
  it('splits a comma-separated list', () => {
    expect(parseIdList('98000001,99000002')).toEqual(['98000001', '99000002']);
  });

  it('tolerates spaces and trailing commas', () => {
    expect(parseIdList(' 98000001 , 99000002 , ')).toEqual(['98000001', '99000002']);
  });

  it('is empty for unset or blank config', () => {
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList('')).toEqual([]);
  });
});

describe('parseNameList', () => {
  it('lowercases names so matching is case-insensitive', () => {
    expect(parseNameList('BoxxyKiller, Someone Else')).toEqual(['boxxykiller', 'someone else']);
  });
});

describe('isAffiliationAllowed', () => {
  const corps = ['98000001'];
  const alliances = ['99000002'];

  it('allows a character in an allowed corporation', () => {
    const allowed = isAffiliationAllowed(
      { corporationId: '98000001', allianceId: null },
      { allowedCorporationIds: corps, allowedAllianceIds: alliances },
    );
    expect(allowed).toBe(true);
  });

  it('allows a character in an allowed alliance even if its corp is not listed', () => {
    const allowed = isAffiliationAllowed(
      { corporationId: '98999999', allianceId: '99000002' },
      { allowedCorporationIds: corps, allowedAllianceIds: alliances },
    );
    expect(allowed).toBe(true);
  });

  it('rejects a character matching neither list', () => {
    const allowed = isAffiliationAllowed(
      { corporationId: '98999999', allianceId: '99999999' },
      { allowedCorporationIds: corps, allowedAllianceIds: alliances },
    );
    expect(allowed).toBe(false);
  });

  it('rejects a character with no affiliation at all when lists are configured', () => {
    const allowed = isAffiliationAllowed(
      { corporationId: null, allianceId: null },
      { allowedCorporationIds: corps, allowedAllianceIds: alliances },
    );
    expect(allowed).toBe(false);
  });

  it('compares as strings, so numeric ids from ESI still match', () => {
    const allowed = isAffiliationAllowed(
      { corporationId: 98000001, allianceId: null },
      { allowedCorporationIds: corps, allowedAllianceIds: [] },
    );
    expect(allowed).toBe(true);
  });

  it('allows everyone when both lists are empty', () => {
    // Documented in .env.example: an unconfigured instance is wide open, and
    // the Settings page surfaces that rather than leaving it silent.
    const allowed = isAffiliationAllowed(
      { corporationId: '98999999', allianceId: null },
      { allowedCorporationIds: [], allowedAllianceIds: [] },
    );
    expect(allowed).toBe(true);
  });
});

describe('isAdminCharacter', () => {
  it('matches regardless of case', () => {
    expect(isAdminCharacter('BoxxyKiller', ['boxxykiller'])).toBe(true);
  });

  it('rejects a name not on the list', () => {
    expect(isAdminCharacter('Someone Else', ['boxxykiller'])).toBe(false);
  });

  it('rejects everyone when the list is empty', () => {
    expect(isAdminCharacter('BoxxyKiller', [])).toBe(false);
  });

  it('handles a missing name without throwing', () => {
    expect(isAdminCharacter(null, ['boxxykiller'])).toBe(false);
  });
});
