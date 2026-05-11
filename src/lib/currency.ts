/**
 * Currency display + Stripe selection.
 *
 * Single source of truth for how money is shown across the app. Every page
 * that renders money should call formatMoney(amount, currency). The currency
 * usually comes from Organisation.currency (via useOrgCurrency() hook).
 */

export type CurrencyCode = "GBP" | "USD" | "EUR";

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ["GBP", "USD", "EUR"];
export const DEFAULT_CURRENCY: CurrencyCode = "GBP";

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

export const CURRENCY_NAME: Record<CurrencyCode, string> = {
  GBP: "British Pound",
  USD: "US Dollar",
  EUR: "Euro",
};

const CURRENCY_LOCALE: Record<CurrencyCode, string> = {
  GBP: "en-GB",
  USD: "en-US",
  EUR: "en-IE",
};

/** Normalise any string input to a supported currency code, defaulting to GBP. */
export function normaliseCurrency(c: string | null | undefined): CurrencyCode {
  if (!c) return DEFAULT_CURRENCY;
  const up = c.toUpperCase();
  return (SUPPORTED_CURRENCIES as string[]).includes(up) ? (up as CurrencyCode) : DEFAULT_CURRENCY;
}

/** Format a number as currency. Handles null/undefined/NaN gracefully. */
export function formatMoney(
  amount: number | null | undefined,
  currency: CurrencyCode | string | null = DEFAULT_CURRENCY,
  opts?: { compact?: boolean; decimals?: 0 | 2 },
): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "—";
  const code = normaliseCurrency(currency);
  const decimals = opts?.decimals ?? 0;

  if (opts?.compact) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";
    const sym = CURRENCY_SYMBOL[code];
    // Strip trailing ".0" so "10.0K" reads as "10K", but "9.5K" stays.
    // Earlier .toFixed(0) on the K branch turned 9,500 into "10K" — a loss
    // of precision the user noticed when an email-confirmed budget update
    // (£9,500) still rendered as "£10K" on every dashboard tile.
    const trim = (s: string) => s.replace(/\.0+$/, "");
    if (abs >= 1_000_000) return `${sign}${sym}${trim((abs / 1_000_000).toFixed(2))}M`;
    if (abs >= 10_000)    return `${sign}${sym}${trim((abs / 1_000).toFixed(0))}K`;
    if (abs >= 1_000)     return `${sign}${sym}${trim((abs / 1_000).toFixed(1))}K`;
    return `${sign}${sym}${abs.toLocaleString(CURRENCY_LOCALE[code])}`;
  }

  return new Intl.NumberFormat(CURRENCY_LOCALE[code], {
    style: "currency",
    currency: code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals === 0 ? 2 : decimals,
  }).format(amount);
}

/** Get just the currency symbol (for short labels like "Rate (£)"). */
export function currencySymbol(currency: CurrencyCode | string | null): string {
  return CURRENCY_SYMBOL[normaliseCurrency(currency)];
}

/** Lowercase ISO code for Stripe APIs (they use lowercase). */
export function stripeCurrency(currency: CurrencyCode | string | null): string {
  return normaliseCurrency(currency).toLowerCase();
}

/** UK orgs show "20% VAT" as a line item; other jurisdictions get a generic note. */
export function taxNote(currency: CurrencyCode | string | null): string {
  const code = normaliseCurrency(currency);
  if (code === "GBP") return "All prices are subject to 20% VAT.";
  if (code === "EUR") return "Prices exclude VAT — rate depends on your country.";
  return "Prices exclude any applicable sales tax.";
}
