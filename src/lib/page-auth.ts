import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  isAuthConfigured,
  verifySessionToken,
} from "@/lib/auth";

export async function requireAuthenticatedPage(): Promise<void> {
  if (!isAuthConfigured()) {
    redirect("/login?error=config");
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(session)) {
    redirect("/login");
  }
}
