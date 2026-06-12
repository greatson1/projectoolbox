// Repro + verification for the 2026-06-12 OAuth login loop.
// Encodes a session JWT exactly like the v5 handler does on https
// (cookie "__Secure-authjs.session-token", HKDF salt = cookie name),
// then reads it back via getToken three ways:
//   1. bare getToken({req, secret})            — the OLD proxy call (expected: null → the bug)
//   2. getToken({..., secureCookie: true})     — the NEW proxy call, https path (expected: token)
//   3. http-style cookie + secure→plain chain  — the NEW fallback path (expected: token)
import { encode, getToken } from "next-auth/jwt";

const secret = "test-secret-test-secret-test-secret-1234";

function reqWithCookie(name, value) {
  return new Request("https://projectoolbox.com/dashboard", {
    headers: { cookie: `${name}=${value}` },
  });
}

// ── prod-style (https) cookie ──
const secureName = "__Secure-authjs.session-token";
const secureJwt = await encode({
  token: { sub: "user_123", role: "OWNER", orgId: "org_1" },
  secret,
  salt: secureName,
});

const oldCall = await getToken({ req: reqWithCookie(secureName, secureJwt), secret });
const newCallSecure = await getToken({ req: reqWithCookie(secureName, secureJwt), secret, secureCookie: true });

// ── dev-style (http) cookie, read through the new secure→plain chain ──
const plainName = "authjs.session-token";
const plainJwt = await encode({
  token: { sub: "user_123" },
  secret,
  salt: plainName,
});
const devReq = reqWithCookie(plainName, plainJwt);
const chain =
  (await getToken({ req: devReq, secret, secureCookie: true })) ??
  (await getToken({ req: devReq, secret, secureCookie: false }));

console.log("1. OLD proxy call on prod cookie :", oldCall ? "TOKEN READ (??)" : "null  ← the bug, reproduced");
console.log("2. NEW call (secureCookie:true)  :", newCallSecure?.sub === "user_123" ? "TOKEN READ ✓" : "FAILED ✗");
console.log("3. NEW chain on dev cookie       :", chain?.sub === "user_123" ? "TOKEN READ ✓" : "FAILED ✗");

if (oldCall !== null || newCallSecure?.sub !== "user_123" || chain?.sub !== "user_123") process.exit(1);
console.log("\nAll assertions passed.");
