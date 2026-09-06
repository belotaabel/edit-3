import { bigint, integer, numeric, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";
import { bingoRounds, bingoPlayerCards } from "./bingo";

export const bingoPayouts = pgTable("bingo_payouts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  roundId: integer("round_id").notNull().references(() => bingoRounds.id, { onDelete: "cascade" }),
  cardId: integer("card_id").notNull().references(() => bingoPlayerCards.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ roundPlayerCardUnique: uniqueIndex("bingo_payouts_round_player_card_idx").on(table.roundId, table.telegramId, table.cardId) }));

export type BingoPayout = typeof bingoPayouts.$inferSelect;
export type NewBingoPayout = typeof bingoPayouts.$inferInsert;
