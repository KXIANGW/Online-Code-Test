import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe(_target: Element) {
    /* noop — ResizeObserver interface mock for tests */
  }
  unobserve(_target: Element) {
    /* noop — ResizeObserver interface mock for tests */
  }
  disconnect() {
    /* noop — ResizeObserver interface mock for tests */
  }
}
globalThis.ResizeObserver = ResizeObserverMock;

// Node.js v22+ ships an experimental global localStorage backed by
// --localstorage-file.  When run without a valid file path (as in Vitest
// workers) it exists but is missing standard Storage methods such as clear().
// Replace it with a fully-spec-compliant in-memory implementation so all test
// files can call localStorage.clear(), removeItem(), etc. without errors.
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      let i = 0;
      for (const k of store.keys()) {
        if (i++ === index) return k;
      }
      return null;
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  } as unknown as Storage;
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
