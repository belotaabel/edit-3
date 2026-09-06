import { and, eq } from "drizzle-orm";
import {
  bingoPayouts,
  db,
  telegramUsers,
  walletTransactions,
} from "@workspace/db";

type PayoutTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type BingoPayoutInput = {
  roundId: number;
  cardId: number;
  telegramId: number;
  amount: string;
};

async function awardBingoPayoutInTransaction(tx: PayoutTransaction, input: BingoPayoutInput) {
  const reference = `bingo:${input.roundId}:${input.telegramId}:${input.cardId}`;
  const [existing] = await tx.select().from(bingoPayouts).where(
    and(
      eq(bingoPayouts.roundId, input.roundId),
      eq(bingoPayouts.telegramId, input.telegramId),
      eq(bingoPayouts.cardId, input.cardId),
    ),
  ).limit(1);
  if (existing) return { payout: existing, credited: false };

  const [user] = await tx.select().from(telegramUsers)
    .where(eq(telegramUsers.telegramId, input.telegramId))
    .for("update").limit(1);
  if (!user) throw new Error("Bingo winner is not registered");

  const balanceBefore = user.winWalletBalance;
  const balanceAfter = (Number(balanceBefore) + Number(input.amount)).toFixed(2);
  const [payout] = await tx.insert(bingoPayouts).values({
    roundId: input.roundId,
    cardId: input.cardId,
    telegramId: input.telegramId,
    amount: input.amount,
    status: "completed",
  }).onConflictDoNothing({ target: [bingoPayouts.roundId, bingoPayouts.telegramId, bingoPayouts.cardId] }).returning();
  if (!payout) {
    const [existingPayout] = await tx.select().from(bingoPayouts).where(
      and(eq(bingoPayouts.roundId, input.roundId), eq(bingoPayouts.telegramId, input.telegramId), eq(bingoPayouts.cardId, input.cardId)),
    ).limit(1);
    if (!existingPayout) throw new Error("Bingo payout was not created");
    return { payout: existingPayout, credited: false };
  }

  await tx.update(telegramUsers).set({ winWalletBalance: balanceAfter, updatedAt: new Date() })
    .where(eq(telegramUsers.telegramId, input.telegramId));
  await tx.insert(walletTransactions).values({
    telegramId: input.telegramId,
    type: "bingo_payout",
    wallet: "win",
    amount: input.amount,
    balanceBefore,
    balanceAfter,
    status: "completed",
    reference,
    metadata: { roundId: input.roundId, cardId: input.cardId, payoutId: payout.id },
  });
  return { payout, credited: true };
}

export async function awardBingoPayout(input: BingoPayoutInput, tx?: PayoutTransaction) {
  if (tx) return awardBingoPayoutInTransaction(tx, input);
  return db.transaction((transaction) => awardBingoPayoutInTransaction(transaction, input));
}
