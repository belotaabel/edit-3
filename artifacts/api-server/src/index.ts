import app, { attachRealtimeServer } from "./app";
import { logger } from "./lib/logger";
import { registerTelegramWebhook } from "./routes/telegram";
import { startBingoRoundInterval } from "./routes/bingo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  attachRealtimeServer(server);
  startBingoRoundInterval();
  void registerTelegramWebhook().catch((error) => {
    logger.error({ err: error }, "Telegram webhook registration failed");
  });
});
