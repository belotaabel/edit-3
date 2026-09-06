import { db, gameSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

export type EditableGameSettings = {
  registrationBonus: string;
  inviteBonus: string;
  supportUsername: string;
  depositBonusPercentage: string;
  mainPrizePercentage: string;
  leaderboardPoolPercentage: string;
  leaderboardFirstPercentage: string;
  leaderboardSecondPercentage: string;
  leaderboardThirdPercentage: string;
  maxCardsPerPlayer: string;
  leaderboardCardPurchasePoints: string;
  leaderboardCardReleasePoints: string;
  leaderboardWinPoints: string;
};

export async function getGameSettings(): Promise<EditableGameSettings> {
  await db.insert(gameSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await db.select().from(gameSettings).where(eq(gameSettings.id, 1)).limit(1);
  if (!settings) throw new Error("Game settings are unavailable");
  return settings;
}
