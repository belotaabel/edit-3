import { integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const gameSettings = pgTable("game_settings", {
  id: integer("id").primaryKey().default(1),
  registrationBonus: numeric("registration_bonus", { precision: 12, scale: 2 }).notNull().default("10.00"),
  inviteBonus: numeric("invite_bonus", { precision: 12, scale: 2 }).notNull().default("10.00"),
  supportUsername: text("support_username").notNull().default("@VenomBingoASISTANT1"),
  depositBonusPercentage: numeric("deposit_bonus_percentage", { precision: 5, scale: 2 }).notNull().default("20.00"),
  mainPrizePercentage: numeric("main_prize_percentage", { precision: 5, scale: 2 }).notNull().default("80.00"),
  leaderboardPoolPercentage: numeric("leaderboard_pool_percentage", { precision: 5, scale: 2 }).notNull().default("10.00"),
  leaderboardFirstPercentage: numeric("leaderboard_first_percentage", { precision: 5, scale: 2 }).notNull().default("50.00"),
  leaderboardSecondPercentage: numeric("leaderboard_second_percentage", { precision: 5, scale: 2 }).notNull().default("30.00"),
  leaderboardThirdPercentage: numeric("leaderboard_third_percentage", { precision: 5, scale: 2 }).notNull().default("20.00"),
  maxCardsPerPlayer: numeric("max_cards_per_player", { precision: 3, scale: 0 }).notNull().default("4"),
  leaderboardCardPurchasePoints: numeric("leaderboard_card_purchase_points", { precision: 8, scale: 2 }).notNull().default("1.00"),
  leaderboardCardReleasePoints: numeric("leaderboard_card_release_points", { precision: 8, scale: 2 }).notNull().default("-1.00"),
  leaderboardWinPoints: numeric("leaderboard_win_points", { precision: 8, scale: 2 }).notNull().default("5.00"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GameSettings = typeof gameSettings.$inferSelect;
