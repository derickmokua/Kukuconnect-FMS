/** Map Supabase auth errors to staff-friendly copy. */
export function mapAuthError(message: string): string {
  const m = (message || "").toLowerCase();

  if (
    m.includes("email not confirmed") ||
    m.includes("email_not_confirmed") ||
    m.includes("confirm your email")
  ) {
    return "Email not confirmed. In Supabase → Authentication → Users, open this user and confirm the email (or create the user with “Auto Confirm User”).";
  }

  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid_credentials") ||
    m.includes("invalid email or password")
  ) {
    return "Wrong email or password. Create or reset the staff user in Supabase → Authentication → Users.";
  }

  if (m.includes("user not found")) {
    return "No staff user with that email. Add them in Supabase → Authentication → Users.";
  }

  if (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("load failed")
  ) {
    return "Cannot reach Supabase. Check mobile data/Wi‑Fi, or that the project is not paused in the Supabase dashboard.";
  }

  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Too many login attempts. Wait a minute and try again.";
  }

  return message || "Sign-in failed. Try again.";
}
