const DB_NAME = "rf-auth";
const STORE_NAME = "tokens";
const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";
export const AUTH_CHANGED_EVENT = "remote-auth-changed";

function emitAuthChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tokenTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Token transaction aborted"));
      work(tx.objectStore(STORE_NAME), (value) => {
        result = value;
      });
    });
  } finally {
    db.close();
  }
}

function get(key: string): Promise<string | null> {
  return tokenTransaction("readonly", (store, result) => {
    const request = store.get(key);
    request.onsuccess = () => result((request.result as string) ?? null);
  });
}

function writeTokens(
  store: IDBObjectStore,
  accessToken: string,
  refreshToken: string,
) {
  store.put(accessToken, ACCESS_TOKEN_KEY);
  store.put(refreshToken, REFRESH_TOKEN_KEY);
}

type SavedTokens = { accessToken: string | null; refreshToken: string | null };

function readTokenPair(remove: boolean): Promise<SavedTokens> {
  return tokenTransaction(
    remove ? "readwrite" : "readonly",
    (store, result) => {
      const access = store.get(ACCESS_TOKEN_KEY);
      const refresh = store.get(REFRESH_TOKEN_KEY);
      refresh.onsuccess = () =>
        result({
          accessToken: (access.result as string) ?? null,
          refreshToken: (refresh.result as string) ?? null,
        });
      if (remove) store.clear();
    },
  );
}

export async function storeTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await tokenTransaction<void>("readwrite", (store) => {
    writeTokens(store, accessToken, refreshToken);
  });
  emitAuthChanged();
}

export async function updateTokensFromRefresh(
  expectedRefreshToken: string,
  tokens: { accessToken: string; refreshToken: string } | null,
): Promise<boolean> {
  const updated = await tokenTransaction<boolean>(
    "readwrite",
    (store, result) => {
      const request = store.get(REFRESH_TOKEN_KEY);
      request.onsuccess = () => {
        if (request.result !== expectedRefreshToken) {
          result(false);
          return;
        }
        if (tokens) {
          writeTokens(store, tokens.accessToken, tokens.refreshToken);
        } else {
          store.clear();
        }
        result(true);
      };
    },
  );
  if (updated) emitAuthChanged();
  return updated;
}

export function getAccessToken(): Promise<string | null> {
  return get(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): Promise<string | null> {
  return get(REFRESH_TOKEN_KEY);
}

export async function clearAccessToken(): Promise<void> {
  await tokenTransaction<void>("readwrite", (store) => {
    store.delete(ACCESS_TOKEN_KEY);
  });
}

export async function takeTokens(): Promise<SavedTokens> {
  const tokens = await readTokenPair(true);
  emitAuthChanged();
  return tokens;
}

export async function clearTokens(): Promise<void> {
  await takeTokens();
}

export async function isLoggedIn(): Promise<boolean> {
  const { accessToken, refreshToken } = await readTokenPair(false);
  return accessToken !== null && refreshToken !== null;
}
