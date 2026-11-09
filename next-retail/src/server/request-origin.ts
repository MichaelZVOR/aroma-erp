export function isLocalSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    const port = process.env.PORT || "3000";
    return (
      ["http:", "https:"].includes(source.protocol) &&
      [`127.0.0.1:${port}`, `localhost:${port}`].includes(host) &&
      source.host === host
    );
  } catch {
    return false;
  }
}
