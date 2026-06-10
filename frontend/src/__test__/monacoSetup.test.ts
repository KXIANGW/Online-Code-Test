import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("monaco-editor", () => ({ id: "mock-monaco" }));

const mockLoaderConfig = vi.fn();
vi.mock("@monaco-editor/react", () => ({
  loader: { config: mockLoaderConfig },
}));

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: vi.fn(() => ({ terminate: vi.fn() })),
}));

type MonacoEnv = { getWorker: (_id: string, _label: string) => Worker };

describe("configureMonaco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (self as unknown as Record<string, unknown>).MonacoEnvironment = undefined;
  });

  afterEach(() => {
    (self as unknown as Record<string, unknown>).MonacoEnvironment = undefined;
  });

  it("should set MonacoEnvironment so Monaco does not fall back to CDN loader", async () => {
    // given
    const { configureMonaco } = await import("../utils/monacoSetup");

    // when
    configureMonaco();

    // expect
    expect(
      (self as unknown as { MonacoEnvironment: MonacoEnv }).MonacoEnvironment,
    ).toBeDefined();
  });

  it("should provide a Worker from getWorker so language features run locally", async () => {
    // given
    const { configureMonaco } = await import("../utils/monacoSetup");
    configureMonaco();

    // when
    const worker = (
      self as unknown as { MonacoEnvironment: MonacoEnv }
    ).MonacoEnvironment.getWorker("", "");

    // expect
    expect(worker).toBeDefined();
  });

  it("should pass local monaco module to loader.config so CDN is never contacted", async () => {
    // given
    const monaco = await import("monaco-editor");
    const { configureMonaco } = await import("../utils/monacoSetup");

    // when
    configureMonaco();

    // expect
    expect(mockLoaderConfig).toHaveBeenCalledOnce();
    expect(mockLoaderConfig).toHaveBeenCalledWith({ monaco });
  });
});
