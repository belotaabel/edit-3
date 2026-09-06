import { Router, type IRouter } from "express";
import healthRouter from "./health";
import telegramRouter from "./telegram";
import bingoRouter from "./bingo";
import leaderboardRouter from "./leaderboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(telegramRouter);
router.use(bingoRouter);
router.use(leaderboardRouter);

export default router;
