import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type LocalAuth = { username: string; hash: string; secret: string };
export function readLocalAuth(): LocalAuth {
  try {
    return JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "local-auth.json"), "utf8"),
    ) as LocalAuth;
  } catch {
    throw new Error("Сначала выполните npm run local:prepare");
  }
}
export async function getLocalSession() {
  const cookieStore = await cookies();
  const config = readLocalAuth();
  return getIronSession<{ user?: { name: string; role: "admin" } }>(cookieStore, {
    password: config.secret,
    cookieName: "aroma-local-admin",
    ttl: 43200,
    cookieOptions: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.AROMA_HTTPS === "true",
      path: "/",
    },
  });
}
export async function requireLocalAdmin() {
  const session = await getLocalSession();
  if (!session.user || session.user.role !== "admin") redirect("/login");
  return session.user;
}
