import { Fragment, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  const sequence = useRef(0);
  const mounted = useRef(false);
  const restorationQueued = useRef(false);
  const pending = useRef<"restore" | "login" | "selection" | "logout" | null>(null);
  const clearClientSession = () => {
    clearOrganizationSwitchClientState(queryClient);
    persistOrganization(null);
    setSession(null);
  };
  const accept = (next: V2AuthSession) => {
    // Accepted identity/org resets fence all older responses without emitting
    // another context-change event. Storage mirrors only this verified result.
    clearOrganizationSwitchClientState(queryClient);
    setSession(next);
    persistOrganization(next.activeOrganizationId);
    setState(next.activeOrganizationId ? "authenticated" : "organization");
  };
  const current = (operation: number) => mounted.current && operation === sequence.current;

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const restore = () => {
      if (pending.current === "logout") return;
      sequence.current++;
      pending.current = "restore";
      clearClientSession();
      setState("loading"); setBusy(false); setError("");
      // Coalesce a synchronous notification burst, but supersede a pending
      // older server read when a later trusted context change arrives.
      if (restorationQueued.current) return;
      restorationQueued.current = true;
      queueMicrotask(() => {
        if (!active) return;
        restorationQueued.current = false;
        if (pending.current !== "restore") return;
        const operation = sequence.current;
        void v2AuthApi.session().then((next) => {
          if (!active || !current(operation)) return;
          accept(next); pending.current = null;
        }).catch(() => {
          if (!active || !current(operation)) return;
          clearClientSession(); setState("login"); pending.current = null;
        });
      });
    };
    window.addEventListener("v2:session-context-changed", restore);
    restore();
    return () => {
      active = false; mounted.current = false; sequence.current++;
      restorationQueued.current = false;
      window.removeEventListener("v2:session-context-changed", restore);
    };
  }, [queryClient]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const operation = ++sequence.current;
    pending.current = "login";
    clearClientSession(); setBusy(true); setError("");
    try {
      const next = await v2AuthApi.login(email, password);
      if (current(operation)) { accept(next); setPassword(""); }
    } catch (reason) {
      if (current(operation)) { clearClientSession(); setState("login"); setError(reason instanceof Error ? reason.message : "Sign in failed."); }
    } finally { if (current(operation)) { pending.current = null; setBusy(false); } }
  };
  const selectOrganization = async (organizationId: string) => {
    if (!session || session.activeOrganizationId === organizationId || pending.current) return;
    const operation = ++sequence.current;
    pending.current = "selection";
    clearClientSession(); setState("loading"); setBusy(true); setError("");
    try {
      const next = await v2AuthApi.selectOrganization(organizationId, session.csrfToken);
      if (!current(operation)) return;
      window.history.replaceState({}, "", "/");
      accept(next);
    } catch (reason) {
      if (current(operation)) { clearClientSession(); setState("login"); setError(reason instanceof Error ? reason.message : "Organization selection failed."); }
    } finally { if (current(operation)) { pending.current = null; setBusy(false); } }
  };
  const logout = async () => {
    if (!session || pending.current === "logout") return;
    const operation = ++sequence.current;
    pending.current = "logout";
    clearClientSession(); setState("loading"); setBusy(true); setError("");
    try { await v2AuthApi.logout(session.csrfToken); }
    catch (reason) { if (current(operation)) setError(reason instanceof Error ? reason.message : "Sign out could not be confirmed. Local session data was cleared."); }
    finally { if (current(operation)) { clearClientSession(); setState("login"); pending.current = null; setBusy(false); } }
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
