import { and, asc, eq, inArray } from "drizzle-orm";
import { db, bingoCalls, bingoPayouts, bingoPlayerCards, bingoRounds, telegramUsers, walletTransactions } from "@workspace/db";
import { Router, type IRouter, type Request } from "express";
import { isValidTelegramInitData, parseTelegramUser, telegramRequest } from "./telegram";
import { logger } from "../lib/logger";
import { awardBingoPayout } from "../lib/payout";
import { getGameSettings, type EditableGameSettings } from "../lib/game-settings";
import { finalizeLeaderboardRound, recordLeaderboardScore, type LeaderboardWinner } from "../lib/leaderboard";
import { resetInactiveBonusWallets, splitCardStake } from "../lib/wallet";

const router: IRouter = Router();
const CARD_COUNT = 500;
const CARD_STAKE = 10;
const SELECTION_DURATION_MS = 60_000;

type BingoWinner = { telegramId: number; name: string; cardNumber: number; payout: string; status: string };
type ResolveResult = { winners: BingoWinner[]; leaderboard?: Awaited<ReturnType<typeof finalizeLeaderboardRound>> };

type BingoRoundSnapshot = {
  id: number;
  status: string;
  startedAt: Date;
  selectionEndsAt: Date | null;
  calls: Array<{ number: number; position: number; calledAt: Date }>;
  takenCardNumbers: number[];
  pot: string;
  maxCardsPerPlayer: number;
  uniquePlayers: number;
  winner?: BingoWinner;
  winners: BingoWinner[];
};

const roundUpdateListeners = new Set<(snapshot: BingoRoundSnapshot) => void>();

export function subscribeToBingoRoundUpdates(listener: (snapshot: BingoRoundSnapshot) => void) {
  roundUpdateListeners.add(listener);
  return () => roundUpdateListeners.delete(listener);
}

export async function getBingoRoundSnapshot(roundId?: number): Promise<BingoRoundSnapshot> {
  const round = roundId
    ? await db.query.bingoRounds.findFirst({ where: eq(bingoRounds.id, roundId) })
    : await ensureActiveBingoRound();
  if (!round) throw new Error("Bingo round not found");
  const [calls, cards] = await Promise.all([
    db.query.bingoCalls.findMany({ where: eq(bingoCalls.roundId, round.id), orderBy: [asc(bingoCalls.position)] }),
    db.query.bingoPlayerCards.findMany({ where: eq(bingoPlayerCards.roundId, round.id), columns: { cardNumber: true, telegramId: true } }),
  ]);
  const winners = await getStoredRoundWinners(round.id);
  const settings = await getGameSettings();
  return { id: round.id, status: round.status, startedAt: round.startedAt, selectionEndsAt: round.selectionEndsAt, calls, takenCardNumbers: cards.map((card) => card.cardNumber), pot: getBingoPayoutAmount(cards.length, settings), maxCardsPerPlayer: Number(settings.maxCardsPerPlayer), uniquePlayers: new Set(cards.map((card) => card.telegramId)).size, winner: winners[0], winners };
}

export async function publishBingoRoundUpdate(roundId?: number) {
  const snapshot = await getBingoRoundSnapshot(roundId);
  roundUpdateListeners.forEach((listener) => listener(snapshot));
  return snapshot;
}

function getRoundRevenue(cardCount: number, settings: EditableGameSettings) {
  const grossCents = cardCount * CARD_STAKE * 100;
  const mainPrizeCents = Math.floor(grossCents * Number(settings.mainPrizePercentage) / 100);
  const leaderboardCents = Math.floor(grossCents * Number(settings.leaderboardPoolPercentage) / 100);
  const appWalletCents = grossCents - mainPrizeCents - leaderboardCents;
  return {
    mainPrize: (mainPrizeCents / 100).toFixed(2),
    leaderboard: (leaderboardCents / 100).toFixed(2),
    appWallet: (appWalletCents / 100).toFixed(2),
    leaderboardPrizePercentages: [settings.leaderboardFirstPercentage, settings.leaderboardSecondPercentage, settings.leaderboardThirdPercentage],
    leaderboardCardPurchasePoints: settings.leaderboardCardPurchasePoints,
    leaderboardCardReleasePoints: settings.leaderboardCardReleasePoints,
    leaderboardWinPoints: settings.leaderboardWinPoints,
  };
}

function getBingoPayoutAmount(cardCount: number, settings: EditableGameSettings) {
  return getRoundRevenue(cardCount, settings).mainPrize;
}

function splitPayoutAmount(total: string, winnerCount: number) {
  const totalCents = Math.round(Number(total) * 100);
  const baseCents = Math.floor(totalCents / winnerCount);
  const remainder = totalCents % winnerCount;
  return Array.from({ length: winnerCount }, (_, index) => ((baseCents + (index < remainder ? 1 : 0)) / 100).toFixed(2));
}

function winnerCard(grid: Array<number | "star">, called: Set<number>) {
  const marked = (cell: number | "star") => cell === "star" || called.has(cell as number);
  const lines = [
    [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19], [20, 21, 22, 23, 24], [0, 5, 10, 15, 20],
    [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23],
    [4, 9, 14, 19, 24], [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
  ];
  const corners = [0, 4, 20, 24];
  return lines.some((line) => line.every((index) => marked(grid[index]!))) || corners.every((index) => marked(grid[index]!));
}

async function getStoredRoundWinners(roundId: number) {
  const payouts = await db.select({
    telegramId: bingoPayouts.telegramId,
    cardNumber: bingoPlayerCards.cardNumber,
    payout: bingoPayouts.amount,
    status: bingoPayouts.status,
    firstName: telegramUsers.firstName,
    lastName: telegramUsers.lastName,
  }).from(bingoPayouts)
    .innerJoin(bingoPlayerCards, eq(bingoPlayerCards.id, bingoPayouts.cardId))
    .innerJoin(telegramUsers, eq(telegramUsers.telegramId, bingoPayouts.telegramId))
    .where(eq(bingoPayouts.roundId, roundId))
    .orderBy(asc(bingoPayouts.id));
  return payouts.map((payout) => ({
    telegramId: payout.telegramId,
    name: [payout.firstName, payout.lastName].filter(Boolean).join(" "),
    cardNumber: payout.cardNumber,
    payout: payout.payout,
    status: payout.status,
  }));
}

async function notifyLeaderboardFinalization(winners: LeaderboardWinner[], prizePool: string, roundId: number) {
  const channelId = process.env["TELEGRAM_LEADERBOARD_CHANNEL_ID"]?.trim() || "@VenomBingo2";
  const lines = winners.length
    ? winners.map((winner) => `${winner.rank === 1 ? "🥇" : winner.rank === 2 ? "🥈" : "🥉"} ${winner.name || "Player"} — ${winner.score} pts → ${winner.amount} ETB`).join("\n")
    : "ሽልማት የሚያገኝ ተጫዋች አልተመዘገበም።";
  const message = `🔥 ጃክፖቱ ተበላ!\n\nበዙር #${roundId} - ${prizePool} ብር ለታደሉት ተጫዋቾቻችን ተከፍሏል!\n\nVENOM BINGO 🔥🔥\n\n👇 ዕድለኞቹ:\n${lines}\n\n⚡ ቀጣዩ ዙር አሁን ተጀምሯል!`;
  const configuredPlayUrl = (process.env["TELEGRAM_WEB_APP_URL"] ?? process.env["RENDER_EXTERNAL_URL"])?.trim();
  const playUrl = configuredPlayUrl ? (configuredPlayUrl.startsWith("http") ? configuredPlayUrl : `https://${configuredPlayUrl}`) : undefined;
  const channelReplyMarkup = playUrl ? { inline_keyboard: [[{ text: "🎮 PLAY NOW", url: playUrl }]] } : undefined;
  const userReplyMarkup = playUrl ? { inline_keyboard: [[{ text: "🎮 PLAY NOW", web_app: { url: playUrl } }]] } : undefined;
  if (channelId) {
    try {
      await telegramRequest("sendMessage", { chat_id: channelId, text: message, ...(channelReplyMarkup ? { reply_markup: channelReplyMarkup } : {}) });
    } catch (error) {
      logger.error({ err: error, channelId }, "Leaderboard channel notification failed");
    }
  }
  const users = await db.select({ chatId: telegramUsers.chatId }).from(telegramUsers);
  for (const { chatId } of users) {
    try {
      await telegramRequest("sendMessage", { chat_id: chatId, text: message, ...(userReplyMarkup ? { reply_markup: userReplyMarkup } : {}) });
    } catch (error) {
      logger.error({ err: error, chatId }, "Leaderboard broadcast notification failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function resolveRoundWinners(roundId: number): Promise<ResolveResult> {
  const settings = await getGameSettings();
  const result = await db.transaction(async (tx) => {
    const [round] = await tx.select().from(bingoRounds).where(eq(bingoRounds.id, roundId)).for("update").limit(1);
    if (!round) return { winners: [] };
    const [calls, cards, storedPayouts] = await Promise.all([
      tx.select({ number: bingoCalls.number }).from(bingoCalls).where(eq(bingoCalls.roundId, roundId)),
      tx.select({ id: bingoPlayerCards.id, telegramId: bingoPlayerCards.telegramId, cardNumber: bingoPlayerCards.cardNumber, grid: bingoPlayerCards.grid }).from(bingoPlayerCards).where(eq(bingoPlayerCards.roundId, roundId)),
      tx.select({
        telegramId: bingoPayouts.telegramId,
        cardNumber: bingoPlayerCards.cardNumber,
        payout: bingoPayouts.amount,
        status: bingoPayouts.status,
        firstName: telegramUsers.firstName,
        lastName: telegramUsers.lastName,
      }).from(bingoPayouts)
        .innerJoin(bingoPlayerCards, eq(bingoPlayerCards.id, bingoPayouts.cardId))
        .innerJoin(telegramUsers, eq(telegramUsers.telegramId, bingoPayouts.telegramId))
        .where(eq(bingoPayouts.roundId, roundId))
        .orderBy(asc(bingoPayouts.id)),
    ]);
    if (storedPayouts.length) {
      const winners = storedPayouts.map((payout) => ({
        telegramId: payout.telegramId,
        name: [payout.firstName, payout.lastName].filter(Boolean).join(" "),
        cardNumber: payout.cardNumber,
        payout: payout.payout,
        status: payout.status,
      }));
      const leaderboard = await finalizeLeaderboardRound(tx, roundId, winners.map((winner) => winner.telegramId), getRoundRevenue(cards.length, settings));
      return { winners, leaderboard };
    }
    if (!["playing", "active"].includes(round.status)) {
      const leaderboard = await finalizeLeaderboardRound(tx, roundId, [], getRoundRevenue(cards.length, settings));
      return { winners: [], leaderboard };
    }
    const called = new Set(calls.map((call) => call.number));
    const winningCards = cards.filter((card) => winnerCard(card.grid, called)).sort((left, right) => left.id - right.id);
    const winningPlayers = [...new Map(winningCards.map((card) => [card.telegramId, card])).values()];
    if (!winningPlayers.length) {
      const leaderboard = await finalizeLeaderboardRound(tx, roundId, [], getRoundRevenue(cards.length, settings));
      return { winners: [], leaderboard };
    }
    const payoutAmounts = splitPayoutAmount(getBingoPayoutAmount(cards.length, settings), winningPlayers.length);
    const winners: BingoWinner[] = [];
    for (const [index, card] of winningPlayers.entries()) {
      const result = await awardBingoPayout({ roundId, cardId: card.id, telegramId: card.telegramId, amount: payoutAmounts[index]! }, tx);
      const [player] = await tx.select({ firstName: telegramUsers.firstName, lastName: telegramUsers.lastName }).from(telegramUsers).where(eq(telegramUsers.telegramId, card.telegramId)).limit(1);
      winners.push({ telegramId: card.telegramId, name: [player?.firstName, player?.lastName].filter(Boolean).join(" "), cardNumber: card.cardNumber, payout: result.payout.amount, status: result.payout.status });
    }
    const leaderboard = await finalizeLeaderboardRound(tx, roundId, winningPlayers.map((card) => card.telegramId), getRoundRevenue(cards.length, settings));
    await tx.update(bingoRounds).set({ status: "completed", completedAt: new Date() }).where(and(eq(bingoRounds.id, roundId), inArray(bingoRounds.status, ["playing", "active"])));
    return { winners, leaderboard };
  });
  if (result.leaderboard?.isFinalRound) void notifyLeaderboardFinalization(result.leaderboard.winners, result.leaderboard.prizePool, roundId);
  return result;
}

function shuffledNumbers() {
  const values = Array.from({ length: 75 }, (_, index) => index + 1);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function buildCard(cardNumber: number): Array<number | "star"> {
  let seed = cardNumber * 9301 + 49297;
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const columns: number[][] = [];
  for (let column = 0; column < 5; column += 1) {
    const pool = Array.from({ length: 15 }, (_, index) => column * 15 + index + 1);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    columns.push(pool.slice(0, 5));
  }
  return Array.from({ length: 25 }, (_, index) => index === 12 ? "star" : columns[index % 5][Math.floor(index / 5)]);
}

export async function ensureActiveBingoRound() {
  const active = await db.query.bingoRounds.findFirst({ where: inArray(bingoRounds.status, ["selecting", "playing", "active"]), orderBy: [asc(bingoRounds.id)] });
  if (active?.status === "active") {
    const [existingCall] = await db.select({ id: bingoCalls.id }).from(bingoCalls).where(eq(bingoCalls.roundId, active.id)).limit(1);
    const [normalized] = await db.update(bingoRounds).set(existingCall ? { status: "playing", selectionEndsAt: null } : { status: "selecting", selectionEndsAt: new Date(Date.now() + SELECTION_DURATION_MS) }).where(and(eq(bingoRounds.id, active.id), eq(bingoRounds.status, "active"))).returning();
    const result = normalized ?? active;
    logger.info({ roundId: result.id, status: result.status, legacy: true }, "Bingo round normalized");
    return result;
  }
  if (active?.status === "selecting" && !active.selectionEndsAt) {
    const [normalized] = await db.update(bingoRounds).set({ selectionEndsAt: new Date(Date.now() + SELECTION_DURATION_MS) }).where(and(eq(bingoRounds.id, active.id), eq(bingoRounds.status, "selecting"))).returning();
    const result = normalized ?? active;
    logger.info({ roundId: result.id, status: result.status }, "Bingo round selection deadline initialized");
    return result;
  }
  if (active) return active;
  const [created] = await db.insert(bingoRounds).values({ status: "selecting", selectionEndsAt: new Date(Date.now() + SELECTION_DURATION_MS) }).returning();
  if (!created) throw new Error("Could not create Bingo round");
  logger.info({ roundId: created.id, status: created.status, selectionEndsAt: created.selectionEndsAt }, "Bingo round created");
  return created;
}

export async function advanceBingoRound() {
  let round = await ensureActiveBingoRound();
  if (round.status === "selecting" && round.selectionEndsAt && round.selectionEndsAt.getTime() <= Date.now()) {
    const nextStatus = await db.transaction(async (tx) => {
      const [lockedRound] = await tx.select().from(bingoRounds).where(eq(bingoRounds.id, round.id)).for("update").limit(1);
      if (!lockedRound || lockedRound.status !== "selecting" || !lockedRound.selectionEndsAt || lockedRound.selectionEndsAt.getTime() > Date.now()) return lockedRound?.status;
      const cards = await tx.select({ telegramId: bingoPlayerCards.telegramId }).from(bingoPlayerCards).where(eq(bingoPlayerCards.roundId, round.id));
      const uniquePlayers = new Set(cards.map((card) => card.telegramId));
      if (uniquePlayers.size === 0) {
        await tx.update(bingoRounds).set({ status: "completed", completedAt: new Date() }).where(eq(bingoRounds.id, round.id));
        return "completed";
      }
      await tx.update(bingoRounds).set({ status: "playing", startedAt: new Date(), selectionEndsAt: null }).where(eq(bingoRounds.id, round.id));
      return "playing";
    });
    logger.info({ roundId: round.id, nextStatus }, "Bingo selection round transitioned");
    if (nextStatus === "completed") return ensureActiveBingoRound();
    if (nextStatus === "playing") round = { ...round, status: "playing" };
  }
  if (round.status === "selecting") return round;
  const cards = await db.select({ id: bingoPlayerCards.id, telegramId: bingoPlayerCards.telegramId }).from(bingoPlayerCards).where(eq(bingoPlayerCards.roundId, round.id));
  if (cards.length < 1) {
    await db.update(bingoRounds).set({ status: "completed", completedAt: new Date() }).where(and(eq(bingoRounds.id, round.id), eq(bingoRounds.status, "playing")));
    logger.info({ roundId: round.id, cardCount: cards.length }, "Bingo round closed below minimum card count");
    return ensureActiveBingoRound();
  }
  logger.info({ roundId: round.id, playerCount: new Set(cards.map((card) => card.telegramId)).size, cardCount: cards.length }, "Bingo players checked before call");
  const calls = await db.query.bingoCalls.findMany({ where: eq(bingoCalls.roundId, round.id), orderBy: [asc(bingoCalls.position)] });
  if (calls.length >= 75) {
    const result = await resolveRoundWinners(round.id);
    if (result.winners.length) return { ...round, status: 'completed', selectionEndsAt: null };
    await db.update(bingoRounds).set({ status: 'completed', completedAt: new Date() }).where(and(eq(bingoRounds.id, round.id), eq(bingoRounds.status, 'playing')));
    return { ...round, status: 'completed', selectionEndsAt: null };
  }
  const latestCall = calls.at(-1);
  if (latestCall && Date.now() - latestCall.calledAt.getTime() < 2_200) return round;
  const remaining = shuffledNumbers().filter((number) => !calls.some((call) => call.number === number));
  await db.insert(bingoCalls).values({ roundId: round.id, number: remaining[0]!, position: calls.length }).onConflictDoNothing({ target: [bingoCalls.roundId, bingoCalls.position] });
  logger.info({ roundId: round.id, callNumber: remaining[0], callPosition: calls.length + 1 }, "Bingo number called");
  const result = await resolveRoundWinners(round.id);
  return result.winners.length ? { ...round, status: 'completed', selectionEndsAt: null } : round;
}

async function authenticatedUser(req: Request) {
  const initData = req.header("x-telegram-init-data") ?? req.header("authorization")?.replace(/^tma\s+/i, "");
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  if (!initData || !token || !isValidTelegramInitData(initData, token)) return undefined;
  const user = parseTelegramUser(initData);
  if (!user) return undefined;
  return db.query.telegramUsers.findFirst({ where: eq(telegramUsers.telegramId, user.id) });
}

router.get("/bingo/round", async (req, res) => {
  try {
    const requestedRoundId = Number(req.query.roundId);
    const round = Number.isInteger(requestedRoundId) && requestedRoundId > 0
      ? await db.query.bingoRounds.findFirst({ where: eq(bingoRounds.id, requestedRoundId) })
      : await ensureActiveBingoRound();
    if (!round) { res.status(404).json({ error: "Bingo round not found" }); return; }
    res.json(await getBingoRoundSnapshot(round.id));
  } catch (error) {
    logger.error({ err: error }, "Failed to load Bingo round");
    res.status(503).json({ error: "Bingo round unavailable" });
  }
});

router.get("/bingo/cards", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Valid Telegram authentication is required" }); return; }
  const requestedRoundId = Number(req.query.roundId);
  const round = Number.isInteger(requestedRoundId) && requestedRoundId > 0
    ? await db.query.bingoRounds.findFirst({ where: eq(bingoRounds.id, requestedRoundId) })
    : await ensureActiveBingoRound();
  if (!round) { res.status(404).json({ error: "Bingo round not found" }); return; }
  const cards = await db.query.bingoPlayerCards.findMany({ where: and(eq(bingoPlayerCards.roundId, round.id), eq(bingoPlayerCards.telegramId, user.telegramId)), orderBy: [asc(bingoPlayerCards.cardNumber)] });
  res.json({ roundId: round.id, cards });
});

router.post("/bingo/cards/reserve", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Valid Telegram authentication is required" }); return; }
  const settings = await getGameSettings();
  const maxCardsPerPlayer = Number(settings.maxCardsPerPlayer);
  const cardNumber = req.body?.cardNumber;
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > CARD_COUNT) { res.status(400).json({ error: "Choose a valid card" }); return; }
  const round = await ensureActiveBingoRound();
  try {
    const result = await db.transaction(async (tx) => {
      const [lockedRound] = await tx.select().from(bingoRounds).where(eq(bingoRounds.id, round.id)).for("update").limit(1);
      const [lockedUser] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, user.telegramId)).for("update").limit(1);
      if (!lockedRound || !lockedUser || lockedRound.status !== "selecting" || !lockedRound.selectionEndsAt || lockedRound.selectionEndsAt.getTime() <= Date.now() + 5_000) throw Object.assign(new Error("Card selection is closed"), { status: 409 });
      const reference = `bingo_reservation:${lockedRound.id}:${user.telegramId}:${cardNumber}`;
      const [existingLedger] = await tx.select().from(walletTransactions).where(eq(walletTransactions.reference, reference)).limit(1);
      if (existingLedger) return { reserved: true, scoreDelta: 0, wallet: (existingLedger.metadata as { wallet?: string } | null)?.wallet ?? "play", playWalletBalance: lockedUser.playWalletBalance, winWalletBalance: lockedUser.winWalletBalance };
      const [existingCard] = await tx.select().from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.cardNumber, cardNumber))).for("update").limit(1);
      if (existingCard) throw Object.assign(new Error("This card is already taken"), { status: 409 });
      const currentCards = await tx.select({ id: bingoPlayerCards.id }).from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.telegramId, user.telegramId))).for("update");
      if (currentCards.length >= maxCardsPerPlayer) throw Object.assign(new Error(`You can select at most ${maxCardsPerPlayer} cards`), { status: 400 });
      const split = splitCardStake(lockedUser.bonusWalletBalance, lockedUser.playWalletBalance, lockedUser.winWalletBalance, CARD_STAKE);
      if (!split) throw Object.assign(new Error("Insufficient balance in bonus, play, and win wallets"), { status: 402 });
      const bonusAfter = (Number(lockedUser.bonusWalletBalance) - split.fromBonus).toFixed(2);
      const playAfter = (Number(lockedUser.playWalletBalance) - split.fromPlay).toFixed(2);
      const winAfter = (Number(lockedUser.winWalletBalance) - split.fromWin).toFixed(2);
      await tx.insert(bingoPlayerCards).values({ roundId: lockedRound.id, telegramId: user.telegramId, cardNumber, grid: buildCard(cardNumber) });
      await tx.update(telegramUsers).set({ bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter, bonusWalletLastPlayedAt: new Date(), updatedAt: new Date() }).where(eq(telegramUsers.telegramId, user.telegramId));
      await tx.insert(walletTransactions).values({ telegramId: user.telegramId, type: "adjustment", wallet: split.fromBonus > 0 ? "bonus" : split.fromPlay > 0 ? "cash_play" : "win", amount: (-CARD_STAKE).toFixed(2), balanceBefore: CARD_STAKE.toFixed(2), balanceAfter: "0.00", status: "completed", reference, metadata: { roundId: lockedRound.id, cardNumber, stake: CARD_STAKE, bonusAmount: split.fromBonus, playAmount: split.fromPlay, winAmount: split.fromWin } });
      await recordLeaderboardScore(tx, lockedRound.id, user.telegramId, "card_purchase", Number(settings.leaderboardCardPurchasePoints), `leaderboard:purchase:${lockedRound.id}:${user.telegramId}:${cardNumber}`);
      return { reserved: true, scoreDelta: Number(settings.leaderboardCardPurchasePoints), wallet: split.fromBonus > 0 ? "bonus" : split.fromPlay > 0 ? "play" : "win", bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter };
    });
    logger.info({ roundId: round.id, telegramId: user.telegramId, cardNumber, wallet: result.wallet }, "Bingo card reserved");
    await publishBingoRoundUpdate();
    res.status(201).json({ roundId: round.id, ...result });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) { res.status(status).json({ error: (error as Error).message }); return; }
    logger.error({ err: error }, "Failed to reserve Bingo card");
    res.status(503).json({ error: "Card reservation unavailable" });
  }
});

router.post("/bingo/cards/release", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Valid Telegram authentication is required" }); return; }
  const settings = await getGameSettings();
  const cardNumber = req.body?.cardNumber;
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > CARD_COUNT) { res.status(400).json({ error: "Choose a valid card" }); return; }
  const round = await ensureActiveBingoRound();
  try {
    const result = await db.transaction(async (tx) => {
      const [lockedRound] = await tx.select().from(bingoRounds).where(eq(bingoRounds.id, round.id)).for("update").limit(1);
      const [lockedUser] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, user.telegramId)).for("update").limit(1);
      if (!lockedRound || !lockedUser || lockedRound.status !== "selecting" || !lockedRound.selectionEndsAt || lockedRound.selectionEndsAt.getTime() <= Date.now() + 5_000) throw Object.assign(new Error("Card selection is closed"), { status: 409 });
      const [card] = await tx.select().from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.telegramId, user.telegramId), eq(bingoPlayerCards.cardNumber, cardNumber))).for("update").limit(1);
      if (!card) return { released: false, scoreDelta: 0 };
      const reference = `bingo_reservation:${lockedRound.id}:${user.telegramId}:${cardNumber}`;
      const [ledger] = await tx.select().from(walletTransactions).where(eq(walletTransactions.reference, reference)).limit(1);
      const metadata = ledger?.metadata as { bonusAmount?: number; playAmount?: number; winAmount?: number } | null;
      const bonusAmount = Number(metadata?.bonusAmount ?? 0);
      const playAmount = Number(metadata?.playAmount ?? 0);
      const winAmount = Number(metadata?.winAmount ?? 0);
      const bonusAfter = (Number(lockedUser.bonusWalletBalance) + bonusAmount).toFixed(2);
      const playAfter = (Number(lockedUser.playWalletBalance) + playAmount).toFixed(2);
      const winAfter = (Number(lockedUser.winWalletBalance) + winAmount).toFixed(2);
      await tx.delete(bingoPlayerCards).where(eq(bingoPlayerCards.id, card.id));
      await tx.update(telegramUsers).set({ bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, user.telegramId));
      await tx.insert(walletTransactions).values({ telegramId: user.telegramId, type: "adjustment", wallet: bonusAmount > 0 ? "bonus" : "cash_play", amount: CARD_STAKE.toFixed(2), balanceBefore: "0.00", balanceAfter: CARD_STAKE.toFixed(2), status: "completed", reference: `bingo_release:${lockedRound.id}:${user.telegramId}:${cardNumber}`, metadata: { roundId: lockedRound.id, cardNumber, stake: CARD_STAKE, bonusAmount, playAmount, winAmount, source: reference } });
      await recordLeaderboardScore(tx, lockedRound.id, user.telegramId, "card_release", Number(settings.leaderboardCardReleasePoints), `leaderboard:release:${lockedRound.id}:${user.telegramId}:${cardNumber}`);
      return { released: true, scoreDelta: Number(settings.leaderboardCardReleasePoints), wallet: bonusAmount > 0 ? "bonus" : playAmount > 0 ? "play" : "win", bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter };
    });
    logger.info({ roundId: round.id, telegramId: user.telegramId, cardNumber, wallet: result.wallet, released: result.released }, "Bingo card release processed");
    await publishBingoRoundUpdate();
    res.json({ roundId: round.id, ...result });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) { res.status(status).json({ error: (error as Error).message }); return; }
    logger.error({ err: error }, "Failed to release Bingo card");
    res.status(503).json({ error: "Card release unavailable" });
  }
});

router.post("/bingo/claim", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Valid Telegram authentication is required" }); return; }
  const roundId = req.body?.roundId;
  const cardNumber = req.body?.cardNumber;
  if (!Number.isInteger(roundId) || roundId < 1 || !Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > CARD_COUNT) {
    res.status(400).json({ error: "A valid round and card are required" }); return;
  }
  try {
    const result = await resolveRoundWinners(roundId);
    const winner = result.winners.find((item) => item.telegramId === user.telegramId && item.cardNumber === cardNumber);
    if (!winner) { res.status(409).json({ error: "This card does not have a winning pattern" }); return; }
    await publishBingoRoundUpdate(roundId);
    res.json({ winner, winners: result.winners });
  } catch (error) {
    logger.error({ err: error, roundId, telegramId: user.telegramId, cardNumber }, "Failed to claim Bingo win");
    res.status(503).json({ error: "Bingo claim unavailable" });
  }
});

router.post("/bingo/cards", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Valid Telegram authentication is required" }); return; }
  const settings = await getGameSettings();
  const maxCardsPerPlayer = Number(settings.maxCardsPerPlayer);
  const cardNumbers = req.body?.cardNumbers;
  if (!Array.isArray(cardNumbers) || cardNumbers.length < 1 || cardNumbers.length > maxCardsPerPlayer || new Set(cardNumbers).size !== cardNumbers.length || cardNumbers.some((value) => !Number.isInteger(value) || value < 1 || value > CARD_COUNT)) {
    res.status(400).json({ error: `Choose between 1 and ${maxCardsPerPlayer} unique cards from 1 to ${CARD_COUNT}` }); return;
  }
  let round = await ensureActiveBingoRound();
  if (round.status === "selecting" && round.selectionEndsAt && round.selectionEndsAt.getTime() <= Date.now()) {
    await advanceBingoRound();
    round = await ensureActiveBingoRound();
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [lockedRound] = await tx.select().from(bingoRounds).where(eq(bingoRounds.id, round.id)).for("update").limit(1);
      const [lockedUser] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, user.telegramId)).for("update").limit(1);
      if (!lockedUser || !lockedRound || lockedRound.status !== "selecting" || !lockedRound.selectionEndsAt || lockedRound.selectionEndsAt.getTime() <= Date.now() + 5_000) throw Object.assign(new Error("Card selection is closed"), { status: 409 });
      const existing = await tx.select({ cardNumber: bingoPlayerCards.cardNumber, telegramId: bingoPlayerCards.telegramId }).from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), inArray(bingoPlayerCards.cardNumber, cardNumbers))).for("update");
      const takenByOther = existing.find((card) => card.telegramId !== user.telegramId);
      if (takenByOther) throw Object.assign(new Error(`Card ${takenByOther.cardNumber} is already taken`), { status: 409 });
      const current = await tx.select({ cardNumber: bingoPlayerCards.cardNumber }).from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.telegramId, user.telegramId))).for("update");
      const missing = cardNumbers.filter((number) => !current.some((card) => card.cardNumber === number));
      if (current.length + missing.length > maxCardsPerPlayer) throw Object.assign(new Error(`You can select at most ${maxCardsPerPlayer} cards`), { status: 400 });
      const reference = `bingo_purchase:${lockedRound.id}:${user.telegramId}:${missing.slice().sort((a, b) => a - b).join(",")}`;
      const [ledger] = await tx.select().from(walletTransactions).where(eq(walletTransactions.reference, reference)).limit(1);
      if (ledger) {
        const cards = await tx.select().from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.telegramId, user.telegramId))).orderBy(asc(bingoPlayerCards.cardNumber));
        return { cards, playWalletBalance: lockedUser.playWalletBalance, winWalletBalance: lockedUser.winWalletBalance };
      }
      const total = missing.length * CARD_STAKE;
      const split = splitCardStake(lockedUser.bonusWalletBalance, lockedUser.playWalletBalance, lockedUser.winWalletBalance, total);
      if (!split) throw Object.assign(new Error("Insufficient balance in bonus, play, and win wallets"), { status: 402 });
      if (missing.length) await tx.insert(bingoPlayerCards).values(missing.map((cardNumber) => ({ roundId: lockedRound.id, telegramId: user.telegramId, cardNumber, grid: buildCard(cardNumber) })));
      const bonusAfter = (Number(lockedUser.bonusWalletBalance) - split.fromBonus).toFixed(2);
      const playAfter = (Number(lockedUser.playWalletBalance) - split.fromPlay).toFixed(2);
      const winAfter = (Number(lockedUser.winWalletBalance) - split.fromWin).toFixed(2);
      await tx.update(telegramUsers).set({ bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter, bonusWalletLastPlayedAt: new Date(), updatedAt: new Date() }).where(eq(telegramUsers.telegramId, user.telegramId));
      if (total > 0) {
        await tx.insert(walletTransactions).values({ telegramId: user.telegramId, type: "adjustment", wallet: split.fromBonus > 0 ? "bonus" : split.fromPlay > 0 ? "cash_play" : "win", amount: (-total).toFixed(2), balanceBefore: total.toFixed(2), balanceAfter: "0.00", status: "completed", reference, metadata: { roundId: lockedRound.id, cardNumbers: missing, stake: CARD_STAKE, bonusAmount: split.fromBonus, playAmount: split.fromPlay, winAmount: split.fromWin } });
        for (const cardNumber of missing) {
          await recordLeaderboardScore(tx, lockedRound.id, user.telegramId, "card_purchase", Number(settings.leaderboardCardPurchasePoints), `leaderboard:purchase:${lockedRound.id}:${user.telegramId}:${cardNumber}`);
        }
      }
      const cards = await tx.select().from(bingoPlayerCards).where(and(eq(bingoPlayerCards.roundId, lockedRound.id), eq(bingoPlayerCards.telegramId, user.telegramId))).orderBy(asc(bingoPlayerCards.cardNumber));
      return { cards, bonusWalletBalance: bonusAfter, playWalletBalance: playAfter, winWalletBalance: winAfter };
    });
    await publishBingoRoundUpdate();
    res.status(201).json({ roundId: round.id, cards: result.cards, bonusWalletBalance: result.bonusWalletBalance, playWalletBalance: result.playWalletBalance, winWalletBalance: result.winWalletBalance });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) { res.status(status).json({ error: (error as Error).message }); return; }
    if ((error as { code?: string }).code === "23505") { res.status(409).json({ error: "One of the selected cards was just taken" }); return; }
    logger.error({ err: error }, "Failed to purchase Bingo cards");
    res.status(503).json({ error: "Bingo card purchase unavailable" });
  }
});

export function startBingoRoundInterval() {
  const globalState = globalThis as typeof globalThis & { __bingoInterval?: ReturnType<typeof setInterval>; __bingoTickRunning?: boolean };
  if (globalState.__bingoInterval) return;
  globalState.__bingoInterval = setInterval(() => {
    if (globalState.__bingoTickRunning) return;
    globalState.__bingoTickRunning = true;
    void resetInactiveBonusWallets().catch((error) => logger.error({ err: error }, "Bonus wallet reset failed"));
    void advanceBingoRound()
      .then((progressedRound) => publishBingoRoundUpdate(progressedRound.id))
      .catch((error) => logger.error({ err: error }, "Bingo round tick failed"))
      .finally(() => { globalState.__bingoTickRunning = false; });
  }, 2_500);
  void resetInactiveBonusWallets().catch((error) => logger.error({ err: error }, "Bonus wallet reset failed"));
  void advanceBingoRound().then((progressedRound) => publishBingoRoundUpdate(progressedRound.id)).catch((error) => logger.error({ err: error }, "Bingo round startup failed"));
}

export default router;
