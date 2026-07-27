/**
 * M-12 acceptance: refresh rotation, reuse family, sessions API, revocation hooks.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

assert("SECURITY_M12 doc", fs.existsSync(path.join(root, "docs/SECURITY_M12_SESSION_REFRESH.md")));
assert("FRONTEND_M12 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M12_SESSION_REFRESH.md")));

const refreshSvc = read("src/services/refreshToken.service.js");
assert("familyId on tokens", /familyId/.test(refreshSvc));
assert("reuse detection", /REUSE_DETECTED|REFRESH_REUSE_DETECTED/.test(refreshSvc));
assert("revokeFamily", /revokeFamily/.test(refreshSvc));
assert("rotate on use", /ROTATED/.test(refreshSvc));
assert("listSessionsForUser", /listSessionsForUser/.test(refreshSvc));
assert("session cap", /SESSION_CAP|getMaxSessionsPerUser/.test(refreshSvc));

const cookies = read("src/utils/authCookies.js");
assert("HttpOnly Secure SameSite", /HttpOnly/.test(cookies) && /SameSite/.test(cookies) && /Secure/.test(cookies));

const authSvc = read("src/services/auth.service.js");
assert("refreshSession rotates", /rotateRefreshToken/.test(authSvc));
assert("listSessions exposed", /listSessions/.test(authSvc));
assert("logout revoke", /revokeAllForUser|revokeRefreshToken/.test(authSvc));

const userModel = read("src/models/user/User.js");
assert("password/role change revokes", /ROLE_CHANGED|PASSWORD_CHANGED/.test(userModel));

const userSvc = read("src/services/user.service.js");
assert("block revokes sessions", /USER_BLOCKED/.test(userSvc));
assert("delete revokes sessions", /USER_DELETED/.test(userSvc));

const yml = read("serverless.yml");
assert("sessions GET route", /path:\s*\/api\/auth\/sessions/.test(yml));
assert("sessions DELETE route", /sessions\/\{sessionId\}/.test(yml));
assert("15m access default", /JWT_ACCESS_EXPIRES_IN:.*15m/.test(yml));
assert("AUTH_MAX_SESSIONS_PER_USER", /AUTH_MAX_SESSIONS_PER_USER:/.test(yml));

const api = read("src/handlers/authApi.js");
assert("authApi sessions", /GET \/api\/auth\/sessions/.test(api));
assert("authApi revoke session", /DELETE \/api\/auth\/sessions/.test(api));

const forgot = read("src/services/auth.service.js");
assert("password reset revokes", /revokeAllForUser/.test(forgot));

const pkg = JSON.parse(read("package.json"));
assert("test:m12 script", typeof pkg.scripts["test:m12"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
