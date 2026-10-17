import React, { useState } from "react";

import { Waypoints, ArrowRight, Mail } from "lucide-react";

export const cloud = import.meta.env.VITE_HUB_CLOUD === "1";
import { createHubAuth } from "./auth-client.mjs";
export const auth = createHubAuth();

export function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState(localStorage.getItem("hub-email") || "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      const result = sent
        ? await auth.signIn.emailOtp({ email: normalized, otp: code.trim() })
        : await auth.emailOtp.sendVerificationOtp({
            email: normalized,
            type: "sign-in",
          });
      if (result.error)
        throw new Error(
          result.error.message || "Sign-in could not finish. Please try again.",
        );
      if (!sent) setSent(true);
      else {
        localStorage.setItem("hub-email", normalized);
        await onSignedIn();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <div className="brand">
          <Waypoints size={25} />
          <strong>Project hub</strong>
        </div>
        <h1>{sent ? "Check your email" : "Everything in one place."}</h1>
        <p>
          {sent
            ? `Enter the sign-in code sent to ${email.trim()}.`
            : "Your projects, connected stack and next steps. Ready wherever you are."}
        </p>
        <form onSubmit={submit}>
          {!sent ? (
            <label className="field">
              Your email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          ) : (
            <label className="field">
              Sign-in code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                placeholder="6-digit code"
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : sent ? "Open my hub" : "Send sign-in code"}
            <ArrowRight size={17} />
          </button>
        </form>
        {sent && (
          <p className="sign-in-note">
            Check Spam or Junk for Project Hub. Use the newest code if you
            requested more than one.
          </p>
        )}
        {sent ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode("");
              setError("");
            }}
          >
            Use another email or request a new code
          </button>
        ) : (
          <p className="sign-in-note">
            <Mail size={16} />
            Private access for the hub owner. No password to remember.
          </p>
        )}
      </section>
    </main>
  );
}
