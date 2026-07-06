import pino, { type Logger as PinoLogger } from "pino";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type { LogLevel } from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";

const pinoLevelByLogLevel: Record<LogLevel, string> = {
  silent: "silent",
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
};

export class PinoAppLogger implements AppLogger {
  private readonly logger: PinoLogger;

  constructor(readonly level: LogLevel = "info") {
    this.logger = pino({
      name: "yandex-maps-place-reviews",
      level: pinoLevelByLogLevel[level],
    });
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }

  private write(level: "error" | "warn" | "info" | "debug", message: string, meta?: unknown): void {
    if (meta === undefined) {
      this.logger[level](message);
      return;
    }

    this.logger[level](meta, message);
  }
}
