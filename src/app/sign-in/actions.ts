"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionClient } from "@/lib/supabase/server.ts";

export interface AuthState {
  error?: string;
  notice?: string;
}

function readCredentials(form: FormData): { email: string; password: string } | string {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email address and a password.";
  if (password.length < 8) return "Use a password of at least 8 characters.";
  return { email, password };
}

/**
 * One action for both modes, branching on a hidden field.
 *
 * Swapping the action function passed to useActionState does not reliably rebind it,
 * so a user who toggled to "Sign in" was still running sign-up. Reading the mode from
 * the submitted form removes that class of bug entirely, and the form keeps working
 * without JavaScript.
 */
export async function authenticate(prev: AuthState, form: FormData): Promise<AuthState> {
  return String(form.get("mode")) === "signup" ? signUp(prev, form) : signIn(prev, form);
}

async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form);
  if (typeof credentials === "string") return { error: credentials };

  const { error } = await (await sessionClient()).auth.signInWithPassword(credentials);
  // Supabase does not distinguish a wrong password from an unknown address, and
  // neither do we — saying which would confirm whether an account exists.
  if (error) return { error: "That email address and password do not match an account." };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form);
  if (typeof credentials === "string") return { error: credentials };

  const { data, error } = await (await sessionClient()).auth.signUp(credentials);
  if (error) return { error: error.message };

  // No session means either email confirmation is on, or the address is already
  // registered — Supabase returns the same shape for both so that signing up cannot
  // be used to discover who has an account. The wording has to cover both without
  // revealing which happened.
  if (!data.session) {
    return {
      notice:
        "If that address can be registered, a confirmation email is on its way. If you already have an account, sign in instead.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await (await sessionClient()).auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
