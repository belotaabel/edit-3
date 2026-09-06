import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, telegramUsers, BONUS_WALLET_RESET_BALANCE, BONUS_WALLET_RESET_HOURS } from "@workspace/db";

type WalletTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function splitCardStake(
  bonusBalance: string | number,
  playBalance: string | number,
  winBalance: string | number,
  stake: number,
) {
  const bonus = Math.max(0, Number(bonusBalance));
  const play = Math.max(0, Number(playBalance));
  const win = Math.max(0, Number(winBalance));
  const fromBonus = Math.min(bonus, stake);
  const remainingAfterBonus = stake - fromBonus;
  const fromPlay = Math.min(play, remainingAfterBonus);
  const fromWin = remainingAfterBonus - fromPlay;
  if (fromWin > win) return undefined;
  return { fromBonus, fromPlay, fromWin };
}

/** Resets only expired bonus funds; cash/play and win balances are untouched. */
export async function resetInactiveBonusWallets(tx: WalletTransaction | typeof db = db, now = new Date()) {
  const cutoff = new Date(now.getTime() - BONUS_WALLET_RESET_HOURS * 60 * 60 * 1000);
  return tx.update(telegramUsers)
    .set({ bonusWalletBalance: BONUS_WALLET_RESET_BALANCE, bonusWalletLastPlayedAt: now, updatedAt: now })
    .where(or(isNull(telegramUsers.bonusWalletLastPlayedAt), lt(telegramUsers.bonusWalletLastPlayedAt, cutoff)));
}
