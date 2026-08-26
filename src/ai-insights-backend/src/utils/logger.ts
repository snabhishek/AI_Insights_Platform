/**
 * Centralized Timestamped Logger Utility
 * Automatically formats all console outputs with [YYYY-MM-DD HH:mm:ss.SSS] timestamps.
 */

export function getFormattedTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

let isPatched = false;

export function setupTimestampedLogging(): void {
  if (isPatched) return;
  isPatched = true;

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: any[]) => {
    originalLog(`[${getFormattedTimestamp()}]`, ...args);
  };

  console.info = (...args: any[]) => {
    originalInfo(`[${getFormattedTimestamp()}]`, ...args);
  };

  console.warn = (...args: any[]) => {
    originalWarn(`[${getFormattedTimestamp()}]`, ...args);
  };

  console.error = (...args: any[]) => {
    originalError(`[${getFormattedTimestamp()}]`, ...args);
  };
}
