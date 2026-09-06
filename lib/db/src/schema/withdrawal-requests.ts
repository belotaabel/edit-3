import { bigint, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  ownerName: text("owner_name").notNull(),
  walletType: varchar("wallet_type", { length: 16 }).notNull().default("win"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ duplicateRequestUnique: uniqueIndex("withdrawal_requests_duplicate_idx").on(table.telegramId, table.amount, table.phone, table.ownerName) }));

export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequests.$inferInsert;
