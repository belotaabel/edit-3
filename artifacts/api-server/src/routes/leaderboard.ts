import { Router, type IRouter, type Request } from "express";
import { getLeaderboardSnapshot } from "../lib/leaderboard";
import { isValidTelegramInitData, parseTelegramUser } from "./telegram";

const router: IRouter = Router();

function getTelegramId(req: Request) {
  const initData = req.header("x-telegram-init-data") ?? req.header("authorization")?.replace(/^tma\s+/i, "");
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  if (!initData || !token || !isValidTelegramInitData(initData, token)) return undefined;
  const user = parseTelegramUser(initData);
  return user && Number.isSafeInteger(user.id) && user.id > 0 ? user.id : undefined;
}

router.get("/leaderboard/current", async (req, res) => {
  try {
    res.json(await getLeaderboardSnapshot(getTelegramId(req)));
  } catch {
    res.status(503).json({ error: "Leaderboard unavailable" });
  }
});

export default router;
