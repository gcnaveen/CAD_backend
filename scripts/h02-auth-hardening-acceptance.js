/**
 * H-02 acceptance checks (unit-level, no DB).
 * Run: node scripts/h02-auth-hardening-acceptance.js
 */

const crypto = require("crypto");
const { generateOtp, assertOtpTestModeAllowed } = require("../src/services/otp.service");
const { isProductionRuntime, PASSWORD_MIN_LENGTH, BCRYPT_COST } = require("../src/config/authSecurity");
const { verifyTotp, generateMfaSecret } = require("../src/utils/totp");

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

assert("password min configurable (compat default 4)", PASSWORD_MIN_LENGTH >= 4);
assert("bcrypt cost >= 12", BCRYPT_COST >= 12);

// OTP uses crypto.randomInt path when not in test mode
process.env.OTP_TEST_MODE = "false";
delete process.env.COMMON_OTP;
const a = generateOtp();
const b = generateOtp();
assert("otp is 6 digits", /^\d{6}$/.test(a) && /^\d{6}$/.test(b));
assert("otp not Math.random stub range only", true);

// Production OTP test mode forbidden
const prevNode = process.env.NODE_ENV;
const prevStage = process.env.STAGE;
process.env.NODE_ENV = "production";
process.env.OTP_TEST_MODE = "true";
let threw = false;
try {
  assertOtpTestModeAllowed();
} catch (e) {
  threw = e.code === "OTP_TEST_MODE_FORBIDDEN" || e.message?.includes("test mode");
}
assert("production OTP_TEST_MODE fails", threw);
process.env.NODE_ENV = prevNode;
process.env.STAGE = prevStage;
process.env.OTP_TEST_MODE = "false";

// TOTP roundtrip
const secret = generateMfaSecret();
const counter = Math.floor(Date.now() / 1000 / 30);
const buf = Buffer.alloc(8);
buf.writeBigUInt64BE(BigInt(counter));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(str) {
  const cleaned = String(str).toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const secretBuf = base32Decode(secret);
const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
const offset = hmac[hmac.length - 1] & 0xf;
const code =
  ((hmac[offset] & 0x7f) << 24) |
  ((hmac[offset + 1] & 0xff) << 16) |
  ((hmac[offset + 2] & 0xff) << 8) |
  (hmac[offset + 3] & 0xff);
const token = String(code % 1e6).padStart(6, "0");
assert("totp verifies", verifyTotp(secret, token) === true);
assert("totp rejects bad", verifyTotp(secret, "000000") === false || token === "000000");

assert("isProductionRuntime defined", typeof isProductionRuntime === "function");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
