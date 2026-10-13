import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, jest, test } from "@jest/globals";

const mockApiFetch = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
jest.mock("@/lib/apiConfig", () => ({ getApiUrl: (path: string) => `https://api-dev.printershero.com${path}` }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: (...args: [string, RequestInit?]) => mockApiFetch(...args) }));

import { verifyLoginSession } from "./useAuth";

const sessionUrl = "https://api-dev.printershero.com/api/auth/session";

beforeEach(() => mockApiFetch.mockReset());

test("verified login replaces a stale unauthenticated query result", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData([sessionUrl], { authenticated: false });
  const user = { id: "staff-1", role: "owner" };
  mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, user }) } as Response);

  expect((await verifyLoginSession(queryClient)).user).toEqual(user);
  expect(queryClient.getQueryData([sessionUrl])).toEqual({ authenticated: true, user });
  expect(mockApiFetch).toHaveBeenCalledWith(sessionUrl, { credentials: "include" });
});

test("a failed post-login session check cannot become a false success", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData([sessionUrl], { authenticated: false });
  mockApiFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

  await expect(verifyLoginSession(queryClient)).rejects.toThrow("session could not be established");
  expect(queryClient.getQueryData([sessionUrl])).toEqual({ authenticated: false });
});
