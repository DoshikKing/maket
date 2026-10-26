import { expect, it } from 'vitest';
import { matchesInvitationCode } from '../src/lib/invitation';
it('accepts only the current invitation code and fails closed without a configured code', () => {
  const old = 'old-random-invitation-code';
  const current = 'new-random-invitation-code';
  expect(matchesInvitationCode(current, current)).toBe(true);
  expect(matchesInvitationCode(old, current)).toBe(false);
  expect(matchesInvitationCode('', current)).toBe(false);
  expect(matchesInvitationCode(current, undefined)).toBe(false);
  expect(matchesInvitationCode('', '')).toBe(false);
});
