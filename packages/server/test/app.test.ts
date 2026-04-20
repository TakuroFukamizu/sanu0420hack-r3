import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let app: ReturnType<typeof buildApp>;
afterEach(async () => {
  if (app) await app.close();
});

describe("server app", () => {
  it("GET /health returns ok", async () => {
    app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
