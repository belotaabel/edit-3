import { bigint, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const telegramUsers = pgTable("telegram_users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  username: text("username"),
  phoneNumber: text("phone_number").notNull(),
  playWalletBalance: numeric("play_wallet_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  // Bonus funds are kept separate from deposited/play funds and expire after inactivity.
  bonusWalletBalance: numeric("bonus_wallet_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  bonusWalletLastPlayedAt: timestamp("bonus_wallet_last_played_at", { withTimezone: true }),
  winWalletBalance: numeric("win_wallet_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  agentWalletBalance: numeric("agent_wallet_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  languageCode: text("language_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TelegramUser = typeof telegramUsers.$inferSelect;
export type NewTelegramUser = typeof telegramUsers.$inferInsert;
