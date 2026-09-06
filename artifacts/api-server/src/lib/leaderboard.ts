import { asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  leaderboardEntries,
  leaderboardPayouts,
  leaderboardScoreEvents,
  leaderboardSessions,
  appWalletTransactions,
  bingoRounds,
  telegramUsers,
  walletTransactions,
} from "@workspace/db";

export type LeaderboardTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LeaderboardWinner = { telegramId: number; name: string; rank: number; score: number; amount: string; chatId: number };

const ROUND_LIMIT = 10;

async function getOrCreateActiveSession(tx: LeaderboardTransaction) {
  const [active] = await tx.select().from(leaderboardSessions)
    .where(eq(leaderboardSessions.status, "active"))
    .orderBy(desc(leaderboardSessions.id)).limit(1).for("update");
  if (active) return active;
  const [created] = await tx.insert(leaderboardSessions).values({ status: "active" }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await tx.select().from(leaderboardSessions).where(eq(leaderboardSessions.status, "active")).orderBy(desc(leaderboardSessions.id)).limit(1).for("update");
  if (!existing) throw new Error("Leaderboard session could not be created");
  return existing;
}

export async function recordLeaderboardScore(
  tx: LeaderboardTransaction,
  roundId: number,
  telegramId: number,
  eventType: "card_purchase" | "card_release" | "win",
  points: number,
  reference: string,
) {
  const session = await getOrCreateActiveSession(tx);
  const [event] = await tx.insert(leaderboardScoreEvents).values({
    sessionId: session.id,
    roundId,
    telegramId,
    eventType,
    points,
    reference,
  }).onConflictDoNothing({ target: leaderboardScoreEvents.reference }).returning({ id: leaderboardScoreEvents.id });
  if (!event) return session;

  await tx.insert(leaderboardEntries).values({ sessionId: session.id, telegramId, score: points })
    .onConflictDoUpdate({
      target: [leaderboardEntries.sessionId, leaderboardEntries.telegramId],
      set: { score: sql`${leaderboardEntries.score} + ${points}`, updatedAt: new Date() },
    });
  return session;
}

function splitLeaderboardPrize(total: string, prizePercentages: string[]) {
  const cents = Math.round(Number(total) * 100);
  const shares = prizePercentages.map((percentage) => Math.floor(cents * Number(percentage) / 100));
  shares[0] = cents - shares.slice(1).reduce((sum, share) => sum + share, 0);
  return shares.map((share) => (share / 100).toFixed(2));
}

export async function finalizeLeaderboardRound(
  tx: LeaderboardTransaction,
  roundId: number,
  playerIds: number[],
  allocation: {
    leaderboard: string;
    appWallet: string;
    leaderboardPrizePercentages: string[];
    leaderboardCardPurchasePoints: string;
    leaderboardCardReleasePoints: string;
    leaderboardWinPoints: string;
  },
) {
  const [round] = await tx.select({ leaderboardCounted: bingoRounds.leaderboardCounted })
    .from(bingoRounds).where(eq(bingoRounds.id, roundId)).for("update").limit(1);
  if (!round || round.leaderboardCounted) return undefined;

  const session = await getOrCreateActiveSession(tx);
  await tx.insert(appWalletTransactions).values({ roundId, amount: allocation.appWallet })
    .onConflictDoNothing({ target: appWalletTransactions.roundId });
  for (const telegramId of new Set(playerIds)) {
    await recordLeaderboardScore(tx, roundId, telegramId, "win", Number(allocation.leaderboardWinPoints), `leaderboard:win:${session.id}:${roundId}:${telegramId}`);
  }
  const [updatedSession] = await tx.update(leaderboardSessions).set({
    roundCount: sql`${leaderboardSessions.roundCount} + 1`,
    prizePool: sql`${leaderboardSessions.prizePool} + ${allocation.leaderboard}`,
  }).where(eq(leaderboardSessions.id, session.id)).returning();
  if (!updatedSession) throw new Error("Leaderboard session could not be updated");

  const entries = await tx.select({ id: leaderboardEntries.id, telegramId: leaderboardEntries.telegramId, score: leaderboardEntries.score })
    .from(leaderboardEntries).where(eq(leaderboardEntries.sessionId, session.id))
    .orderBy(desc(leaderboardEntries.score), asc(leaderboardEntries.id));
  const isFinalRound = updatedSession.roundCount >= ROUND_LIMIT;
  const winners: LeaderboardWinner[] = [];
  if (isFinalRound) {
    const shares = splitLeaderboardPrize(updatedSession.prizePool, allocation.leaderboardPrizePercentages);
    for (const [index, entry] of entries.entries()) {
      const rank = index + 1;
      const amount = rank <= 3 ? shares[rank - 1]! : "0.00";
      await tx.update(leaderboardEntries).set({ rank, prize: amount, updatedAt: new Date() }).where(eq(leaderboardEntries.id, entry.id));
      if (rank > 3 || Number(amount) <= 0) continue;
      const [user] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, entry.telegramId)).for("update").limit(1);
      if (!user) continue;
      const [payout] = await tx.insert(leaderboardPayouts).values({ sessionId: session.id, telegramId: entry.telegramId, rank, amount })
        .onConflictDoNothing({ target: [leaderboardPayouts.sessionId, leaderboardPayouts.telegramId] }).returning();
      if (!payout) continue;
      const balanceBefore = user.winWalletBalance;
      const balanceAfter = (Number(balanceBefore) + Number(amount)).toFixed(2);
      await tx.update(telegramUsers).set({ winWalletBalance: balanceAfter, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, entry.telegramId));
      await tx.insert(walletTransactions).values({
        telegramId: entry.telegramId,
        type: "leaderboard_payout",
        wallet: "win",
        amount,
        balanceBefore,
        balanceAfter,
        status: "completed",
        reference: `leaderboard:${session.id}:${entry.telegramId}`,
        metadata: { sessionId: session.id, rank, payoutId: payout.id },
      });
      winners.push({ telegramId: entry.telegramId, name: [user.firstName, user.lastName].filter(Boolean).join(" "), rank, score: entry.score, amount, chatId: user.chatId });
    }
    await tx.update(leaderboardSessions).set({ status: "completed", completedAt: new Date() }).where(eq(leaderboardSessions.id, session.id));
  } else {
    const projectedShares = splitLeaderboardPrize(updatedSession.prizePool, allocation.leaderboardPrizePercentages);
    for (const [index, entry] of entries.entries()) {
      await tx.update(leaderboardEntries).set({ rank: index + 1, prize: index < 3 ? projectedShares[index]! : "0.00", updatedAt: new Date() }).where(eq(leaderboardEntries.id, entry.id));
    }
  }
  await tx.update(bingoRounds).set({ leaderboardCounted: true }).where(eq(bingoRounds.id, roundId));
  return { sessionId: session.id, roundCount: updatedSession.roundCount, isFinalRound, prizePool: updatedSession.prizePool, winners };
}

export async function getLeaderboardSnapshot(telegramId?: number) {
  const session = await db.query.leaderboardSessions.findFirst({ where: eq(leaderboardSessions.status, "active"), orderBy: [desc(leaderboardSessions.id)] })
    ?? await db.query.leaderboardSessions.findFirst({ orderBy: [desc(leaderboardSessions.id)] });
  if (!session) return { session: null, entries: [], me: null };
  const entries = await db.select({ telegramId: leaderboardEntries.telegramId, score: leaderboardEntries.score, rank: leaderboardEntries.rank, prize: leaderboardEntries.prize, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName })
    .from(leaderboardEntries).innerJoin(telegramUsers, eq(telegramUsers.telegramId, leaderboardEntries.telegramId))
    .where(eq(leaderboardEntries.sessionId, session.id)).orderBy(asc(leaderboardEntries.rank), desc(leaderboardEntries.score), asc(leaderboardEntries.id));
  const mapped = entries.map((entry, index) => ({ telegramId: entry.telegramId, name: [entry.firstName, entry.lastName].filter(Boolean).join(" "), score: entry.score, rank: entry.rank ?? index + 1, prize: entry.prize }));
  return {
    session: { id: session.id, status: session.status, roundCount: session.roundCount, roundLimit: ROUND_LIMIT, prizePool: session.prizePool, completedAt: session.completedAt },
    entries: mapped.slice(0, 50),
    me: telegramId ? mapped.find((entry) => entry.telegramId === telegramId) ?? null : null,
  };
}
