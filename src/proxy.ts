import { NextResponse, type NextRequest } from "next/server";
import { secretMatches } from "@/lib/http";

/**
 * Optional HTTP Basic auth for the whole app (Next.js 16 "proxy", formerly
 * middleware).
 *
 * Off by default: Vesper is a single-user app bound to 127.0.0.1. If
 * VESPER_PASSWORD is set, every page and API route requires it. The username
 * is ignored; only the password is checked. /api/health stays open so uptime
 * checks keep working.
 */
export function proxy(request: NextRequest) {
  const password = process.env.VESPER_PASSWORD;
  if (!password) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("basic ")) {
    let decoded = "";
    try {
      decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    } catch {
      decoded = "";
    }
    // "username:password" — the password may itself contain colons.
    const separator = decoded.indexOf(":");
    const provided = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (secretMatches(provided, password)) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Vesper", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
