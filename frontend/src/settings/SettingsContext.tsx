import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { settings as settingsApi } from '../api/endpoints';
import { EMPTY_SETTINGS } from '../types';
import type { SystemSettings, SystemSettingsUpdate } from '../types';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercentage,
  type CurrencySettings,
} from '../utils/format';

export interface SettingsContextValue {
  /** Runtime settings row; sensible defaults until the first fetch resolves. */
  settings: SystemSettings;
  /** True once the real row has been loaded at least once. */
  loaded: boolean;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
  /** PATCH /api/settings - requires settings.manage on the server. */
  update: (patch: SystemSettingsUpdate) => Promise<SystemSettings>;

  /* Settings-aware formatters, so no page hardcodes a currency or timezone. */
  money: (value: number | null | undefined) => string;
  amount: (value: number | null | undefined, decimals?: number) => string;
  number: (value: number | null | undefined, decimals?: number) => string;
  percent: (value: number | null | undefined, decimals?: number) => string;
  date: (value: string | null | undefined) => string;
  dateTime: (value: string | null | undefined) => string;
  currency: CurrencySettings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Loads GET /api/settings once a user is signed in and exposes both the raw
 * row and formatters bound to it (currency symbol, decimals, timezone).
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>(EMPTY_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const row = await settingsApi.get();
      setSettings(row);
      setLoaded(true);
      setError(null);
    } catch (cause) {
      // A failure here must not break the shell: pages fall back to the
      // default labels while currency/timezone formatting stays neutral.
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user === null) {
      setSettings(EMPTY_SETTINGS);
      setLoaded(false);
      return;
    }
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const row = await settingsApi.get();
        if (!active) return;
        setSettings(row);
        setLoaded(true);
        setError(null);
      } catch (cause) {
        if (!active) return;
        setError(cause);
      }
    };
    setLoading(true);
    void load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user]);

  const update = useCallback(async (patch: SystemSettingsUpdate): Promise<SystemSettings> => {
    const row = await settingsApi.update(patch);
    setSettings(row);
    setLoaded(true);
    setError(null);
    return row;
  }, []);

  const currency = useMemo<CurrencySettings>(
    () => ({
      currency_code: settings.currency_code,
      currency_symbol: settings.currency_symbol,
      currency_decimals: settings.currency_decimals,
    }),
    [settings.currency_code, settings.currency_symbol, settings.currency_decimals],
  );

  const timezone = settings.timezone;

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      loaded,
      loading,
      error,
      refresh,
      update,
      currency,
      money: (moneyValue) => formatMoney(moneyValue, currency),
      amount: (amountValue, decimals) => formatAmount(amountValue, decimals ?? currency.currency_decimals),
      number: (numberValue, decimals) => formatNumber(numberValue, decimals ?? 0),
      percent: (percentValue, decimals) => formatPercentage(percentValue, decimals ?? 0),
      date: (dateValue) => formatDate(dateValue, timezone),
      dateTime: (dateTimeValue) => formatDateTime(dateTimeValue, timezone),
    }),
    [settings, loaded, loading, error, refresh, update, currency, timezone],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** Access runtime settings and the bound formatters. */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context === null) {
    throw new Error('useSettings must be used inside <SettingsProvider>.');
  }
  return context;
}

export default SettingsProvider;
