// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./telegram-users";
export * from "./bingo";
export * from "./wallet-transactions";
export * from "./deposit-requests";
export * from "./withdrawal-requests";
export * from "./bingo-payouts";
export * from "./leaderboard";
export * from "./app-wallet-transactions";
export * from "./telegram-referrals";
export * from "./game-settings";
export * from "./promo-codes";
export * from "./referral-agents";
