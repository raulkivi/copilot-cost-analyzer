import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Session } from "@copilot-cost-analyzer/domain";
import { useSessionStore } from "./session-store.js";

const session = { id: "s1" } as unknown as Session;

describe("useSessionStore", () => {
  it("starts with no session loaded and turn index 0", () => {
    const { result } = renderHook(() => useSessionStore());

    expect(result.current.session).toBeNull();
    expect(result.current.selectedTurnIndex).toBe(0);
  });

  it("loads a session and resets the selected turn to 0", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.selectTurn(3));
    act(() => result.current.loadSession(session));

    expect(result.current.session).toEqual(session);
    expect(result.current.selectedTurnIndex).toBe(0);
  });

  it("updates the selected turn index", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.loadSession(session));
    act(() => result.current.selectTurn(2));

    expect(result.current.selectedTurnIndex).toBe(2);
  });

  it("starts in learn mode with the explanation tab selected", () => {
    const { result } = renderHook(() => useSessionStore());

    expect(result.current.mode).toBe("learn");
    expect(result.current.rightTab).toBe("explanation");
  });

  it("setMode switches mode and resets turn index + right tab", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.selectTurn(3));
    act(() => result.current.setRightTab("tools"));
    act(() => result.current.setMode("analyze"));

    expect(result.current.mode).toBe("analyze");
    expect(result.current.selectedTurnIndex).toBe(0);
    expect(result.current.rightTab).toBe("explanation");
  });

  it("setMode clears the loaded session so a stale cross-mode session isn't shown", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.loadSession(session));
    act(() => result.current.setMode("analyze"));

    expect(result.current.session).toBeNull();
  });

  it("setMode is a no-op when the mode is unchanged (re-clicking the active tab)", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.loadSession(session));
    act(() => result.current.selectTurn(2));
    act(() => result.current.setRightTab("tools"));
    act(() => result.current.setMode("learn"));

    expect(result.current.session).toEqual(session);
    expect(result.current.selectedTurnIndex).toBe(2);
    expect(result.current.rightTab).toBe("tools");
  });

  it("loadSession also resets the right tab to explanation", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.setRightTab("system-prompt"));
    act(() => result.current.loadSession(session));

    expect(result.current.rightTab).toBe("explanation");
  });

  it("setRightTab updates the right tab", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.setRightTab("tools"));

    expect(result.current.rightTab).toBe("tools");
  });

  it("starts with the vscode provider active", () => {
    const { result } = renderHook(() => useSessionStore());

    expect(result.current.activeProviderId).toBe("vscode");
  });

  it("setActiveProviderId switches the active provider and clears the loaded session", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.loadSession(session));
    act(() => result.current.selectTurn(3));
    act(() => result.current.setRightTab("tools"));
    act(() => result.current.setActiveProviderId("mitmproxy"));

    expect(result.current.activeProviderId).toBe("mitmproxy");
    expect(result.current.session).toBeNull();
    expect(result.current.selectedTurnIndex).toBe(0);
    expect(result.current.rightTab).toBe("explanation");
  });

  it("setActiveProviderId is a no-op when the provider is unchanged", () => {
    const { result } = renderHook(() => useSessionStore());

    act(() => result.current.loadSession(session));
    act(() => result.current.selectTurn(2));
    act(() => result.current.setActiveProviderId("vscode"));

    expect(result.current.session).toEqual(session);
    expect(result.current.selectedTurnIndex).toBe(2);
  });
});
