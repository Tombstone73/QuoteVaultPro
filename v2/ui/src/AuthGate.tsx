import { Fragment, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { clearV2ApiSessionState } from "./api";
import { clearV2SessionQueryState } from "./quoteCache";
import { v2AuthApi, type V2AuthSession } from "./auth";

type State = "loading" | "login" | "organization" | "authenticated";
type Organization = V2AuthSession["organizations"][number];

export type AuthSessionControls = Readonly<{
  displayName: string;
  email: string;
  organizations: readonly Organization[];
  activeOrganizationId: string;
  busy: boolean;
  signOut: () => void;
  selectOrganization: (organizationId: string) => void;
}>;

export const AuthSessionControlsContext = createContext<AuthSessionControls | null>(null);
export const useAuthSessionControls = () => useContext(AuthSessionControlsContext);

const persistOrganization = (organizationId: string | null): void => {
  try {
    if (organizationId) sessionStorage.setItem("ph.v2.organization-id", organizationId);
    else sessionStorage.removeItem("ph.v2.organization-id");
  } catch {
    /* Browser storage is only a UX mirror of the server-owned session. */
  }
};

/** The server accepts the new membership first; this clears only browser state afterwards. */
export const clearOrganizationSwitchClientState = (queryClient: QueryClient): void => {
  clearV2SessionQueryState(queryClient);
  clearV2ApiSessionState();
};

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>("loading");
  const [session, setSession] = useState<V2AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = (next: V2AuthSession) => { setSession(next); persistOrganization(next.activeOrganizationId); setState(next.activeOrganizationId ? "authenticated" : "organization"); };

  useEffect(() => { void v2AuthApi.session().then(accept).catch(() => setState("login")); }, []);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { accept(await v2AuthApi.login(email, password)); setPassword(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
    finally { setBusy(false); }
  };
  const selectOrganization = async (organizationId: string) => {
    if (!session || session.activeOrganizationId === organizationId) return;
    setBusy(true); setError("");
    try {
      const next = await v2AuthApi.selectOrganization(organizationId, session.csrfToken);
      clearOrganizationSwitchClientState(queryClient);
      window.history.replaceState({}, "", "/");
      accept(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Organization selection failed.");
    } finally { setBusy(false); }
  };
  const logout = async () => {
    if (!session) return;
    setBusy(true);
    try { await v2AuthApi.logout(session.csrfToken); }
    finally { clearOrganizationSwitchClientState(queryClient); persistOrganization(null); setSession(null); setState("login"); setBusy(false); }
  };

  if (state === "loading") return <main className="v2-auth"><p>Restoring secure session…</p></main>;
  if (state === "login") return <main className="v2-auth"><form className="v2-auth-card" onSubmit={login}><p className="eyebrow">PrintersHero V2</p><h1>Staff sign in</h1><p>Use your existing PrintersHero Staff email and password.</p><label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="notice error">{error}</p>}<button className="button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;
  if (state === "organization") return <main className="v2-auth"><section className="v2-auth-card"><p className="eyebrow">PrintersHero V2</p><h1>Select organization</h1><p>{session?.staff.displayName}, choose the organization for this session.</p>{session?.organizations.map((organization) => <button key={organization.id} className="button secondary" disabled={busy} onClick={() => void selectOrganization(organization.id)}>{organization.name}</button>)}{error && <p className="notice error">{error}</p>}</section></main>;

  const applicationSessionKey = `${session?.sessionScope ?? "anonymous"}:${session?.activeOrganizationId ?? "none"}`;
  return <AuthSessionControlsContext.Provider value={{
    displayName: session?.staff.displayName ?? "Authenticated staff", email: session?.staff.email ?? "",
    organizations: session?.organizations ?? [], activeOrganizationId: session?.activeOrganizationId ?? "", busy,
    signOut: () => void logout(), selectOrganization: (organizationId) => void selectOrganization(organizationId),
  }}><Fragment key={applicationSessionKey}>{children}</Fragment></AuthSessionControlsContext.Provider>;
};
