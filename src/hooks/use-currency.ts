"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CurrencyCode, DEFAULT_CURRENCY, formatMoney as formatMoneyRaw, normaliseCurrency } from "@/lib/currency";

/** Active-org display currency. Safe default GBP until the session loads / column exists. */
export function useOrgCurrency(): CurrencyCode {
  const { data } = useQuery({
    queryKey: ["me", "currency"],
    queryFn: async () => {
      const res = await fetch("/api/me/currency");
      if (!res.ok) return { currency: DEFAULT_CURRENCY };
      const json = await res.json();
      return json.data || { currency: DEFAULT_CURRENCY };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return normaliseCurrency(data?.currency);
}

/** Convenience: formatter bound to the current org's currency. */
export function useFormatMoney() {
  const currency = useOrgCurrency();
  return (amount: number | null | undefined, opts?: { compact?: boolean; decimals?: 0 | 2 }) =>
    formatMoneyRaw(amount, currency, opts);
}

export function useUpdateOrgCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (currency: CurrencyCode) => {
      const res = await fetch("/api/me/currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency }),
      });
      if (!res.ok) throw new Error("Failed to update currency");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "currency"] }),
  });
}
