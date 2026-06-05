import { describe, expect, test } from "@jest/globals";
import { canUsePlatformTools } from "./platformAccess";

describe("canUsePlatformTools", () => {
  test("allows platform developers", () => {
    expect(canUsePlatformTools({ isPlatformDeveloper: true, isPlatformAdmin: false })).toBe(true);
  });

  test("allows platform admins", () => {
    expect(canUsePlatformTools({ isPlatformDeveloper: false, isPlatformAdmin: true })).toBe(true);
  });

  test("blocks normal tenant admins", () => {
    expect(canUsePlatformTools({ isPlatformDeveloper: false, isPlatformAdmin: false })).toBe(false);
  });

  test("blocks missing users", () => {
    expect(canUsePlatformTools(null)).toBe(false);
  });
});
