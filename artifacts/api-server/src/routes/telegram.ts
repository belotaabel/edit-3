import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import {
  appWalletTransactions,
  bingoCalls,
  bingoPlayerCards,
  bingoRounds,
  db,
  depositRequests,
  gameSettings,
  promoCodes,
  promoRedemptions,
  referralAgentAttributions,
  referralAgentCommissions,
  referralAgents,
  telegramReferrals,
  telegramUsers,
  walletTransactions,
  withdrawalRequests,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import { getGameSettings, type EditableGameSettings } from "../lib/game-settings";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const AUTH_DATA_MAX_AGE_SECONDS = 86_400;

type RequiredChannel = { username: string; title: string; url: string };

function getRequiredChannels(): RequiredChannel[] {
  return "@VenomBingo|Venom Bingo|https://t.me/VenomBingo,@VenomBingo2|Venom Bingo 2|https://t.me/VenomBingo2".split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [username, title = username, url = `https://t.me/${username.replace(/^@/, "")}`] = entry.split("|").map((value) => value.trim());
    return { username: username.startsWith("@") ? username : `@${username}`, title, url };
  });
}

type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramUpdate = {
  message?: {
    chat: { id: number };
    text?: string;
    from?: TelegramUser;
    contact?: {
      phone_number: string;
      user_id?: number;
      first_name: string;
      last_name?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: TelegramUser;
    message?: { chat: { id: number }; message_id: number };
  };
};

type TelegramAuthPayload = {
  initData?: unknown;
};

type TelegramPollingUpdate = TelegramUpdate & { update_id: number };

type DepositSession =
  | { step: "payment-method" }
  | { step: "amount" }
  | { step: "transaction-id"; amount: number };

type WithdrawalSession =
  | { step: "amount" }
  | { step: "phone"; amount: number }
  | { step: "owner-name"; amount: number; phone: string };

const depositSessions = new Map<number, DepositSession>();
const withdrawalSessions = new Map<number, WithdrawalSession>();
const promoSessions = new Set<number>();
const pendingChannelRegistrations = new Map<number, NonNullable<TelegramUpdate["message"]>>();
const TELEBIRR_ACCOUNT_NUMBER = process.env["TELEBIRR_ACCOUNT_NUMBER"]?.trim() || "0975862132";

function getBotToken() {
  const value = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  return value || undefined;
}

function getWebAppUrl() {
  const value = (process.env["TELEGRAM_WEB_APP_URL"] ?? process.env["RENDER_EXTERNAL_URL"])?.trim();
  if (!value) return undefined;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function getWebhookSecret() {
  const value = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
  if (!value) return undefined;
  if (/^[A-Za-z0-9_-]{1,256}$/.test(value)) return value;
  return createHash("sha256").update(value).digest("hex");
}

function getAdminChatId() {
  const value = Number(process.env["TELEGRAM_ADMIN_CHAT_ID"]?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function getAdminUserId() {
  const value = Number(process.env["TELEGRAM_ADMIN_USER_ID"]?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : getAdminChatId();
}

function getAdminPanelUrl() {
  const webAppUrl = getWebAppUrl();
  return webAppUrl ? new URL("/admin", webAppUrl).toString() : undefined;
}

function getWebhookUrl() {
  const baseUrl = (process.env["TELEGRAM_WEBHOOK_URL"] ?? process.env["RENDER_EXTERNAL_URL"])?.trim();
  if (!baseUrl) return undefined;
  const normalizedBaseUrl = baseUrl.startsWith("http://") || baseUrl.startsWith("https://")
    ? baseUrl
    : `https://${baseUrl}`;
  return new URL("/api/telegram/webhook", normalizedBaseUrl).toString();
}

export async function telegramRequest<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const response = await fetch(`${TELEGRAM_API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? response.statusText}`);
  }
  return result.result as T;
}

async function answerCallbackQuery(body: Record<string, unknown>) {
  try {
    await answerCallbackQuery( body);
  } catch (error) {
    logger.warn({ err: error }, "Telegram callback response expired or invalid");
  }
}

async function telegramPhotoRequest<T>(photo: string, body: Record<string, unknown>): Promise<T> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const match = photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Invalid uploaded image");
  const form = new FormData();
  form.append("photo", new Blob([Buffer.from(match[2], "base64")], { type: match[1] }), "broadcast-image");
  Object.entries(body).forEach(([key, value]) => form.append(key, typeof value === "string" ? value : JSON.stringify(value)));
  const response = await fetch(`${TELEGRAM_API_BASE}${token}/sendPhoto`, { method: "POST", body: form });
  const result = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram sendPhoto failed: ${result.description ?? response.statusText}`);
  }
  return result.result as T;
}

function isTelegramWebhookRequest(req: Request) {
  const expectedSecret = getWebhookSecret();
  return Boolean(expectedSecret) && req.header("x-telegram-bot-api-secret-token") === expectedSecret;
}

export function isValidTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!receivedHash || !Number.isSafeInteger(authDate)) return false;
  if (Math.abs(Date.now() / 1000 - authDate) > AUTH_DATA_MAX_AGE_SECONDS) return false;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");
  const calculatedHashBuffer = Buffer.from(calculatedHash, "hex");
  return receivedHashBuffer.length === calculatedHashBuffer.length && timingSafeEqual(receivedHashBuffer, calculatedHashBuffer);
}

export function parseTelegramUser(initData: string) {
  const userValue = new URLSearchParams(initData).get("user");
  if (!userValue) return undefined;
  try {
    return JSON.parse(userValue) as TelegramUser;
  } catch {
    return undefined;
  }
}

function getTelegramInitData(req: Request) {
  return req.header("x-telegram-init-data") ?? req.header("authorization")?.replace(/^tma\s+/i, "");
}

function getAuthenticatedTelegramUser(req: Request) {
  const initData = getTelegramInitData(req);
  const botToken = getBotToken();
  if (!initData || !botToken || !isValidTelegramInitData(initData, botToken)) return undefined;
  const user = parseTelegramUser(initData);
  return user && Number.isSafeInteger(user.id) && user.id > 0 ? user : undefined;
}

function getMainKeyboard(chatId?: number) {
  const keyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: "📝 Register", request_contact: true }, { text: "🎮 Play Bingo" }],
    [{ text: "🎁 Promo Code" }, { text: "💰 Deposit" }],
    [{ text: "💸 Withdraw" }, { text: "🔗 Invite & Earn" }],
    [{ text: "🤝 Agent Dashboard" }],
    [{ text: "👤 Profile & Account" }, { text: "🆘 Support" }],
  ];
  const adminPanelUrl = chatId === getAdminChatId() ? getAdminPanelUrl() : undefined;
  if (adminPanelUrl) keyboard.push([{ text: "🛠 Admin Panel", web_app: { url: adminPanelUrl } }]);
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

function getContactKeyboard() {
  return {
    keyboard: [[{ text: "📱 ኮንታክት ላክ", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function getPaymentMethodKeyboard() {
  return {
    inline_keyboard: [[{ text: "ቴሌብር", callback_data: "deposit:telebirr" }]],
  };
}

async function getMissingRequiredChannels() {
  return [] as RequiredChannel[];
}

async function sendRequiredChannelPrompt(chatId: number, missing: RequiredChannel[]) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "ምዝገባውን ለመጨረስ እባክዎ የሚከተሉትን ቻናሎች ይቀላቀሉ። ከተቀላቀሉ በኋላ Verify ይጫኑ።",
    reply_markup: {
      inline_keyboard: [
        ...missing.map((channel) => [{ text: `Join ${channel.title}`, url: channel.url }]),
        [{ text: "✅ Verify Membership", callback_data: "required-channel:verify" }],
      ],
    },
  });
}

async function sendWelcomeMessage(chatId: number, firstName?: string) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `🎉 እንኳን ወደ Venom Bingo በደህና መጡ${firstName ? ` ${firstName}` : ""}! 🎰\n\nለመመዝገብ "📝 Register" የሚለውን ይጫኑ።\n\nከታች ያለውን ምናሌ በመጠቀም ጨዋታውን ይጀምሩ።`,
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendContactPrompt(chatId: number) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "ምዝገባን ለመጨረስ ከታች ያለውን ቁልፍ በመጫን የራስዎን Telegram contact ያጋሩ።",
    reply_markup: getContactKeyboard(),
  });
}

async function sendAgentDashboardMessage(chatId: number, telegramId?: number) {
  const agent = telegramId ? await db.query.referralAgents.findFirst({ where: and(eq(referralAgents.telegramId, telegramId), eq(referralAgents.status, "active")) }) : undefined;
  const webAppUrl = getWebAppUrl();
  if (agent && webAppUrl) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "የኤጀንት ዳሽቦርድዎን ለመክፈት ከታች ያለውን ቁልፍ ይጫኑ።",
      reply_markup: { inline_keyboard: [[{ text: "🤝 Agent Dashboard ክፈት", web_app: { url: new URL("/agent", webAppUrl).toString() } }]] },
    });
    return;
  }
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `እባክዎን ኤጀንት ለመሆን አድሚኑን ያነጋግሩ።\nSupport: ${(await getGameSettings()).supportUsername}`,
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendProfileAccountMessage(chatId: number, telegramId?: number) {
  const user = telegramId
    ? await db.query.telegramUsers.findFirst({ where: eq(telegramUsers.telegramId, telegramId) })
    : undefined;
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "*****";
  const phone = user?.phoneNumber ?? "የለም";
  const playWallet = user?.playWalletBalance ?? "0.00";
  const bonusWallet = user?.bonusWalletBalance ?? "0.00";
  const winWallet = user?.winWalletBalance ?? "0.00";

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `👤 Profile & Account\n\n👤 ፕሮፋይል\n\nስም: ${name}\nስልክ: ${phone}\n\n💰 play wallet : ${playWallet} ETB\n🎁 bonus wallet : ${bonusWallet} ETB\n🏆 win wallet : ${winWallet} ETB`,
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendInviteMessage(chatId: number) {
  const [bot, settings] = await Promise.all([telegramRequest<{ username?: string }>("getMe", {}), getGameSettings()]);
  if (!bot.username) {
    logger.error("Telegram bot username is not available");
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "የመጋበዣ ሊንክ ማመንጨት አልተቻለም። እባክዎ ቆይተው ይሞክሩ።",
    });
    return;
  }

  const inviteLink = new URL(`https://t.me/${bot.username}`);
  inviteLink.searchParams.set("start", `re${chatId}`);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `🎉 ጋብዝ & አግኝ!\n\nጓደኞችዎን ይጋብዙ እና ለእያንዳንዱ ለጋበዙት አዲስ ተጠቃሚ ${settings.inviteBonus} ብር የPlay Wallet ቦነስ ያግኙ!\n\nየእርስዎ መጋበዣ ሊንክ፦\n${inviteLink.toString()}`,
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendWithdrawalAmountPrompt(chatId: number) {
  withdrawalSessions.set(chatId, { step: "amount" });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "እባክዎን ማውጣት የሚፈልጉትን መጠን ከ100 ብር ጀምሮ ያስገቡ",
  });
}

async function sendWithdrawalPhonePrompt(chatId: number, amount: number) {
  withdrawalSessions.set(chatId, { step: "phone", amount });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "ገንዘብ የሚቀበሉበትን የቴሌብር ቁጥር ያስገቡ",
  });
}

async function sendWithdrawalOwnerNamePrompt(chatId: number, amount: number, phone: string) {
  withdrawalSessions.set(chatId, { step: "owner-name", amount, phone });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "የአካውንቱ ባለቤት ስም ያስገቡ",
  });
}

async function submitWithdrawalRequest(
  chatId: number,
  user: TelegramUser | undefined,
  amount: number,
  phone: string,
  ownerName: string,
  walletType: "win" | "agent" = "win",
) {
  const telegramId = user?.id;
  if (!telegramId) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "መጀመሪያ እባክዎ ይመዝገቡ።" });
    return;
  }
  if (walletType === "win") {
    const [depositTotal] = await db.select({ total: sql<string>`coalesce(sum(${depositRequests.amount}), 0)` })
      .from(depositRequests)
      .where(and(eq(depositRequests.telegramId, telegramId), eq(depositRequests.status, "approved")));
    if (Number(depositTotal?.total ?? 0) < 50) {
      await telegramRequest("sendMessage", { chat_id: chatId, text: "ዊዝድሮው ለማድረግ ቢያንስ 50 ብር ዲፖዚት ማድረግ ያስፈልጋል። በሕይወት ዘመንዎ ያደረጉት የተፈቀደ ዲፖዚት ከ50 ብር በታች ነው።" });
      withdrawalSessions.delete(chatId);
      return;
    }
  }
  const request = await db.transaction(async (tx) => {
    const [userRow] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, telegramId)).for("update").limit(1);
    if (walletType === "win" && (!userRow || Number(userRow.winWalletBalance) - amount < 10)) return { insufficient: true as const };
    const [inserted] = await tx.insert(withdrawalRequests).values({ telegramId, amount: amount.toFixed(2), phone, ownerName, walletType, status: "pending" })
      .onConflictDoNothing({ target: [withdrawalRequests.telegramId, withdrawalRequests.amount, withdrawalRequests.phone, withdrawalRequests.ownerName] }).returning({ id: withdrawalRequests.id });
    if (!inserted) return { duplicate: true as const };
    if (walletType === "win" && userRow) {
      const before = Number(userRow.winWalletBalance);
      const after = (before - amount).toFixed(2);
      await tx.update(telegramUsers).set({ winWalletBalance: after, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, telegramId));
      await tx.insert(walletTransactions).values({ telegramId, type: "withdrawal", amount: amount.toFixed(2), balanceBefore: before.toFixed(2), balanceAfter: after, status: "pending", reference: `withdrawal-request-${inserted.id}`, metadata: { source: "telegram_withdrawal", wallet: "win", withdrawalRequestId: inserted.id } });
    }
    return { id: inserted.id };
  });
  if ("insufficient" in request) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "የዊዝድሮው ጥያቄዎ አልተቀበለም። ከዊዝድሮው በኋላ ቢያንስ 10 ብር በWin Wallet ላይ መቅረት አለበት።" });
    withdrawalSessions.delete(chatId);
    return;
  }
  if ("duplicate" in request) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "ይህ የወጪ ጥያቄ ቀድሞ ተመዝግቧል።" });
    withdrawalSessions.delete(chatId);
    return;
  }
  const adminChatId = getAdminChatId();
  if (adminChatId) await telegramRequest("sendMessage", {
    chat_id: adminChatId,
    text: `💸 አዲስ የወጪ ጥያቄ\n\nተጠቃሚ: ${user?.first_name ?? "Unknown"}${user?.username ? ` (@${user.username})` : ""}\nTelegram ID: ${user?.id ?? "Unknown"}\nChat ID: ${chatId}\nመጠን: ${amount} ETB\nTelebirr ቁጥር: ${phone}\nየአካውንት ባለቤት: ${ownerName}`,
    reply_markup: getAdminApprovalKeyboard("withdrawal", request.id),
  });
  withdrawalSessions.delete(chatId);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "እንኳን ደስ አልዎት የወጪ ጥያቄዎ ወደ አድሚን ተልኳል።\nየቴሌብር መልዕክት በቅርቡ ይደርስዎታል።",
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendDepositPaymentOptions(chatId: number) {
  depositSessions.set(chatId, { step: "payment-method" });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "💰 ሂሳብ ለመሙላት የሚጠቀሙበትን የክፍያ አማራጭ ይምረጡ፦",
    reply_markup: getPaymentMethodKeyboard(),
  });
}

async function sendTelebirrAmountPrompt(chatId: number) {
  depositSessions.set(chatId, { step: "amount" });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "ቴሌብርን መርጠዋል\n\nእባክዎ መሙላት የሚፈልጉትን የገንዘብ መጠን በቁጥር ብቻ ያስገቡ (ከ 10 ብር ጀምሮ):",
  });
}

async function sendTelebirrPaymentInstructions(chatId: number, amount: number) {
  depositSessions.set(chatId, { step: "transaction-id", amount });
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `መሙላት የፈለጉት መጠን: ${amount} ETB\n\nእባክዎ ከታች ወዳለው የTelebirr አካውንት ብሩን ያስገቡ።\n\n📱 አካውንት ቁጥር:\n<code>${TELEBIRR_ACCOUNT_NUMBER}</code>\n\nከዚያም የትራንዛክሽን ቁጥሩን (Transaction ID) እዚህ ላይ ይፃፉልን። ጥያቄዎ በአጭር ጊዜ ውስጥ ይስተናገዳል።`,
    parse_mode: "HTML",
  });
}

async function submitDepositRequest(chatId: number, user: TelegramUser | undefined, amount: number, transactionId: string) {
  const telegramId = user?.id;
  if (!telegramId) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "መጀመሪያ እባክዎ ይመዝገቡ።" });
    return;
  }
  const [request] = await db.insert(depositRequests).values({
    telegramId,
    amount: amount.toFixed(2),
    paymentMethod: "telebirr",
    transactionId: transactionId.trim(),
    status: "pending",
  }).onConflictDoNothing({ target: [depositRequests.paymentMethod, depositRequests.transactionId] }).returning({ id: depositRequests.id });
  if (!request) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "ይህ የTransaction ID ቀድሞ ተመዝግቧል።" });
    depositSessions.delete(chatId);
    return;
  }
  const adminChatId = getAdminChatId();
  if (adminChatId) await telegramRequest("sendMessage", {
    chat_id: adminChatId,
    text: `💰 አዲስ የቴሌብር ዲፖዚት ጥያቄ\n\nተጠቃሚ: ${user?.first_name ?? "Unknown"}${user?.username ? ` (@${user.username})` : ""}\nTelegram ID: ${user?.id ?? "Unknown"}\nChat ID: ${chatId}\nመጠን: ${amount} ETB\nTransaction ID: ${transactionId}`,
    reply_markup: getAdminApprovalKeyboard("deposit", request.id),
  });
  depositSessions.delete(chatId);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `✅ የ${amount} ETB የሂሳብ መሙያ ጥያቄዎ ወደአድሚን ተልኳል። አድሚኑ ሲያጸድቀው መልዕክት ይደርስዎታል።`,
    reply_markup: getMainKeyboard(chatId),
  });
}

async function sendMiniAppLink(chatId: number) {
  const webAppUrl = getWebAppUrl();
  if (!webAppUrl) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Mini App አሁን ዝግጁ አይደለም። እባክዎ ቆይተው እንደገና ይሞክሩ።",
    });
    return;
  }
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "Venom Bingo ለመክፈት ከታች ያለውን ቁልፍ ይጫኑ።",
    reply_markup: {
      inline_keyboard: [[{ text: "Venom Bingo ክፈት", web_app: { url: webAppUrl } }]],
    },
  });
}

function getAdminApprovalKeyboard(type: "deposit" | "withdrawal", id: number) {
  return {
    inline_keyboard: [[
      { text: "Approve", callback_data: `${type}:approve:${id}` },
      { text: "Reject", callback_data: `${type}:reject:${id}` },
    ]],
  };
}

async function sendPendingRequests(chatId: number) {
  const [deposits, withdrawals] = await Promise.all([
    db.query.depositRequests.findMany({
      where: eq(depositRequests.status, "pending"),
      orderBy: [desc(depositRequests.createdAt)],
    }),
    db.query.withdrawalRequests.findMany({
      where: eq(withdrawalRequests.status, "pending"),
      orderBy: [desc(withdrawalRequests.createdAt)],
    }),
  ]);

  if (deposits.length === 0 && withdrawals.length === 0) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "No pending deposit or withdrawal requests." });
    return;
  }

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `Pending requests: ${deposits.length} deposit(s), ${withdrawals.length} withdrawal(s).`,
  });
  for (const request of deposits) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Deposit #${request.id}\nTelegram ID: ${request.telegramId}\nAmount: ${request.amount} ETB\nPayment: ${request.paymentMethod}\nTransaction ID: ${request.transactionId}`,
      reply_markup: getAdminApprovalKeyboard("deposit", request.id),
    });
  }
  for (const request of withdrawals) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: `Withdrawal #${request.id}\nTelegram ID: ${request.telegramId}\nAmount: ${request.amount} ETB\nTelebirr: ${request.phone}\nOwner: ${request.ownerName}`,
      reply_markup: getAdminApprovalKeyboard("withdrawal", request.id),
    });
  }
}

async function sendSuspiciousUserReport(chatId: number) {
  const [duplicatePhones, topInviters] = await Promise.all([
    db.select({ phone: telegramUsers.phoneNumber, count: sql<string>`count(*)` })
      .from(telegramUsers).groupBy(telegramUsers.phoneNumber).having(sql`count(*) > 1`).orderBy(desc(sql`count(*)`)).limit(20),
    db.select({ telegramId: telegramReferrals.inviterTelegramId, count: sql<string>`count(*)`, phone: telegramUsers.phoneNumber })
      .from(telegramReferrals).leftJoin(telegramUsers, eq(telegramUsers.telegramId, telegramReferrals.inviterTelegramId))
      .groupBy(telegramReferrals.inviterTelegramId, telegramUsers.phoneNumber).orderBy(desc(sql`count(*)`)).limit(20),
  ]);
  const duplicateText = duplicatePhones.length
    ? duplicatePhones.map((item) => `${item.phone} — ${item.count} accounts`).join("\\n")
    : "ምንም duplicate phone አልተገኘም።";
  const inviterText = topInviters.length
    ? topInviters.map((item) => `${item.telegramId} — ${item.count} referrals${item.phone ? ` — ${item.phone}` : ""}`).join("\\n")
    : "ምንም referral አልተገኘም።";
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `🔎 Suspicious Users Report\\n\\n📱 Duplicate phones:\\n${duplicateText}\\n\\n👥 Top inviters:\\n${inviterText}\\n\\n⚠️ ይህ ሪፖርት ለምርመራ ነው፤ በማስረጃ ሳይረጋገጥ account አይከልከል።`,
  });
}

async function sendTopBalanceReport(chatId: number) {
  const users = await db.select({ telegramId: telegramUsers.telegramId, name: telegramUsers.firstName, phone: telegramUsers.phoneNumber, play: telegramUsers.playWalletBalance, bonus: telegramUsers.bonusWalletBalance, win: telegramUsers.winWalletBalance })
    .from(telegramUsers)
    .orderBy(desc(sql`(${telegramUsers.playWalletBalance} + ${telegramUsers.bonusWalletBalance} + ${telegramUsers.winWalletBalance})`))
    .limit(20);
  const lines = users.length
    ? users.map((user, index) => `${index + 1}. ${user.name} — ${(Number(user.play) + Number(user.bonus) + Number(user.win)).toFixed(2)} ብር (Play: ${user.play}, Bonus: ${user.bonus}, Win: ${user.win})\\n   ${user.phone} · ID: ${user.telegramId}`).join("\\n")
    : "ምንም User አልተገኘም።";
  await telegramRequest("sendMessage", { chat_id: chatId, text: `🏦 Top Balance Users\\n\\n${lines}` });
}

async function sendDailyWalletReport(chatId: number) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [deposits, withdrawals] = await Promise.all([
    db.select({ count: sql<string>`count(*)`, total: sql<string>`coalesce(sum(${depositRequests.amount}), 0)` })
      .from(depositRequests).where(and(eq(depositRequests.status, "approved"), gte(depositRequests.createdAt, startOfDay))),
    db.select({ count: sql<string>`count(*)`, total: sql<string>`coalesce(sum(${withdrawalRequests.amount}), 0)` })
      .from(withdrawalRequests).where(and(eq(withdrawalRequests.status, "approved"), gte(withdrawalRequests.createdAt, startOfDay))),
  ]);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `📊 የዛሬ የገቢና ወጪ ሪፖርት\\n\\n📥 ዲፖዚት\\nብዛት: ${deposits[0]?.count ?? "0"}\\nጠቅላላ: ${Number(deposits[0]?.total ?? 0).toFixed(2)} ብር\\n\\n📤 ዊዝድሮው\\nብዛት: ${withdrawals[0]?.count ?? "0"}\\nጠቅላላ: ${Number(withdrawals[0]?.total ?? 0).toFixed(2)} ብር\\n\\n💰 የቀኑ የተጣራ ልዩነት: ${(Number(deposits[0]?.total ?? 0) - Number(withdrawals[0]?.total ?? 0)).toFixed(2)} ብር`,
  });
}

async function notifyWalletRequestUser(telegramId: number, text: string) {
  const user = await db.query.telegramUsers.findFirst({
    where: eq(telegramUsers.telegramId, telegramId),
    columns: { chatId: true },
  });
  if (user) await telegramRequest("sendMessage", { chat_id: user.chatId, text });
}

async function processAdminDecision(type: "deposit" | "withdrawal", action: "approve" | "reject", id: number, adminChatId: number) {
  let outcome = "Request was already processed.";
  let userNotification: { telegramId: number; text: string } | undefined;
  const settings = await getGameSettings();
  await db.transaction(async (tx) => {
    const request = type === "deposit"
      ? (await tx.select().from(depositRequests).where(and(eq(depositRequests.id, id), eq(depositRequests.status, "pending"))).for("update").limit(1))[0]
      : (await tx.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.status, "pending"))).for("update").limit(1))[0];
    if (!request) return;

    const user = (await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, request.telegramId)).for("update").limit(1))[0];
    if (!user) {
      outcome = "The request user no longer exists.";
      return;
    }
    if (action === "reject") {
      const updatedAt = new Date();
      if (type === "deposit") await tx.update(depositRequests).set({ status: "rejected", updatedAt }).where(and(eq(depositRequests.id, id), eq(depositRequests.status, "pending")));
      else {
        await tx.update(withdrawalRequests).set({ status: "rejected", updatedAt }).where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.status, "pending")));
        if ("walletType" in request && request.walletType === "agent") {
          const balanceBefore = Number(user.agentWalletBalance);
          const balanceAfter = (balanceBefore + Number(request.amount)).toFixed(2);
          await tx.insert(walletTransactions).values({ telegramId: request.telegramId, type: "adjustment", amount: request.amount, balanceBefore: balanceBefore.toFixed(2), balanceAfter, status: "completed", reference: `agent-withdrawal-refund-${id}`, metadata: { source: "agent_withdrawal_refund", withdrawalRequestId: id, wallet: "agent" } });
          await tx.update(telegramUsers).set({ agentWalletBalance: balanceAfter, updatedAt }).where(eq(telegramUsers.telegramId, request.telegramId));
        }
      }
      outcome = `Request #${id} rejected.`;
      userNotification = { telegramId: request.telegramId, text: type === "deposit" ? `Your deposit request #${id} was rejected.` : `Your withdrawal request #${id} was rejected.` };
      return;
    }

    const amount = Number(request.amount);
    const bonusAmount = type === "deposit" ? amount * Number(settings.depositBonusPercentage) / 100 : 0;
    const creditedAmount = type === "deposit" ? amount + bonusAmount : amount;
    const withdrawalWallet = type === "withdrawal" && "walletType" in request && request.walletType === "agent" ? "agent" : "win";
    const before = Number(type === "deposit" ? user.playWalletBalance : withdrawalWallet === "agent" ? user.agentWalletBalance : user.winWalletBalance);
    if (type === "withdrawal" && withdrawalWallet === "win" && before < 10) {
      await tx.update(withdrawalRequests).set({ status: "rejected", updatedAt: new Date() }).where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.status, "pending")));
      const walletLabel = "win wallet";
      outcome = `Withdrawal #${id} rejected: at least 10 ETB must remain in the ${walletLabel}.`;
      userNotification = { telegramId: request.telegramId, text: `የዊዝድሮው ጥያቄዎ አልተፈቀደም። ከዊዝድሮው በኋላ ቢያንስ 10 ብር በWin Wallet ላይ መቅረት አለበት።` };
      return;
    }

    const after = type === "deposit" ? before + amount : withdrawalWallet === "win" ? before : before - amount;
    const reference = `${type}-request-${id}`;
    if (type === "withdrawal" && withdrawalWallet === "win") {
      await tx.update(walletTransactions).set({ status: "completed" }).where(and(eq(walletTransactions.reference, reference), eq(walletTransactions.status, "pending")));
    } else if (!(type === "withdrawal" && withdrawalWallet === "agent")) await tx.insert(walletTransactions).values({
      telegramId: request.telegramId,
      type,
      amount: type === "deposit" ? creditedAmount.toFixed(2) : request.amount,
      balanceBefore: before.toFixed(2),
      balanceAfter: after.toFixed(2),
      status: "completed",
      reference,
      metadata: { requestId: id, approvedBy: adminChatId, source: "telegram_admin", wallet: type === "withdrawal" ? withdrawalWallet : "play", ...(type === "deposit" ? { depositAmount: amount, bonusPercentage: Number(settings.depositBonusPercentage), bonusAmount } : {}) },
    });
    if (type === "deposit" || withdrawalWallet === "agent") await tx.update(telegramUsers).set({
      ...(type === "deposit" ? { playWalletBalance: after.toFixed(2), bonusWalletBalance: (Number(user.bonusWalletBalance) + bonusAmount).toFixed(2) } : { winWalletBalance: after.toFixed(2) }),
      updatedAt: new Date(),
    }).where(eq(telegramUsers.telegramId, request.telegramId));
    const updatedAt = new Date();
    if (type === "deposit") {
      await tx.update(depositRequests).set({ status: "approved", updatedAt }).where(and(eq(depositRequests.id, id), eq(depositRequests.status, "pending")));
      const [attribution] = await tx.select().from(referralAgentAttributions)
        .where(eq(referralAgentAttributions.referredTelegramId, request.telegramId)).for("update").limit(1);
      if (attribution) {
        const [agent] = await tx.select().from(referralAgents)
          .where(and(eq(referralAgents.id, attribution.agentId), eq(referralAgents.status, "active"))).for("update").limit(1);
        if (agent && agent.telegramId !== request.telegramId) {
          const [agentUser] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, agent.telegramId)).for("update").limit(1);
          if (agentUser) {
            const commissionAmount = (amount * Number(agent.commissionRate) / 100).toFixed(2);
            const commissionReference = `agent:deposit:${id}`;
            const [commission] = await tx.insert(referralAgentCommissions).values({
              agentId: agent.id,
              referredTelegramId: request.telegramId,
              depositRequestId: id,
              depositAmount: request.amount,
              commissionRate: agent.commissionRate,
              commissionAmount,
            }).onConflictDoNothing({ target: referralAgentCommissions.depositRequestId }).returning({ id: referralAgentCommissions.id });
            if (commission) {
              const agentBalanceBefore = Number(agentUser.agentWalletBalance);
              const agentBalanceAfter = (agentBalanceBefore + Number(commissionAmount)).toFixed(2);
              await tx.insert(walletTransactions).values({
                telegramId: agent.telegramId,
                type: "adjustment",
                amount: commissionAmount,
                balanceBefore: agentBalanceBefore.toFixed(2),
                balanceAfter: agentBalanceAfter,
                status: "completed",
                reference: commissionReference,
                metadata: { source: "referral_agent_commission", wallet: "agent", agentId: agent.id, depositRequestId: id, referredTelegramId: request.telegramId },
              });
              await tx.update(telegramUsers).set({ agentWalletBalance: agentBalanceAfter, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, agent.telegramId));
            }
          }
        }
      }
    } else await tx.update(withdrawalRequests).set({ status: "approved", updatedAt }).where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.status, "pending")));
    outcome = `Request #${id} approved.`;
    userNotification = { telegramId: request.telegramId, text: type === "deposit" ? `🎉 እንኳን ደስ አለዎት!\n\n✅ የዲፖዚት ጥያቄዎ #${id} ተፈቅዷል።\n💰 ${amount.toFixed(2)} ብር + ${bonusAmount.toFixed(2)} ብር ቦነስ\n💳 ጠቅላላ ${creditedAmount.toFixed(2)} ብር ወደ Play Wallet ተጨምሯል።\n\n🙏 VENOMን ስለመረጡ እናመሰግናለን!` : `🎉 እንኳን ደስ አለዎት!\n\n✅ የዊዝድሮው ጥያቄዎ #${id} ተፈቅዷል።\n💸 ${amount.toFixed(2)} ብር ወደ ቴሌብር ቁጥርዎ ይላካል።\n\n🙏 VENOMን ስለመረጡ እናመሰግናለን!` };
  });
  if (userNotification) await notifyWalletRequestUser(userNotification.telegramId, userNotification.text);
  await telegramRequest("sendMessage", { chat_id: adminChatId, text: outcome });
}

async function saveTelegramContact(message: NonNullable<TelegramUpdate["message"]>) {
  const contact = message.contact;
  const user = message.from;
  if (!contact || !user || contact.user_id !== user.id) {
    await telegramRequest("sendMessage", {
      chat_id: message.chat.id,
      text: "እባክዎ የራስዎን Telegram contact ብቻ ያጋሩ።",
    });
    return;
  }

  const existingUser = await db.query.telegramUsers.findFirst({ where: eq(telegramUsers.telegramId, user.id), columns: { telegramId: true } });
  const missingChannels = existingUser ? [] : await getMissingRequiredChannels();
  if (missingChannels.length) {
    pendingChannelRegistrations.set(user.id, message);
    await sendRequiredChannelPrompt(message.chat.id, missingChannels);
    return;
  }

  const registration = {
    telegramId: user.id,
    chatId: message.chat.id,
    firstName: contact.first_name || user.first_name,
    lastName: contact.last_name ?? user.last_name ?? null,
    username: user.username ?? null,
    phoneNumber: contact.phone_number,
    languageCode: user.language_code ?? null,
    updatedAt: new Date(),
  };
  const settings = await getGameSettings();
  let isNewRegistration = false;
  let rewardedInviterTelegramId: number | undefined;
  let referralRewardAmount: string | undefined;
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(telegramUsers)
      .values({ ...registration, playWalletBalance: "0.00", bonusWalletBalance: settings.registrationBonus, bonusWalletLastPlayedAt: new Date(), winWalletBalance: "0.00" })
      .onConflictDoNothing({ target: telegramUsers.telegramId })
      .returning({ telegramId: telegramUsers.telegramId });
    isNewRegistration = Boolean(inserted);

    if (!inserted) {
      await tx
        .update(telegramUsers)
        .set(registration)
        .where(eq(telegramUsers.telegramId, user.id));
      return;
    }

    const [existingPhone] = await tx.select({ telegramId: telegramUsers.telegramId }).from(telegramUsers)
      .where(and(eq(telegramUsers.phoneNumber, contact.phone_number), sql`${telegramUsers.telegramId} <> ${user.id}`)).limit(1);
    if (existingPhone) return;

    const [referral] = await tx.select().from(telegramReferrals)
      .where(eq(telegramReferrals.referredTelegramId, user.id))
      .for("update").limit(1);
    const [agentAttribution] = await tx.select().from(referralAgentAttributions)
      .where(eq(referralAgentAttributions.referredTelegramId, user.id))
      .for("update").limit(1);
    const inviterTelegramId = referral?.inviterTelegramId ?? (agentAttribution ? (await tx.select({ telegramId: referralAgents.telegramId }).from(referralAgents).where(eq(referralAgents.id, agentAttribution.agentId)).limit(1))[0]?.telegramId : undefined);
    if (!inviterTelegramId || inviterTelegramId === user.id) return;

    const [inviter] = await tx.select().from(telegramUsers)
      .where(eq(telegramUsers.telegramId, inviterTelegramId))
      .for("update").limit(1);
    if (!inviter) return;

    const rewardAmount = agentAttribution && !referral ? "10.00" : settings.inviteBonus;
    const reference = `referral:signup:${user.id}`;
    const balanceBefore = Number(inviter.bonusWalletBalance);
    const balanceAfter = (balanceBefore + Number(rewardAmount)).toFixed(2);
    const [ledger] = await tx.insert(walletTransactions).values({
      telegramId: inviter.telegramId,
      type: "invite_bonus",
      wallet: "bonus",
      amount: rewardAmount,
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter,
      status: "completed",
      reference,
      metadata: {
        source: agentAttribution && !referral ? "referral_agent_signup" : "telegram_referral",
        inviterTelegramId: inviter.telegramId,
        referredTelegramId: user.id,
      },
    }).onConflictDoNothing({ target: walletTransactions.reference }).returning({ id: walletTransactions.id });
    if (!ledger) return;

    await tx.update(telegramUsers).set({ bonusWalletBalance: balanceAfter, bonusWalletLastPlayedAt: new Date(), updatedAt: new Date() })
      .where(eq(telegramUsers.telegramId, inviter.telegramId));
    rewardedInviterTelegramId = inviter.telegramId;
    referralRewardAmount = rewardAmount;
  });

  if (rewardedInviterTelegramId) {
    try {
      await notifyWalletRequestUser(
        rewardedInviterTelegramId,
        `🎉 አዲስ ተጠቃሚ በእርስዎ ሊንክ ገብቷል።\n💰 ${referralRewardAmount ?? settings.inviteBonus} ብር ወደ Play Wallet ተጨምሯል።`,
      );
    } catch (error) {
      logger.error({ err: error, inviterTelegramId: rewardedInviterTelegramId }, "Referral reward notification failed");
    }
  }

  const text = isNewRegistration
    ? `✅ እንኳን ደስ አለዎት ${registration.firstName}! ምዝገባዎ ተሳክቷል።\n\n🤑 የ${settings.registrationBonus} ብር የPlay Wallet ገቢ ተደርጎልዎታል።\n\nአሁን Venom Bingoን መጫወት ይችላሉ።`
    : "እርስዎ ቀድሞውኑ የVenom Bingo ተጠቃሚ ነዎት።\n\nበቀጥታ ወደ ጨዋታ መቀላቀል ይችላሉ።";

  await telegramRequest("sendMessage", {
    chat_id: message.chat.id,
    text,
    reply_markup: getMainKeyboard(message.chat.id),
  });
}

async function handleTelegramUpdate(update: TelegramUpdate) {
  const callbackQuery = update.callback_query;
  if (callbackQuery) {
    const adminChatId = getAdminChatId();
    const callbackChatId = callbackQuery.message?.chat.id;
    const decision = callbackQuery.data?.match(/^(deposit|withdrawal):(approve|reject):(\d+)$/);
    if (decision && (!adminChatId || callbackChatId !== adminChatId)) {
      await answerCallbackQuery( { callback_query_id: callbackQuery.id, text: "Unauthorized.", show_alert: true });
      return;
    }
    if (callbackQuery.data === "required-channel:verify" && callbackQuery.message) {
      const telegramId = callbackQuery.from?.id;
      const pending = telegramId ? pendingChannelRegistrations.get(telegramId) : undefined;
      if (!telegramId || !pending) {
        await answerCallbackQuery( { callback_query_id: callbackQuery.id, text: "የሚጠባበቅ ምዝገባ የለም።", show_alert: true });
        return;
      }
      const missing = await getMissingRequiredChannels();
      if (missing.length) {
        await answerCallbackQuery( { callback_query_id: callbackQuery.id, text: "እባክዎ ሁሉንም ቻናሎች ይቀላቀሉ።", show_alert: true });
        await sendRequiredChannelPrompt(callbackQuery.message.chat.id, missing);
        return;
      }
      pendingChannelRegistrations.delete(telegramId);
      await answerCallbackQuery( { callback_query_id: callbackQuery.id, text: "Membership verified." });
      await saveTelegramContact(pending);
      return;
    }
    await answerCallbackQuery( { callback_query_id: callbackQuery.id });
    if (callbackQuery.data === "deposit:telebirr" && callbackQuery.message) {
      await sendTelebirrAmountPrompt(callbackQuery.message.chat.id);
    } else if (decision && adminChatId) {
      await processAdminDecision(decision[1] as "deposit" | "withdrawal", decision[2] as "approve" | "reject", Number(decision[3]), adminChatId);
    }
    return;
  }

  const message = update.message;
  if (message?.contact) {
    await saveTelegramContact(message);
    return;
  }

  const text = message?.text?.trim();
  if (!message || !text) return;
  if (text === "👤 Profile & Account") {
    withdrawalSessions.delete(message.chat.id);
    depositSessions.delete(message.chat.id);
    promoSessions.delete(message.chat.id);
    await sendProfileAccountMessage(message.chat.id, message.from?.id);
    return;
  }
  if (text === "/pending" || text === "/report" || text === "/daily-report" || text === "/top-balance") {
    if (getAdminChatId() !== message.chat.id) {
      await telegramRequest("sendMessage", { chat_id: message.chat.id, text: "Unauthorized." });
      return;
    }
    if (text === "/pending") await sendPendingRequests(message.chat.id);
    else if (text === "/report") await sendSuspiciousUserReport(message.chat.id);
    else if (text === "/daily-report") await sendDailyWalletReport(message.chat.id);
    else await sendTopBalanceReport(message.chat.id);
    return;
  }
  const startMatch = text.match(/^\/start(?:\s+(?:re([0-9]+)|agent_([A-Z0-9]{6,24})))?$/i);
  if (startMatch) {
    const inviterChatId = startMatch[1] ? Number(startMatch[1]) : undefined;
    const agentCode = startMatch[2]?.toUpperCase();
    const referredTelegramId = message.from?.id;
    if (inviterChatId && Number.isSafeInteger(inviterChatId) && referredTelegramId) {
      const inviter = await db.query.telegramUsers.findFirst({ where: eq(telegramUsers.chatId, inviterChatId), columns: { telegramId: true } });
      if (inviter && inviter.telegramId !== referredTelegramId) await db.insert(telegramReferrals).values({ referredTelegramId, inviterTelegramId: inviter.telegramId }).onConflictDoNothing({ target: telegramReferrals.referredTelegramId });
    }
    if (agentCode && referredTelegramId) {
      const agent = await db.query.referralAgents.findFirst({ where: and(eq(referralAgents.code, agentCode), eq(referralAgents.status, "active")) });
      if (agent && agent.telegramId !== referredTelegramId) await db.insert(referralAgentAttributions).values({ referredTelegramId, agentId: agent.id }).onConflictDoNothing({ target: referralAgentAttributions.referredTelegramId });
    }
    await sendWelcomeMessage(message.chat.id, message.from?.first_name);
    return;
  }
  if (text === "🎮 Play Bingo" || text === "/play") {
    await sendMiniAppLink(message.chat.id);
    return;
  }
  if (text === "💰 Deposit" || text === "/deposit") {
    await sendDepositPaymentOptions(message.chat.id);
    return;
  }
  if (text === "💸 Withdraw" || text === "/withdraw") {
    await sendWithdrawalAmountPrompt(message.chat.id);
    return;
  }
  if (text === "📝 Register" || text === "/register") {
    await sendContactPrompt(message.chat.id);
    return;
  }
  if (text === "🔗 Invite & Earn" || text === "/invite") {
    await sendInviteMessage(message.chat.id);
    return;
  }
  if (text === "🤝 Agent Dashboard" || text === "/agent") {
    await sendAgentDashboardMessage(message.chat.id, message.from?.id);
    return;
  }
  if (text === "/menu") {
    await sendWelcomeMessage(message.chat.id, message.from?.first_name);
    return;
  }
  if (text === "🆘 Support" || text === "/help") {
    await telegramRequest("sendMessage", {
      chat_id: message.chat.id,
      text: `ለእርዳታ ቴሌግራም ላይ ${(await getGameSettings()).supportUsername} ያነጋግሩን።`,
      reply_markup: getMainKeyboard(message.chat.id),
    });
    return;
  }

  const withdrawalSession = withdrawalSessions.get(message.chat.id);
  if (withdrawalSession?.step === "amount") {
    const amount = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(amount) || amount < 100) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: "እባክዎን ከ100 ብር ጀምሮ የሆነ መጠን በቁጥር ብቻ ያስገቡ።",
      });
      return;
    }
    await sendWithdrawalPhonePrompt(message.chat.id, amount);
    return;
  }
  if (withdrawalSession?.step === "phone") {
    if (!/^09\d{8}$/.test(text)) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: "እባክዎን ትክክለኛ የTelebirr ቁጥር ያስገቡ። ምሳሌ: 0912345678",
      });
      return;
    }
    await sendWithdrawalOwnerNamePrompt(message.chat.id, withdrawalSession.amount, text);
    return;
  }
  if (withdrawalSession?.step === "owner-name") {
    if (text.length > 100) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: "እባክዎን ትክክለኛ የአካውንት ባለቤት ስም ያስገቡ።",
      });
      return;
    }
    await submitWithdrawalRequest(
      message.chat.id,
      message.from,
      withdrawalSession.amount,
      withdrawalSession.phone,
      text,
    );
    return;
  }

  const session = depositSessions.get(message.chat.id);
  if (session?.step === "amount") {
    const amount = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(amount) || amount < 10) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: "እባክዎ ከ10 ብር ጀምሮ የሆነ መጠን በቁጥር ብቻ ያስገቡ።",
      });
      return;
    }
    await sendTelebirrPaymentInstructions(message.chat.id, amount);
    return;
  }
  if (session?.step === "transaction-id") {
    const sms = parseTelebirrDepositSms(text);
    if (sms && Number(sms.amount) !== session.amount) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: `የSMS መጠን ${sms.amount} ETB ነው፣ እርስዎ የጠየቁት መጠን ${session.amount.toFixed(2)} ETB ነው። እባክዎ ትክክለኛውን SMS ይላኩ።`,
      });
      return;
    }
    if (!sms && text.length > 100) {
      await telegramRequest("sendMessage", {
        chat_id: message.chat.id,
        text: "እባክዎ ሙሉ የTelebirr SMS ወይም ትክክለኛ የTransaction ID ያስገቡ።",
      });
      return;
    }
    await submitDepositRequest(message.chat.id, message.from, session.amount, sms?.transactionId ?? text);
    return;
  }

  if (text === "👤 Profile & Account") {
    await sendProfileAccountMessage(message.chat.id, message.from?.id);
    return;
  }

  if (text === "🎁 Promo Code" || text === "/promo") {
    promoSessions.add(message.chat.id);
    await telegramRequest("sendMessage", {
      chat_id: message.chat.id,
      text: "እባክዎ Promo Code ያስገቡ።",
      reply_markup: { force_reply: true },
    });
    return;
  }

  if (promoSessions.has(message.chat.id)) {
    promoSessions.delete(message.chat.id);
    const result = await redeemPromoCode(message.from?.id ?? 0, text);
    await telegramRequest("sendMessage", {
      chat_id: message.chat.id,
      text: result.ok ? `🎉 እንኳን ደስ አለዎት! ${result.amount} ብር ወደ Play Wallet ተጨምሯል።` : promoFailureMessage(result.reason),
      reply_markup: getMainKeyboard(message.chat.id),
    });
    return;
  }
}

router.post("/telegram/webhook", async (req, res) => {
  if (!isTelegramWebhookRequest(req)) {
    logger.warn({ hasSecretHeader: Boolean(req.header("x-telegram-bot-api-secret-token")), hasConfiguredSecret: Boolean(getWebhookSecret()) }, "Telegram webhook rejected: secret mismatch");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  logger.info({ updateKeys: Object.keys(req.body ?? {}) }, "Telegram webhook update received");
  res.sendStatus(200);
  void handleTelegramUpdate(req.body as TelegramUpdate).catch((error) => {
    req.log?.error({ err: error }, "Telegram update handling failed");
  });
});

router.post("/telegram/wallet-flow", async (req, res) => {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return;
  }
  const action = (req.body as { action?: unknown }).action;
  if (action !== "deposit" && action !== "withdrawal") {
    res.status(400).json({ error: "Invalid wallet action" });
    return;
  }
  const profile = await db.query.telegramUsers.findFirst({
    where: eq(telegramUsers.telegramId, user.id),
    columns: { chatId: true },
  });
  if (!profile) {
    res.status(404).json({ error: "Telegram user is not registered" });
    return;
  }
  if (action === "deposit") await sendDepositPaymentOptions(profile.chatId);
  else await sendWithdrawalAmountPrompt(profile.chatId);
  res.json({ success: true });
});

router.post("/telegram/auth", async (req, res) => {
  const botToken = getBotToken();
  const { initData } = req.body as TelegramAuthPayload;
  if (!botToken) {
    logger.warn({ hasInitData: typeof initData === "string" && initData.length > 0 }, "Mini App auth rejected: TELEGRAM_BOT_TOKEN is missing");
    res.status(401).json({ error: "Invalid Telegram authentication data" });
    return;
  }
  if (typeof initData !== "string" || initData.length === 0) {
    logger.warn("Mini App auth rejected: Telegram initData is missing");
    res.status(401).json({ error: "Invalid Telegram authentication data" });
    return;
  }
  if (!isValidTelegramInitData(initData, botToken)) {
    logger.warn("Mini App auth rejected: Telegram initData is invalid or expired");
    res.status(401).json({ error: "Invalid Telegram authentication data" });
    return;
  }

  const user = parseTelegramUser(initData);
  if (!user) {
    logger.warn("Mini App auth rejected: Telegram user data is missing");
    res.status(401).json({ error: "Telegram user data is missing" });
    return;
  }
  const profile = await db.query.telegramUsers.findFirst({
    where: eq(telegramUsers.telegramId, user.id),
    columns: {
      firstName: true,
      lastName: true,
      playWalletBalance: true,
      bonusWalletBalance: true,
      bonusWalletLastPlayedAt: true,
      winWalletBalance: true,
    },
  });
  logger.info({ telegramId: user.id, profileFound: Boolean(profile), hasPlayWalletBalance: Boolean(profile?.playWalletBalance), hasWinWalletBalance: Boolean(profile?.winWalletBalance) }, "Mini App wallet profile lookup completed");
  res.json({ user, profile, isAdmin: user.id === getAdminUserId() });
});

type PromoRedeemResult =
  | { ok: true; amount: string }
  | { ok: false; reason: "invalid" | "inactive" | "expired" | "limit" | "already" | "unregistered" };

function normalizePromoCode(value: string) {
  return value.trim().toUpperCase();
}

async function redeemPromoCode(telegramId: number, code: string): Promise<PromoRedeemResult> {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, normalizedCode)).for("update").limit(1);
    if (!promo) return { ok: false, reason: "invalid" };
    if (!promo.isActive) return { ok: false, reason: "inactive" };
    if (promo.expiresAt && promo.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
    if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) return { ok: false, reason: "limit" };
    const [user] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, telegramId)).for("update").limit(1);
    if (!user) return { ok: false, reason: "unregistered" };
    const [existing] = await tx.select({ id: promoRedemptions.id }).from(promoRedemptions)
      .where(and(eq(promoRedemptions.promoCodeId, promo.id), eq(promoRedemptions.telegramId, telegramId))).limit(1);
    if (existing) return { ok: false, reason: "already" };
    const before = Number(user.playWalletBalance);
    const amount = Number(promo.rewardAmount).toFixed(2);
    const after = (before + Number(amount)).toFixed(2);
    const [redemption] = await tx.insert(promoRedemptions).values({ promoCodeId: promo.id, telegramId, rewardAmount: amount }).returning({ id: promoRedemptions.id });
    const reference = `promo:${promo.id}:user:${telegramId}`;
    await tx.insert(walletTransactions).values({
      telegramId,
      type: "adjustment",
      amount,
      balanceBefore: before.toFixed(2),
      balanceAfter: after,
      status: "completed",
      reference,
      metadata: { source: "promo_code", promoCodeId: promo.id, redemptionId: redemption.id },
    });
    await tx.update(telegramUsers).set({ playWalletBalance: after, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, telegramId));
    await tx.update(promoCodes).set({ redemptionCount: promo.redemptionCount + 1, updatedAt: new Date() }).where(eq(promoCodes.id, promo.id));
    return { ok: true, amount };
  });
}

function promoFailureMessage(reason: Exclude<PromoRedeemResult, { ok: true }>["reason"]) {
  return {
    invalid: "የPromo Code ኮዱ ትክክል አይደለም።",
    inactive: "ይህ Promo Code አሁን አክቲቭ አይደለም።",
    expired: "ይህ Promo Code ጊዜው አልፎበታል።",
    limit: "የዚህ Promo Code አጠቃቀም ቁጥር ሙሉ ሆኗል።",
    already: "ይህን Promo Code ቀደም ብለው ተጠቅመዋል።",
    unregistered: "እባክዎ መጀመሪያ ይመዝገቡ።",
  }[reason];
}

function requireAdmin(req: Request, res: Response) {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return undefined;
  }
  const adminUserId = getAdminUserId();
  if (!adminUserId || user.id !== adminUserId) {
    res.status(403).json({ error: "Admin access is required" });
    return undefined;
  }
  return { user, adminChatId: getAdminChatId() ?? adminUserId };
}

function parseEditableGameSettings(value: unknown): EditableGameSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const settings = value as Record<string, unknown>;
  const percentageFields = ["mainPrizePercentage", "leaderboardPoolPercentage", "leaderboardFirstPercentage", "leaderboardSecondPercentage", "leaderboardThirdPercentage"] as const;
  const bonusFields = ["registrationBonus", "inviteBonus"] as const;
  const supportUsername = typeof settings.supportUsername === "string" ? settings.supportUsername.trim() : "";
  const depositBonusPercentage = Number(settings.depositBonusPercentage);
  const pointFields = ["leaderboardCardPurchasePoints", "leaderboardCardReleasePoints", "leaderboardWinPoints"] as const;
  const parsedPercentages = Object.fromEntries(percentageFields.map((field) => [field, Number(settings[field])])) as Record<typeof percentageFields[number], number>;
  const parsedBonuses = Object.fromEntries(bonusFields.map((field) => [field, Number(settings[field])])) as Record<typeof bonusFields[number], number>;
  const parsedPoints = Object.fromEntries(pointFields.map((field) => [field, Number(settings[field])])) as Record<typeof pointFields[number], number>;
  const maxCardsPerPlayer = Number(settings.maxCardsPerPlayer);
  if (percentageFields.some((field) => !Number.isFinite(parsedPercentages[field]) || parsedPercentages[field] < 0 || parsedPercentages[field] > 100)) return undefined;
  if (!Number.isFinite(depositBonusPercentage) || depositBonusPercentage < 0 || depositBonusPercentage > 100) return undefined;
  if (bonusFields.some((field) => !Number.isFinite(parsedBonuses[field]) || parsedBonuses[field] < 0 || parsedBonuses[field] > 100_000)) return undefined;
  if (pointFields.some((field) => !Number.isInteger(parsedPoints[field]) || parsedPoints[field] < -100 || parsedPoints[field] > 100)) return undefined;
  if (!Number.isInteger(maxCardsPerPlayer) || maxCardsPerPlayer < 1 || maxCardsPerPlayer > 500) return undefined;
  if (!supportUsername) return undefined;
  if (parsedPercentages.mainPrizePercentage + parsedPercentages.leaderboardPoolPercentage > 100 || Math.abs(parsedPercentages.leaderboardFirstPercentage + parsedPercentages.leaderboardSecondPercentage + parsedPercentages.leaderboardThirdPercentage - 100) > 0.001) return undefined;
  return {
    registrationBonus: parsedBonuses.registrationBonus.toFixed(2),
    inviteBonus: parsedBonuses.inviteBonus.toFixed(2),
    supportUsername: supportUsername.startsWith("@") ? supportUsername : `@${supportUsername}`,
    depositBonusPercentage: depositBonusPercentage.toFixed(2),
    ...Object.fromEntries(percentageFields.map((field) => [field, parsedPercentages[field].toFixed(2)])),
    maxCardsPerPlayer: String(maxCardsPerPlayer),
    ...Object.fromEntries(pointFields.map((field) => [field, parsedPoints[field].toFixed(2)])),
  } as EditableGameSettings;
}

router.post("/telegram/promo/redeem", async (req, res) => {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return;
  }
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const result = await redeemPromoCode(user.id, code);
  if (!result.ok) {
    res.status(400).json({ error: promoFailureMessage(result.reason) });
    return;
  }
  res.json({ success: true, amount: result.amount });
});

router.post("/telegram/referral-agent/apply", async (req, res) => {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return;
  }
  const profile = await db.query.telegramUsers.findFirst({ where: eq(telegramUsers.telegramId, user.id), columns: { telegramId: true } });
  if (!profile) {
    res.status(400).json({ error: "Please register before applying to become an agent." });
    return;
  }
  const [existing] = await db.select().from(referralAgents).where(eq(referralAgents.telegramId, user.id)).limit(1);
  if (existing) {
    res.json(existing);
    return;
  }
  const code = `AG${createHash("sha256").update(`${user.id}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 10).toUpperCase()}`;
  const [agent] = await db.insert(referralAgents).values({ telegramId: user.id, code }).returning();
  res.status(201).json(agent);
});

router.get("/telegram/referral-agent/me", async (req, res) => {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return;
  }
  const [agent] = await db.select().from(referralAgents).where(eq(referralAgents.telegramId, user.id)).limit(1);
  if (!agent) {
    res.json({ agent: null });
    return;
  }
  const [attributionSummary, commissionSummary, commissions, withdrawals, agentUser, bot] = await Promise.all([
    db.select({ count: sql<string>`count(*)` }).from(referralAgentAttributions).where(eq(referralAgentAttributions.agentId, agent.id)),
    db.select({ depositTotal: sql<string>`coalesce(sum(${referralAgentCommissions.depositAmount}), 0)`, commissionTotal: sql<string>`coalesce(sum(${referralAgentCommissions.commissionAmount}), 0)` }).from(referralAgentCommissions).where(eq(referralAgentCommissions.agentId, agent.id)),
    db.select().from(referralAgentCommissions).where(eq(referralAgentCommissions.agentId, agent.id)).orderBy(desc(referralAgentCommissions.createdAt)).limit(20),
    db.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.telegramId, agent.telegramId), eq(withdrawalRequests.walletType, "agent"))).orderBy(desc(withdrawalRequests.createdAt)).limit(20),
    db.query.telegramUsers.findFirst({ where: eq(telegramUsers.telegramId, agent.telegramId), columns: { agentWalletBalance: true } }),
    telegramRequest<{ username?: string }>("getMe", {}),
  ]);
  const referralLink = bot.username ? new URL(`https://t.me/${bot.username}?start=agent_${agent.code}`).toString() : null;
  res.json({
    agent,
    referralLink,
    stats: { referrals: Number(attributionSummary[0]?.count ?? 0), depositTotal: commissionSummary[0]?.depositTotal ?? "0.00", commissionTotal: commissionSummary[0]?.commissionTotal ?? "0.00", agentWalletBalance: agentUser?.agentWalletBalance ?? "0.00" },
    commissions,
    withdrawals,
  });
});

router.post("/telegram/referral-agent/withdraw", async (req, res) => {
  const user = getAuthenticatedTelegramUser(req);
  if (!user) {
    res.status(401).json({ error: "Valid Telegram authentication is required" });
    return;
  }
  const agent = await db.query.referralAgents.findFirst({ where: and(eq(referralAgents.telegramId, user.id), eq(referralAgents.status, "active")) });
  if (!agent) {
    res.status(403).json({ error: "Your agent account is not active." });
    return;
  }
  const amount = Number(req.body?.amount);
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const ownerName = typeof req.body?.ownerName === "string" ? req.body.ownerName.trim() : "";
  if (!Number.isSafeInteger(amount) || amount < 100 || !/^09\d{8}$/.test(phone) || !ownerName || ownerName.length > 100) {
    res.status(400).json({ error: "Enter a valid amount of at least 100 ETB, Telebirr number, and account owner name." });
    return;
  }
  const request = await db.transaction(async (tx) => {
    const profile = (await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, user.id)).for("update").limit(1))[0];
    if (!profile || Number(profile.agentWalletBalance) < amount) return { error: "Your agent wallet balance is insufficient." as const };
    const [inserted] = await tx.insert(withdrawalRequests).values({
      telegramId: user.id,
      amount: amount.toFixed(2),
      phone,
      ownerName,
      walletType: "agent",
      status: "pending",
    }).onConflictDoNothing({ target: [withdrawalRequests.telegramId, withdrawalRequests.amount, withdrawalRequests.phone, withdrawalRequests.ownerName] }).returning({ id: withdrawalRequests.id });
    if (!inserted) return { duplicate: true as const };
    const balanceBefore = Number(profile.agentWalletBalance);
    const balanceAfter = (balanceBefore - amount).toFixed(2);
    await tx.insert(walletTransactions).values({ telegramId: user.id, type: "withdrawal", amount: amount.toFixed(2), balanceBefore: balanceBefore.toFixed(2), balanceAfter, status: "pending", reference: `agent-withdrawal-request-${inserted.id}`, metadata: { source: "agent_withdrawal", wallet: "agent", withdrawalRequestId: inserted.id } });
    await tx.update(telegramUsers).set({ agentWalletBalance: balanceAfter, updatedAt: new Date() }).where(eq(telegramUsers.telegramId, user.id));
    return { id: inserted.id };
  });
  if ("error" in request) {
    res.status(400).json({ error: request.error });
    return;
  }
  if ("duplicate" in request) {
    res.status(409).json({ error: "This withdrawal request was already submitted." });
    return;
  }
  const adminChatId = getAdminChatId();
  if (adminChatId) await telegramRequest("sendMessage", {
    chat_id: adminChatId,
    text: `💸 አዲስ የAgent Wallet ወጪ ጥያቄ\n\nTelegram ID: ${user.id}\nመጠን: ${amount.toFixed(2)} ETB\nTelebirr ቁጥር: ${phone}\nየአካውንት ባለቤት: ${ownerName}`,
    reply_markup: getAdminApprovalKeyboard("withdrawal", request.id),
  });
  res.status(201).json({ id: request.id, status: "pending" });
});

router.get("/telegram/admin/referral-agents", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const [agents, users, attributionCounts, commissionTotals] = await Promise.all([
    db.select().from(referralAgents).orderBy(desc(referralAgents.createdAt)),
    db.select({ telegramId: telegramUsers.telegramId, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username, phoneNumber: telegramUsers.phoneNumber, agentWalletBalance: telegramUsers.agentWalletBalance }).from(telegramUsers),
    db.select({ agentId: referralAgentAttributions.agentId, count: sql<string>`count(*)` }).from(referralAgentAttributions).groupBy(referralAgentAttributions.agentId),
    db.select({ agentId: referralAgentCommissions.agentId, total: sql<string>`coalesce(sum(${referralAgentCommissions.commissionAmount}), 0)` }).from(referralAgentCommissions).groupBy(referralAgentCommissions.agentId),
  ]);
  const userById = new Map(users.map((item) => [item.telegramId, item]));
  const referralCountByAgent = new Map(attributionCounts.map((item) => [item.agentId, item.count]));
  const commissionTotalByAgent = new Map(commissionTotals.map((item) => [item.agentId, item.total]));
  res.json(agents.map((agent) => ({ ...agent, user: userById.get(agent.telegramId) ?? null, referralCount: Number(referralCountByAgent.get(agent.id) ?? 0), commissionTotal: commissionTotalByAgent.get(agent.id) ?? "0.00" })));
});

router.post("/telegram/admin/referral-agents/:id/:action", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);
  const action = req.params.action;
  const commissionRate = Number((req.body as { commissionRate?: unknown })?.commissionRate);
  if (!Number.isSafeInteger(id) || id <= 0 || (action !== "activate" && action !== "suspend" && action !== "rate")) {
    res.status(400).json({ error: "Invalid agent action" });
    return;
  }
  if (action === "rate" && (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100)) {
    res.status(400).json({ error: "Commission rate must be between 0 and 100." });
    return;
  }
  const now = new Date();
  const [agent] = await db.update(referralAgents).set({
    ...(action === "activate" ? { status: "active" as const, activatedByTelegramId: admin.user.id, activatedAt: now } : {}),
    ...(action === "suspend" ? { status: "suspended" as const } : {}),
    ...(action === "rate" ? { commissionRate: commissionRate.toFixed(2) } : {}),
    updatedAt: now,
  }).where(eq(referralAgents.id, id)).returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

router.get("/telegram/admin/promos", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)));
});

router.post("/telegram/admin/promos", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = req.body as { code?: unknown; rewardAmount?: unknown; maxRedemptions?: unknown; expiresAt?: unknown };
  const code = typeof body.code === "string" ? normalizePromoCode(body.code) : "";
  const rewardAmount = typeof body.rewardAmount === "string" || typeof body.rewardAmount === "number" ? Number(body.rewardAmount) : NaN;
  const maxRedemptions = body.maxRedemptions === "" || body.maxRedemptions === null || body.maxRedemptions === undefined ? null : Number(body.maxRedemptions);
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  if (!/^[A-Z0-9_-]{3,64}$/.test(code) || !Number.isFinite(rewardAmount) || rewardAmount <= 0 || rewardAmount > 100_000 || (maxRedemptions !== null && (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1)) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    res.status(400).json({ error: "Enter a valid code, reward amount, redemption limit, and expiration date." });
    return;
  }
  try {
    const [promo] = await db.insert(promoCodes).values({ code, rewardAmount: rewardAmount.toFixed(2), maxRedemptions, expiresAt, createdByTelegramId: admin.user.id, isActive: false }).returning();
    res.status(201).json(promo);
  } catch (error) {
    if (error instanceof Error && /promo_codes_code_idx|duplicate key/i.test(error.message)) {
      res.status(409).json({ error: "ይህ Promo Code አስቀድሞ አለ።" });
      return;
    }
    throw error;
  }
});

router.post("/telegram/admin/promos/:id/:action", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const action = req.params.action;
  if (!Number.isSafeInteger(id) || id <= 0 || (action !== "activate" && action !== "deactivate")) {
    res.status(400).json({ error: "Invalid promo action" });
    return;
  }
  const [promo] = await db.update(promoCodes).set({ isActive: action === "activate", updatedAt: new Date() }).where(eq(promoCodes.id, id)).returning();
  if (!promo) {
    res.status(404).json({ error: "Promo Code not found" });
    return;
  }
  res.json(promo);
});

router.get("/telegram/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const [activeRound] = await db.select({ id: bingoRounds.id, status: bingoRounds.status, startedAt: bingoRounds.startedAt, completedAt: bingoRounds.completedAt }).from(bingoRounds)
    .where(or(eq(bingoRounds.status, "selecting"), eq(bingoRounds.status, "playing"))).orderBy(desc(bingoRounds.startedAt)).limit(1);
  const [users, activeCalls] = await Promise.all([
    db.select({
    telegramId: telegramUsers.telegramId,
    chatId: telegramUsers.chatId,
    firstName: telegramUsers.firstName,
    lastName: telegramUsers.lastName,
    username: telegramUsers.username,
    phoneNumber: telegramUsers.phoneNumber,
    languageCode: telegramUsers.languageCode,
    playWalletBalance: telegramUsers.playWalletBalance,
    winWalletBalance: telegramUsers.winWalletBalance,
    createdAt: telegramUsers.createdAt,
    updatedAt: telegramUsers.updatedAt,
    }).from(telegramUsers).orderBy(desc(telegramUsers.createdAt)),
    activeRound ? db.select({ number: bingoCalls.number }).from(bingoCalls).where(eq(bingoCalls.roundId, activeRound.id)).orderBy(desc(bingoCalls.position)) : Promise.resolve([]),
  ]);
  const cards = activeRound ? await db.select({ telegramId: bingoPlayerCards.telegramId, cardNumber: bingoPlayerCards.cardNumber, selectedAt: bingoPlayerCards.selectedAt }).from(bingoPlayerCards).where(eq(bingoPlayerCards.roundId, activeRound.id)) : [];
  res.json(users.map((user) => ({
    ...user,
    gameStatus: activeRound?.status ?? "no-active-game",
    activeRoundId: activeRound?.id ?? null,
    activeRoundStartedAt: activeRound?.startedAt ?? null,
    activeRoundCards: cards.filter((card) => card.telegramId === user.telegramId).map((card) => card.cardNumber),
    lastCardSelectedAt: cards.filter((card) => card.telegramId === user.telegramId).sort((left, right) => right.selectedAt.getTime() - left.selectedAt.getTime())[0]?.selectedAt ?? null,
    calledBalls: activeCalls.map((call) => call.number),
  })));
});

router.post("/telegram/admin/broadcast", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = req.body as { photo?: unknown; caption?: unknown };
  const photo = typeof body.photo === "string" ? body.photo.trim() : "";
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const webAppUrl = getWebAppUrl();
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 7_000_000 || !caption || caption.length > 1_024 || !webAppUrl) {
    res.status(400).json({ error: "Upload a JPEG, PNG, or WebP image up to 5 MB, enter message text, and configure the web app URL." });
    return;
  }

  const recipients = await db.select({ chatId: telegramUsers.chatId }).from(telegramUsers);
  const chatIds = [...new Set(recipients.map(({ chatId }) => chatId))];
  let sent = 0;
  let failed = 0;
  for (const chatId of chatIds) {
    try {
      await telegramPhotoRequest(photo, {
        chat_id: String(chatId),
        caption,
        reply_markup: JSON.stringify({
          inline_keyboard: [[{ text: "Play Now", web_app: { url: webAppUrl } }]],
        }),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, chatId }, "Telegram broadcast delivery failed");
    }
  }
  res.json({ targeted: chatIds.length, sent, failed });
});

router.get("/telegram/admin/settings", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(await getGameSettings());
});

router.put("/telegram/admin/settings", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const settings = parseEditableGameSettings(req.body);
  if (!settings) {
    res.status(400).json({ error: "Enter valid bonuses and percentages. Leaderboard prizes must total 100%, and main plus leaderboard pool cannot exceed 100%." });
    return;
  }
  const [updated] = await db.insert(gameSettings).values({ id: 1, ...settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: gameSettings.id, set: { ...settings, updatedAt: new Date() } }).returning();
  res.json(updated);
});

router.post("/telegram/admin/users/:telegramId/balance-adjustment", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const telegramId = Number(req.params.telegramId);
  const wallet = req.body?.wallet === "win" ? "win" : req.body?.wallet === "play" ? "play" : undefined;
  const amount = Number(req.body?.amount);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isSafeInteger(telegramId) || !wallet || !Number.isFinite(amount) || amount === 0 || !reason || reason.length > 200) {
    res.status(400).json({ error: "Enter a valid wallet, amount, and reason." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(telegramUsers).where(eq(telegramUsers.telegramId, telegramId)).for("update").limit(1);
    if (!user) return undefined;
    const field = wallet === "play" ? "playWalletBalance" : "winWalletBalance";
    const before = Number(user[field]);
    const after = before + amount;
    if (after < 0) throw new Error("Balance cannot be negative");
    await tx.update(telegramUsers).set({ [field]: after.toFixed(2), updatedAt: new Date() }).where(eq(telegramUsers.telegramId, telegramId));
    await tx.insert(walletTransactions).values({ telegramId, type: "adjustment", amount: amount.toFixed(2), balanceBefore: before.toFixed(2), balanceAfter: after.toFixed(2), status: "completed", reference: `admin-adjustment:${Date.now()}:${telegramId}`, metadata: { source: "admin", wallet, reason, approvedBy: admin.user.id } });
    return { wallet, before: before.toFixed(2), after: after.toFixed(2) };
  });
  if (!result) { res.status(404).json({ error: "User not found" }); return; }
  res.json(result);
});

router.get("/telegram/admin/requests", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const [deposits, withdrawals, appWallet] = await Promise.all([
    db.query.depositRequests.findMany({
      where: eq(depositRequests.status, "pending"),
      orderBy: [desc(depositRequests.createdAt)],
    }),
    db.query.withdrawalRequests.findMany({
      where: eq(withdrawalRequests.status, "pending"),
      orderBy: [desc(withdrawalRequests.createdAt)],
    }),
    db.select({ balance: sql<string>`coalesce(sum(${appWalletTransactions.amount}), 0)` }).from(appWalletTransactions),
  ]);
  res.json({ deposits, withdrawals, appWalletBalance: appWallet[0]?.balance ?? "0.00" });
});

router.post("/telegram/admin/requests/:type/:id/:action", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const type = req.params.type;
  const action = req.params.action;
  const id = Number(req.params.id);
  if ((type !== "deposit" && type !== "withdrawal") || (action !== "approve" && action !== "reject") || !Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid admin request action" });
    return;
  }
  await processAdminDecision(type, action, id, admin.adminChatId);
  res.json({ success: true });
});

function parseTelebirrDepositSms(text: string) {
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  const amountMatch = normalizedText.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*ብር/);
  const transactionMatch = normalizedText.match(/(?:የሂሳብ\s+እንቅስቃሴ\s+ቁጥርዎ|transaction\s*(?:id|number))\s*[:#]?\s*([A-Z0-9]+)/i);
  if (!amountMatch || !transactionMatch) return undefined;
  const amount = Number(amountMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount: amount.toFixed(2), transactionId: transactionMatch[1].toUpperCase() };
}

router.post("/telegram/sms-webhook", async (req, res) => {
  const configuredSecret = process.env["TELEGRAM_SMS_WEBHOOK_SECRET"]?.trim();
  if (!configuredSecret || req.header("x-sms-webhook-secret") !== configuredSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const message = ["message", "msg", "text", "body", "messageBody", "content"].map((key) => body[key]).find((value): value is string => typeof value === "string") ?? Object.values(body).filter((value): value is string => typeof value === "string").join("\\n");
  const sender = ["sender", "from", "incomingNumber", "senderNumber"].map((key) => body[key]).find((value): value is string => typeof value === "string") ?? message.match(/(?:from|sender)\s*:?\s*(\+?[0-9]+)/i)?.[1];
  const allowedSender = process.env["TELEGRAM_SMS_SENDER"]?.trim();
  if (allowedSender && sender && sender !== allowedSender) {
    res.status(202).json({ matched: false });
    return;
  }
  const parsed = parseTelebirrDepositSms(message);
  if (!parsed) {
    res.status(400).json({ error: "Unsupported Telebirr SMS format" });
    return;
  }
  const [request] = await db.select({ id: depositRequests.id, amount: depositRequests.amount }).from(depositRequests)
    .where(and(eq(depositRequests.status, "pending"), eq(depositRequests.transactionId, parsed.transactionId))).for("update").limit(1);
  if (!request || Number(request.amount).toFixed(2) !== parsed.amount) {
    res.status(202).json({ matched: false, transactionId: parsed.transactionId });
    return;
  }
  const adminChatId = getAdminChatId();
  if (!adminChatId) {
    res.status(503).json({ error: "TELEGRAM_ADMIN_CHAT_ID is not configured" });
    return;
  }
  await processAdminDecision("deposit", "approve", request.id, adminChatId);
  res.json({ matched: true, requestId: request.id, amount: parsed.amount, transactionId: parsed.transactionId });
});

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function startTelegramPolling() {
  const globalState = globalThis as typeof globalThis & { __telegramPolling?: boolean };
  if (globalState.__telegramPolling) return;
  globalState.__telegramPolling = true;
  void (async () => {
    const token = getBotToken();
    if (!token) {
      logger.warn("Telegram polling skipped because TELEGRAM_BOT_TOKEN is missing");
      return;
    }

    try {
      await telegramRequest("deleteWebhook", { drop_pending_updates: false });
      const bot = await telegramRequest<{ username?: string }>("getMe", {});
      logger.info({ botUsername: bot.username ?? "unknown" }, "Telegram webhook deleted; long polling started");
    } catch (error) {
      logger.error({ err: error }, "Telegram polling could not initialize");
    }

    let offset = 0;
    while (true) {
      try {
        const updates = await telegramRequest<TelegramPollingUpdate[]>("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"],
        });
        logger.info({ updateCount: updates.length, offset }, "Telegram polling response received");
        offset = updates.reduce((latest, update) => Math.max(latest, update.update_id + 1), offset);
        await Promise.all(updates.map(async (update) => {
          try {
            await handleTelegramUpdate(update);
          } catch (error) {
            logger.error({ err: error, updateId: update.update_id }, "Telegram polling update handling failed");
          }
        }));
      } catch (error) {
        logger.error({ err: error }, "Telegram polling request failed");
        await sleep(5000);
      }
    }
  })();
}

export async function registerTelegramWebhook() {
  const token = getBotToken();
  const webhookUrl = getWebhookUrl();
  const webAppUrl = getWebAppUrl();
  if (!token || !webhookUrl) {
    logger.warn(
      { hasBotToken: Boolean(token), hasWebhookUrl: Boolean(webhookUrl) },
      "Telegram webhook registration skipped because required configuration is incomplete",
    );
    return;
  }

  if (!webAppUrl) {
    logger.warn("Telegram Mini App URL is not configured; webhook will still be registered");
  }

  const secretToken = getWebhookSecret();
  logger.info({ webhookUrl, hasSecretToken: Boolean(secretToken), hasWebAppUrl: Boolean(webAppUrl) }, "Registering Telegram webhook");
  await telegramRequest("setWebhook", {
    url: webhookUrl,
    ...(secretToken ? { secret_token: secretToken } : {}),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });

  const optionalSetup = [
    ...(webAppUrl
      ? [{
          method: "setChatMenuButton",
          body: {
            menu_button: { type: "web_app", text: "Venom Bingo", web_app: { url: webAppUrl } },
          },
        }]
      : []),
    {
      method: "setMyCommands",
      body: {
        commands: [
          { command: "start", description: "Venom Bingo ክፈት" },
          { command: "register", description: "Register" },
          { command: "play", description: "Play Bingo" },
          { command: "deposit", description: "Deposit" },
          { command: "withdraw", description: "Withdraw" },
          { command: "invite", description: "Invite & Earn" },
          { command: "help", description: "Support" },
        ],
      },
    },
  ] as const;

  for (const setup of optionalSetup) {
    try {
      await telegramRequest(setup.method, setup.body);
    } catch (error) {
      logger.warn({ err: error, method: setup.method }, "Optional Telegram bot setup failed");
    }
  }

  logger.info({ hasWebAppUrl: Boolean(webAppUrl) }, "Telegram webhook registered");
}

export default router;
