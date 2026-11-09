import { expect, test } from "vitest";
import { isLegacySection, legacyRoute, legacySource } from "../src/domain/navigation";
test("legacy sections stay inside canonical Next navigation", () => {
  expect(legacyRoute("home")).toBe("/overview");
  expect(legacyRoute("calc")).toBe("/calculator");
  expect(legacyRoute("stock")).toBe("/stock?tab=stock");
  expect(legacyRoute("bottles")).toBe("/products?legacy=bottles");
});
test("messages cannot navigate to arbitrary external addresses", () => {
  for (const value of ["https://evil.test", "javascript:alert(1)", "__proto__", null, {}])
    expect(legacyRoute(value)).toBeNull();
});
test("frame sources accept only known sections and catalogue filters", () => {
  expect(isLegacySection("calculator")).toBe(true);
  expect(isLegacySection("__proto__")).toBe(false);
  expect(legacySource("products", "bottles")).toBe("http://127.0.0.1:8788/?embed=1#bottles");
  expect(legacySource("products", "https://evil.test")).toBe(
    "http://127.0.0.1:8788/?embed=1#goods",
  );
});

test("product drawer filters stay within the known catalogue kinds", () => {
  expect(legacySource("products", undefined, "atom")).toBe("http://127.0.0.1:8788/?embed=1&category=atom#goods");
  expect(legacySource("products", undefined, "https://evil.test")).toBe("http://127.0.0.1:8788/?embed=1#goods");
  expect(legacySource("calculator", undefined, "atom")).toBe("http://127.0.0.1:8788/?embed=1#calc");
});
