import { describe, expect, test } from "vitest";
import { resolveDesktopRuntimeMode } from "../../src/main/runtime-mode.js";

describe("resolveDesktopRuntimeMode", () => {
  test("uses explicit NODE_ENV before Electron packaging state", () => {
    expect(resolveDesktopRuntimeMode({ isPackaged: true }, "development")).toBe("development");
    expect(resolveDesktopRuntimeMode({ isPackaged: false }, "production")).toBe("production");
  });

  test("falls back to Electron packaging state when NODE_ENV is absent or unknown", () => {
    expect(resolveDesktopRuntimeMode({ isPackaged: false })).toBe("development");
    expect(resolveDesktopRuntimeMode({ isPackaged: true })).toBe("production");
    expect(resolveDesktopRuntimeMode({ isPackaged: false }, "test")).toBe("development");
  });
});
