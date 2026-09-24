import {
  DESKTOP_UPDATE_STATES,
  type DesktopUpdateStatusSnapshot,
} from "@open-design/sidecar-proto";

import type { DesktopUpdater, DesktopUpdaterLogger } from "../updater.js";

/**
 * @module updater-scheduler
 *
 * Recurring auto-check scheduling for the desktop updater: initial delay,
 * per-channel polling interval, and failure backoff. Owns no updater state
 * beyond timer bookkeeping.
 */

const MIN_SCHEDULED_POLL_DELAY_MS = 1000;

export type DesktopUpdaterScheduler = {
  isRunning(): boolean;
  start(): void;
  stop(reason?: string): void;
};

export function createDesktopUpdaterScheduler(
  updater: DesktopUpdater,
  options: {
    backoffInitialMs: number;
    backoffMaxMs: number;
    initialDelayMs: number;
    intervalMs: number;
    logger?: DesktopUpdaterLogger;
  },
): DesktopUpdaterScheduler {
  const logger = options.logger ?? console;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failureCount = 0;
  let tickRunning = false;
  let unsubscribe: (() => void) | null = null;
  let warnedZeroDelay = false;

  const clearTimer = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };

  const stop = (_reason?: string) => {
    if (!running && timer == null) return;
    running = false;
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
  };

  const normalizeScheduledDelay = (delayMs: number): number => {
    if (delayMs > 0) return delayMs;
    if (!warnedZeroDelay) {
      warnedZeroDelay = true;
      logger.warn(
        `[open-design updater] refusing non-positive scheduled poll delay (${delayMs}ms); `
          + `using ${MIN_SCHEDULED_POLL_DELAY_MS}ms floor`,
      );
    }
    return MIN_SCHEDULED_POLL_DELAY_MS;
  };

  const nextDelay = (status: DesktopUpdateStatusSnapshot | null): number => {
    if (status != null && status.state !== DESKTOP_UPDATE_STATES.ERROR && status.error == null) {
      failureCount = 0;
      return options.intervalMs;
    }
    failureCount += 1;
    const backoff = options.backoffInitialMs * 2 ** Math.max(0, failureCount - 1);
    return Math.min(options.backoffMaxMs, backoff);
  };

  const schedule = (delayMs: number) => {
    if (!running || timer != null) return;
    const boundedDelayMs = normalizeScheduledDelay(delayMs);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, boundedDelayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (!running || tickRunning) return;
    tickRunning = true;
    let status: DesktopUpdateStatusSnapshot | null = null;
    try {
      status = await updater.checkForUpdates();
      if (status.installResult != null) {
        stop("installer-opened");
        return;
      }
    } catch (error) {
      logger.warn("[open-design updater] scheduled update check failed", error);
    } finally {
      tickRunning = false;
    }
    if (running) schedule(nextDelay(status));
  };

  return {
    isRunning: () => running,
    start() {
      if (running) return;
      if (updater.snapshot().installResult != null) return;
      running = true;
      unsubscribe = updater.subscribe(() => {
        if (updater.snapshot().installResult != null) stop("installer-opened");
      });
      schedule(options.initialDelayMs);
    },
    stop,
  };
}
