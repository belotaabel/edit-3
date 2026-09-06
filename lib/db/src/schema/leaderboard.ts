import { sql } from "drizzle-orm";
import { bigint, integer, numeric, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { bingoRounds } from "./bingo";
import { telegramUsers } from "./telegram-users";

export const leaderboardSessions = pgTable("leaderboard_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  roundCount: integer("round_count").notNull().default(0),
  prizePool: numeric("prize_pool", { precision: 14, scale: 2 }).notNull().default("0.00"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({ activeSessionIndex: uniqueIndex("leaderboard_sessions_active_idx").on(table.status).where(sql`status = 'active'`) }));

export const leaderboardEntries = pgTable("leaderboard_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer("session_id").notNull().references(() => leaderboardSessions.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  rank: integer("rank"),
  prize: numeric("prize", { precision: 14, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ sessionPlayerUnique: uniqueIndex("leaderboard_entries_session_player_idx").on(table.sessionId, table.telegramId) }));

export const leaderboardScoreEvents = pgTable("leaderboard_score_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer("session_id").notNull().references(() => leaderboardSessions.id, { onDelete: "cascade" }),
  roundId: integer("round_id").notNull().references(() => bingoRounds.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 24 }).notNull(),
  points: integer("points").notNull(),
  reference: varchar("reference", { length: 180 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ referenceUnique: uniqueIndex("leaderboard_score_events_reference_idx").on(table.reference) }));

export const leaderboardPayouts = pgTable("leaderboard_payouts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer("session_id").notNull().references(() => leaderboardSessions.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  rank: integer("rank").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ sessionPlayerUnique: uniqueIndex("leaderboard_payouts_session_player_idx").on(table.sessionId, table.telegramId) }));

export type LeaderboardSession = typeof leaderboardSessions.$inferSelect;
export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type LeaderboardScoreEvent = typeof leaderboardScoreEvents.$inferSelect;
export type LeaderboardPayout = typeof leaderboardPayouts.$inferSelect;
