/** Age in completed years on `asOf` (default: now). Used by eligibility and pricing. */
export function calculateAge(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = asOf.getMonth() - dateOfBirth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  // Guard against month-end overflow (31 Jan + 1 month must not become 3 Mar).
  if (result.getDate() < targetDay) result.setDate(0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Stable, locale-independent display date for PDFs and emails: "14 Sep 2026". */
export function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
