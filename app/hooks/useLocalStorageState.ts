import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

function getRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseStored<T>(raw: string | null, defaultValue: T): T {
  if (raw === null) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function persist<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return;
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Like useState<T>, but persists updates under `key` in localStorage as JSON.
 * `defaultValue` is used when there is no stored value or parsing fails; it is
 * not written to storage until the setter runs.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() =>
    parseStored(getRaw(key), defaultValue),
  );

  const setValue = useCallback(
    (action: SetStateAction<T>) => {
      setState((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: T) => T)(prev)
            : action;
        persist(key, next);
        return next;
      });
    },
    [key],
  );

  return [state, setValue];
}
