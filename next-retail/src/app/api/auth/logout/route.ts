import { getLocalSession } from "../../../../server/local-auth";
import { NextResponse } from "next/server";
import { isLocalSameOrigin } from "../../../../server/request-origin";
export async function POST(request: Request) {
  if (!isLocalSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.headers.get("origin")!);
  (await getLocalSession()).destroy();
  return NextResponse.redirect(new URL("/login", url), 303);
}
