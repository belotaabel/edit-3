import { bigint, index, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { depositRequests } from "./deposit-requests";
import { telegramUsers } from "./telegram-users";

export const referralAgentStatus = pgEnum("referral_agent_status", ["pending", "active", "suspended"]);

export const referralAgents = pgTable("referral_agents", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  code: text("code").notNull(),
  status: referralAgentStatus("status").notNull().default("pending"),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull().default("5.00"),
  activatedByTelegramId: bigint("activated_by_telegram_id", { mode: "number" }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  telegramUnique: uniqueIndex("referral_agents_telegram_idx").on(table.telegramId),
  codeUnique: uniqueIndex("referral_agents_code_idx").on(table.code),
}));

export const referralAgentAttributions = pgTable("referral_agent_attributions", {
  referredTelegramId: bigint("referred_telegram_id", { mode: "number" }).primaryKey(),
  agentId: bigint("agent_id", { mode: "number" }).notNull().references(() => referralAgents.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ agentIndex: index("referral_agent_attributions_agent_idx").on(table.agentId) }));

export const referralAgentCommissions = pgTable("referral_agent_commissions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  agentId: bigint("agent_id", { mode: "number" }).notNull().references(() => referralAgents.id),
  referredTelegramId: bigint("referred_telegram_id", { mode: "number" }).notNull().references(() => telegramUsers.telegramId),
  depositRequestId: bigint("deposit_request_id", { mode: "number" }).notNull().references(() => depositRequests.id),
  depositAmount: numeric("deposit_amount", { precision: 14, scale: 2 }).notNull(),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: numeric("commission_amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  depositUnique: uniqueIndex("referral_agent_commissions_deposit_idx").on(table.depositRequestId),
  agentIndex: index("referral_agent_commissions_agent_idx").on(table.agentId),
}));

export type ReferralAgent = typeof referralAgents.$inferSelect;
export type ReferralAgentAttribution = typeof referralAgentAttributions.$inferSelect;
export type ReferralAgentCommission = typeof referralAgentCommissions.$inferSelect;
