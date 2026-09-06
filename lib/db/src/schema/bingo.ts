import { relations } from "drizzle-orm";
import { bigint, boolean, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { telegramUsers } from "./telegram-users";

export const bingoRounds = pgTable("bingo_rounds", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  status: varchar("status", { length: 16 }).notNull().default("selecting"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  selectionEndsAt: timestamp("selection_ends_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaderboardCounted: boolean("leaderboard_counted").notNull().default(false),
});

export const bingoCalls = pgTable("bingo_calls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  roundId: integer("round_id").notNull().references(() => bingoRounds.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  position: integer("position").notNull(),
  calledAt: timestamp("called_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  roundPosition: uniqueIndex("bingo_calls_round_position_idx").on(table.roundId, table.position),
  roundNumber: uniqueIndex("bingo_calls_round_number_idx").on(table.roundId, table.number),
}));

export const bingoPlayerCards = pgTable("bingo_player_cards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  roundId: integer("round_id").notNull().references(() => bingoRounds.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId, { onDelete: "cascade" }),
  cardNumber: integer("card_number").notNull(),
  grid: jsonb("grid").$type<Array<number | "star">>().notNull(),
  selectedAt: timestamp("selected_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  playerRoundCard: uniqueIndex("bingo_player_round_card_idx").on(table.roundId, table.telegramId, table.cardNumber),
  roundCard: uniqueIndex("bingo_round_card_idx").on(table.roundId, table.cardNumber),
}));

export const bingoRoundsRelations = relations(bingoRounds, ({ many }) => ({ calls: many(bingoCalls), cards: many(bingoPlayerCards) }));
export const bingoCallsRelations = relations(bingoCalls, ({ one }) => ({ round: one(bingoRounds, { fields: [bingoCalls.roundId], references: [bingoRounds.id] }) }));
export const bingoPlayerCardsRelations = relations(bingoPlayerCards, ({ one }) => ({
  round: one(bingoRounds, { fields: [bingoPlayerCards.roundId], references: [bingoRounds.id] }),
  player: one(telegramUsers, { fields: [bingoPlayerCards.telegramId], references: [telegramUsers.telegramId] }),
}));

export type BingoRound = typeof bingoRounds.$inferSelect;
export type BingoCall = typeof bingoCalls.$inferSelect;
export type BingoPlayerCard = typeof bingoPlayerCards.$inferSelect;
