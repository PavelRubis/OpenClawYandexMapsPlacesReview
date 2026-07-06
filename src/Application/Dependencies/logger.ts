import type { LogLevel } from "../Dtos/yandex-maps-place-reviews.dto.js";

export interface AppLogger {
  level: LogLevel;
  error(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
}
