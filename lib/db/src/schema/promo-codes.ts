import { bigint, boolean, integer, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const promoCodes = pgTable("promo_codes", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 64 }).notNull(),
  rewardAmount: numeric("reward_amount", { precision: 12, scale: 2 }).notNull(),
  maxRedemptions: integer("max_redemptions"),
  redemptionCount: integer("redemption_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdByTelegramId: bigint("created_by_telegram_id", { mode: "number" }).references(() => telegramUsers.telegramId),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ codeUnique: uniqueIndex("promo_codes_code_idx").on(table.code) }));

export const promoRedemptions = pgTable("promo_redemptions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  promoCodeId: bigint("promo_code_id", { mode: "number" }).notNull().references(() => promoCodes.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId, { onDelete: "cascade" }),
  rewardAmount: numeric("reward_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ promoUserUnique: uniqueIndex("promo_redemptions_code_user_idx").on(table.promoCodeId, table.telegramId) }));

export type PromoCode = typeof promoCodes.$inferSelect;
export type PromoRedemption = typeof promoRedemptions.$inferSelect;
