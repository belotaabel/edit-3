import { bigint, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const depositRequests = pgTable("deposit_requests", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 32 }).notNull(),
  transactionId: varchar("transaction_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ transactionUnique: uniqueIndex("deposit_requests_payment_transaction_idx").on(table.paymentMethod, table.transactionId) }));

export type DepositRequest = typeof depositRequests.$inferSelect;
export type NewDepositRequest = typeof depositRequests.$inferInsert;
