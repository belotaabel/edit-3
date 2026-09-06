import { integer, numeric, pgTable, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { bingoRounds } from "./bingo";

export const appWalletTransactions = pgTable("app_wallet_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  roundId: integer("round_id").notNull().references(() => bingoRounds.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ roundUnique: uniqueIndex("app_wallet_transactions_round_idx").on(table.roundId) }));

export type AppWalletTransaction = typeof appWalletTransactions.$inferSelect;
