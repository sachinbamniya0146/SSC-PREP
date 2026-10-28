/**
 * Who may appear on a leaderboard / be counted in a rank.
 *
 * Only real students: ADMIN and MODERATOR (staff) accounts are never listed, never counted in anybody's rank and never
 * counted in "students on the board", and suspended students stay out as before. Before this file the XP leaderboard,
 * the dashboard rank and the per-test toppers only filtered `isSuspended`, so an admin's test XP showed up on the public
 * board and pushed every student one place down.
 *
 * Use it as a Prisma `where` fragment: `{ ...RANKABLE_USER, xp: { gt: 0 } }`  or  `user: RANKABLE_USER`.
 */
export const RANKABLE_USER = { isSuspended: false, role: 'STUDENT' } as const;

/** true when an account with this role is ranked (anything that is not a plain student is staff). */
export function isRankableRole(role: string | null | undefined): boolean {
  return role === 'STUDENT';
}
