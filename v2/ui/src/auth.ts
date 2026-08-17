export type V2AuthSession = Readonly<{
  staff: Readonly<{ id: string; email: string; displayName: string }>;
  organizations: readonly Readonly<{ id: string; name: string }> [];
  activeOrganizationId: string | null;
  csrfToken: string;
  sessionScope: string;
}>;

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { cache: "no-store", credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body?.error?.message ?? "Authentication is unavailable.");
  return body.data as T;
};

export const v2AuthApi = {
  session: () => request<V2AuthSession>("/v2/auth/session"),
  login: (email: string, password: string) => request<V2AuthSession>("/v2/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  selectOrganization: (organizationId: string, csrfToken: string) => request<V2AuthSession>("/v2/auth/active-organization", { method: "POST", headers: { "x-v2-csrf-token": csrfToken }, body: JSON.stringify({ organizationId }) }),
  logout: (csrfToken: string) => request<{ loggedOut: boolean }>("/v2/auth/logout", { method: "POST", headers: { "x-v2-csrf-token": csrfToken } }),
};
