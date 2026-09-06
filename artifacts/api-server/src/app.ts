import express, { type Express } from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getBingoRoundSnapshot, subscribeToBingoRoundUpdates } from "./routes/bingo";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const webAppDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../flash-bingo-mini-app/dist/public");
const webAppIndex = path.join(webAppDirectory, "index.html");
app.use(express.static(webAppDirectory));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  res.sendFile(webAppIndex);
});

type RoundSnapshot = Awaited<ReturnType<typeof getBingoRoundSnapshot>>;

function toGameState(snapshot: RoundSnapshot) {
  const phase = snapshot.status === "selecting" ? "waiting" : snapshot.status === "playing" ? "playing" : "finished";
  const countdown = snapshot.selectionEndsAt
    ? Math.max(0, Math.ceil((new Date(snapshot.selectionEndsAt).getTime() - Date.now()) / 1_000))
    : 0;
  return {
    roundId: snapshot.id,
    phase,
    countdown,
    selectionEndsAt: snapshot.selectionEndsAt?.toISOString() ?? null,
    currentBall: snapshot.calls.at(-1)?.number ?? null,
    calledBalls: snapshot.calls.map((call) => call.number),
    cardsTaken: snapshot.takenCardNumbers,
    playersWithCards: snapshot.takenCardNumbers.length,
    netPrizePool: Number(snapshot.pot),
    winner: snapshot.winner,
    winners: snapshot.winners,
  };
}

export function attachRealtimeServer(server: HttpServer) {
  const io = new Server(server, { path: "/api/socket.io", pingInterval: 10_000, pingTimeout: 60_000, cors: { origin: true, credentials: true } });
  let previousRoundId: number | undefined;
  let previousWinnerRoundId: number | undefined;
  const broadcastSnapshot = (snapshot: RoundSnapshot) => {
    const state = toGameState(snapshot);
    if (previousRoundId !== undefined && previousRoundId !== snapshot.id) io.emit("round_reset", { roundId: snapshot.id, countdown: state.countdown });
    previousRoundId = snapshot.id;
    io.emit("game_state", state);
    io.emit("cards_taken", { roundId: snapshot.id, cardIds: snapshot.takenCardNumbers });
    if (snapshot.winner && previousWinnerRoundId !== snapshot.id) {
      previousWinnerRoundId = snapshot.id;
      io.emit("winner", { roundId: snapshot.id, ...snapshot.winner, winners: snapshot.winners });
    }
  };
  subscribeToBingoRoundUpdates(broadcastSnapshot);
  io.on("connection", (socket) => {
    void getBingoRoundSnapshot().then(broadcastSnapshot).catch((error) => logger.error({ err: error }, "Failed to send initial Bingo state"));
    socket.on("select_card", () => undefined);
    socket.on("deselect_card", () => undefined);
  });
  logger.info("Bingo realtime server attached");
}

export default app;
