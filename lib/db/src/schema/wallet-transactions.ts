import { bigint, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const walletTransactionType = pgEnum("wallet_transaction_type", [
  "deposit",
  "deposit_bonus",
  "registration_bonus",
  "invite_bonus",
  "withdrawal",
  "bingo_payout",
  "leaderboard_payout",
  "adjustment",
]);
export const walletTransactionStatus = pgEnum("wallet_transaction_status", ["pending", "completed", "failed", "reversed"]);

// Existing rows default to cash_play so ambiguous historical balances are preserved.
// New bonus and win transactions should set this explicitly.
export const walletTransactionWallet = pgEnum("wallet_transaction_wallet", ["cash_play", "bonus", "win"]);

/**
 * Classification used when backfilling legacy transactions. Unknown/legacy
 * adjustments intentionally remain in cash_play to avoid changing balances.
 */
export const walletForTransactionType = {
  deposit: "cash_play",
  deposit_bonus: "bonus",
  registration_bonus: "bonus",
  invite_bonus: "bonus",
  withdrawal: "cash_play",
  bingo_payout: "win",
  leaderboard_payout: "win",
  adjustment: "cash_play",
} as const;

export const BONUS_WALLET_RESET_HOURS = 36;
export const BONUS_WALLET_RESET_BALANCE = "0.00";

export const walletTransactions = pgTable("wallet_transactions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  type: walletTransactionType("type").notNull(),
  // Defaults keep legacy/ambiguous transactions in the existing play balance.
  wallet: walletTransactionWallet("wallet").notNull().default("cash_play"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
  status: walletTransactionStatus("status").notNull().default("pending"),
  reference: text("reference"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ referenceUnique: uniqueIndex("wallet_transactions_reference_idx").on(table.reference) }));

export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type NewWalletTransaction = typeof walletTransactions.$inferInsert;
