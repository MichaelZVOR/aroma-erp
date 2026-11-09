import { expect, test, vi, afterEach } from "vitest";
import { isLocalSameOrigin } from "../src/server/request-origin";
afterEach(() => vi.unstubAllEnvs());
test("local origin uses the real Host header when Next reconstructs an internal URL", () => {
  vi.stubEnv("PORT", "8791");
  expect(
    isLocalSameOrigin(
      new Request("http://localhost:8791/api/auth/login", {
        headers: { host: "127.0.0.1:8791", origin: "http://127.0.0.1:8791" },
      }),
    ),
  ).toBe(true);
});
test("foreign and missing origins are rejected", () => {
  vi.stubEnv("PORT", "8791");
  for (const origin of ["https://evil.example", "null", "http://localhost:8791"]) {
    expect(
      isLocalSameOrigin(
        new Request("http://localhost:8791/api/auth/login", {
          headers: { host: "127.0.0.1:8791", origin },
        }),
      ),
    ).toBe(false);
  }
  expect(isLocalSameOrigin(new Request("http://localhost:8791"))).toBe(false);
});
