const CAMBODIA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DEFAULT_SCHEDULE_TIME_ZONE = "Asia/Phnom_Penh";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getScheduleTimeZone() {
  const configured = String(
    process.env.SCHEDULE_TIMEZONE || process.env.APP_TIMEZONE || DEFAULT_SCHEDULE_TIME_ZONE
  ).trim();
  return configured || DEFAULT_SCHEDULE_TIME_ZONE;
}

// Cambodia does not observe DST, so a fixed UTC+7 offset keeps scheduler math stable.
export function toScheduleWallClock(date: Date) {
  return new Date(date.getTime() + CAMBODIA_UTC_OFFSET_MS);
}

export function fromScheduleWallClock(date: Date) {
  return new Date(date.getTime() - CAMBODIA_UTC_OFFSET_MS);
}

export function formatDateTimeForDatabase(date: Date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-") + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}
