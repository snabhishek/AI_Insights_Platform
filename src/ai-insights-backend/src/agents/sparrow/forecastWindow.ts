import { TimeRangeContext } from "./types";

export function normalizeForecastFrequency(frequency: string): string {
  const frequencies: Record<string, string> = { month: "Monthly", months: "Monthly", monthly: "Monthly",
    week: "Weekly", weeks: "Weekly", weekly: "Weekly", year: "Yearly", years: "Yearly", yearly: "Yearly" };
  return frequencies[frequency.toLowerCase().trim()] ?? frequency;
}

export function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Expected a date in YYYY-MM-DD format.");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid forecast date.");
  return date;
}

export function periodStart(date: Date, frequency: string): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  if (frequency === "Monthly") result.setUTCDate(1);
  else if (frequency === "Yearly") result.setUTCMonth(0, 1);
  else if (frequency === "Weekly") result.setUTCDate(result.getUTCDate() - (result.getUTCDay() + 6) % 7);
  else throw new Error("Unsupported forecast frequency.");
  return result;
}

export function advancePeriod(date: Date, frequency: string, count = 1): Date {
  const result = periodStart(date, frequency);
  if (frequency === "Monthly") result.setUTCMonth(result.getUTCMonth() + count);
  if (frequency === "Yearly") result.setUTCFullYear(result.getUTCFullYear() + count);
  if (frequency === "Weekly") result.setUTCDate(result.getUTCDate() + 7 * count);
  return result;
}

export function resolveForecastRange(range: TimeRangeContext | undefined, now: number): TimeRangeContext | undefined {
  if (!range?.frequency || !range.horizon) return range;
  const frequency = normalizeForecastFrequency(range.frequency);
  if (!["Monthly", "Weekly", "Yearly"].includes(frequency)) return range;
  if (range.anchor === "latest_data") return { ...range, frequency };
  // Calendar-relative requests are anchored to the request clock, never the project objective.
  const start = range.anchor === "calendar" || !range.startDate
    ? advancePeriod(new Date(now), frequency) : periodStart(dateOnly(range.startDate), frequency);
  return { ...range, frequency, startDate: start.toISOString().slice(0, 10),
    endDate: new Date(advancePeriod(start, frequency, range.horizon).getTime() - 86400000).toISOString().slice(0, 10) };
}

export function forecastWindow(origin: string, requestedStart: string, horizon: number, frequency: string) {
  const executionStart = periodStart(dateOnly(origin), frequency);
  const displayStart = periodStart(dateOnly(requestedStart), frequency);
  if (displayStart < executionStart) throw new Error("Requested forecast precedes the available inference origin.");
  let bridgePeriods = 0;
  while (advancePeriod(executionStart, frequency, bridgePeriods) < displayStart && bridgePeriods < 1000) bridgePeriods++;
  const executionHorizon = bridgePeriods + horizon;
  if (executionHorizon > 1000) throw new Error("Forecast including the data gap exceeds the supported 1000 periods.");
  const displayEnd = advancePeriod(displayStart, frequency, horizon);
  return { executionStart, displayStart, displayEnd, executionHorizon, bridgePeriods };
}

export function selectForecastPeriods(chart: any, start: Date, end: Date, horizon: number, frequency: string) {
  if (!Array.isArray(chart?.dates) || !Array.isArray(chart?.predictedSeries) || chart.dates.length !== chart.predictedSeries.length) {
    throw new Error("Inference returned no aligned dated predictions for the requested window.");
  }
  const rows = chart.dates.map((value: string, index: number) => ({
    period: periodStart(dateOnly(String(value).slice(0, 10)), frequency).toISOString().slice(0, 10),
    predicted: chart.predictedSeries[index],
  })).filter((row: any) => row.period >= start.toISOString().slice(0, 10) && row.period < end.toISOString().slice(0, 10));
  const expected = Array.from({ length: horizon }, (_, index) => advancePeriod(start, frequency, index).toISOString().slice(0, 10));
  if (rows.length !== horizon || expected.some(period => rows.filter((row: any) => row.period === period).length !== 1)
    || rows.some((row: any) => typeof row.predicted !== "number" || !Number.isFinite(row.predicted))) {
    throw new Error("Inference did not cover every requested forecast period; missing values cannot be fabricated.");
  }
  return rows.sort((a: any, b: any) => a.period.localeCompare(b.period));
}
