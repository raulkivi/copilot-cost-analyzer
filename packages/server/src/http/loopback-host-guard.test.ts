import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLoopbackHostGuard, isAllowedLoopbackHost } from "./loopback-host-guard.js";

describe("isAllowedLoopbackHost", () => {
  const allowedPorts = [3001, 5173];

  it.each([
    "localhost:3001",
    "127.0.0.1:3001",
    "[::1]:3001",
    "LOCALHOST:3001",
    "localhost:5173",
    "127.0.0.1:5173",
    "[::1]:5173",
  ])("allows loopback host %s on an allowed port", (host) => {
    expect(isAllowedLoopbackHost(host, allowedPorts)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "evil.example.com",
    "evil.example.com:3001",
    "localhost.evil.example.com:3001",
    "127.0.0.1.nip.io:3001",
    "192.168.1.10:3001",
    "0.0.0.0:3001",
    "localhost:8080",
    "[::1]:8080",
    "localhost:3001:3001",
    "[::1:3001",
  ])("rejects host %s", (host) => {
    expect(isAllowedLoopbackHost(host, allowedPorts)).toBe(false);
  });

  it("allows any port on a loopback hostname when no port allow-list is given", () => {
    expect(isAllowedLoopbackHost("127.0.0.1:54321", undefined)).toBe(true);
    expect(isAllowedLoopbackHost("localhost", undefined)).toBe(true);
    expect(isAllowedLoopbackHost("evil.example.com:54321", undefined)).toBe(false);
  });
});

describe("createLoopbackHostGuard", () => {
  function appWithGuard(allowedPorts?: number[]) {
    const app = express();
    app.use(createLoopbackHostGuard({ allowedPorts }));
    app.get("/api/secret", (_req, res) => {
      res.json({ transcript: "sensitive" });
    });
    return app;
  }

  it("responds 403 with a JSON error for a foreign Host (DNS rebinding)", async () => {
    const res = await request(appWithGuard([3001])).get("/api/secret").set("Host", "evil.example.com");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.stringMatching(/host/i) });
    expect(JSON.stringify(res.body)).not.toContain("sensitive");
  });

  it.each(["localhost:3001", "127.0.0.1:3001", "[::1]:3001", "localhost:5173", "127.0.0.1:5173"])(
    "passes through Host %s",
    async (host) => {
      const res = await request(appWithGuard([3001, 5173])).get("/api/secret").set("Host", host);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ transcript: "sensitive" });
    },
  );

  it("ignores X-Forwarded-Host (it can't widen the allow-list)", async () => {
    const res = await request(appWithGuard([3001]))
      .get("/api/secret")
      .set("Host", "evil.example.com")
      .set("X-Forwarded-Host", "localhost:3001");
    expect(res.status).toBe(403);
  });
});
