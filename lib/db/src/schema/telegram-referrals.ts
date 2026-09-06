import { bigint, pgTable, timestamp } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const telegramReferrals = pgTable("telegram_referrals", {
  referredTelegramId: bigint("referred_telegram_id", { mode: "number" }).primaryKey(),
  inviterTelegramId: bigint("inviter_telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TelegramReferral = typeof telegramReferrals.$inferSelect;
