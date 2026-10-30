/** Ad pack settings shared by every stop's pack in this browser tab: the user's ticket link and budget (their numbers). */
import { useSyncExternalStore } from "react";
import { BUDGET_DEFAULTS, type BudgetInputs } from "./ad-packs";

export interface AdSettings extends BudgetInputs { ticketUrl: string }
let state: AdSettings = { ...BUDGET_DEFAULTS, ticketUrl: "" };
const subs = new Set<() => void>();
export const setAdSettings = (p: Partial<AdSettings>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useAdSettings = () => useSyncExternalStore(subscribe, () => state, () => state);
