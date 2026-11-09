import bcrypt from "bcryptjs";
import { getLocalSession, readLocalAuth } from "../../../../server/local-auth";
import { NextResponse } from "next/server";
import { isLocalSameOrigin } from "../../../../server/request-origin";
const failures = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.headers.get("origin")!);
  const form = await request.formData();
  const username = String(form.get("username") ?? "").slice(0, 100);
  const password = String(form.get("password") ?? "").slice(0, 256);
  const attempt = failures.get(username);
  const config = readLocalAuth();
  if (attempt && attempt.count >= 10 && attempt.until > Date.now())
    return NextResponse.redirect(new URL("/login?error=locked", url), 303);
  if (username !== config.username || !bcrypt.compareSync(password, config.hash)) {
    if (failures.size > 1000)
      for (const [key, value] of failures) if (value.until < Date.now()) failures.delete(key);
    if (failures.size < 10000)
      failures.set(username, {
        count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
        until: Date.now() + 900000,
      });
    return NextResponse.redirect(new URL("/login?error=credentials", url), 303);
  }
  failures.delete(username);
  const session = await getLocalSession();
  session.user = { name: username, role: "admin" };
  await session.save();
  return NextResponse.redirect(new URL("/stock", url), 303);
}
