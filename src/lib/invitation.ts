import { createHash, timingSafeEqual } from 'node:crypto';
export function matchesInvitationCode(candidate: string, expected: string | undefined) {
  if (!expected) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}
