"use client";

import { useActionState, useState } from "react";
import { authenticate, type AuthState } from "./actions.ts";

export function SignInForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, submit, pending] = useActionState<AuthState, FormData>(authenticate, {});

  return (
    <form action={submit} className="mt-8 space-y-4">
      {/* The server reads the mode from here rather than from which function was
          bound at render time — see the note on `authenticate`. */}
      <input type="hidden" name="mode" value={mode} />
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={8}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
        {mode === "signup" && (
          <p className="mt-1.5 text-xs text-slate-500">At least 8 characters.</p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <p className="text-sm text-slate-600">
        {mode === "signin" ? "No account yet? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="font-medium text-slate-900 underline underline-offset-2"
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
