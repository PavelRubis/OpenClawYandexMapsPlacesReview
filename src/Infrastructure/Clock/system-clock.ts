import type { Clock } from "../../Application/Dependencies/clock.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
