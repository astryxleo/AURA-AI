import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import App from "./App";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export default function AuthGate() {
  const [session, setSession] = useState<import("@supabase/supabase-js").Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setReady(true); }
    }).catch(() => { if (active) setReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (authError) throw authError;
        if (!data.session) setNotice("Account created. Check your email to confirm it, then sign in.");
        else setNotice("Your account is ready.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed. Please try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError(authError.message);
  }

  if (!ready) return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">✦</div><h1>Waking up AURA</h1><p>Restoring your secure session…</p></div></div>;

  if (!supabase) return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">✦</div><div className="auth-kicker">ONE-TIME SETUP</div><h1>Connect your account layer</h1><p>Add these two public frontend environment variables in Vercel, then redeploy. Never add a service-role key here.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p className="auth-muted">The Supabase project URL and publishable key are available in Project Settings → API Keys.</p></div></div>;

  if (session?.user) return <App userId={session.user.id} userEmail={session.user.email ?? ""} onSignOut={signOut} />;

  return <div className="auth-screen">
    <div className="auth-card">
      <div className="auth-logo">✦</div>
      <div className="auth-kicker">PERSONAL INTELLIGENCE, YOURS</div>
      <h1>{mode === "signin" ? "Welcome back." : "Create your space."}</h1>
      <p>{mode === "signin" ? "Sign in to continue your conversations with AURA." : "Create an account to keep your AURA workspace with you."}</p>
      <form className="auth-form" onSubmit={submit}>
        {mode === "signup" && <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" maxLength={80} required /></label>}
        <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} minLength={8} required /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {notice && <div className="auth-notice" role="status">{notice}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in securely" : "Create account"} <span>↗</span></button>
      </form>
      <div className="auth-switch">{mode === "signin" ? "New to AURA?" : "Already have an account?"} <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{mode === "signin" ? "Create account" : "Sign in"}</button></div>
      <div className="auth-foot">Your account is private. Never share your password.</div>
    </div>
  </div>;
}
