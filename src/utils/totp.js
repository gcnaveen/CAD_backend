/**
 * Minimal TOTP (RFC 6238) for admin MFA — no extra npm dependency (audit H-02).
 */

const crypto = require("crypto");

function base32Encode(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(str || "")
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateMfaSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1e6).padStart(6, "0");
}

function verifyTotp(secretBase32, token, { window = 1, step = 30 } = {}) {
  const secretBuf = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / step);
  const code = String(token || "").trim();
  for (let w = -window; w <= window; w += 1) {
    if (hotp(secretBuf, counter + w) === code) return true;
  }
  return false;
}

function otpauthUrl({ secret, email, issuer = "CAD Backend" }) {
  const label = encodeURIComponent(`${issuer}:${email || "admin"}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  generateMfaSecret,
  verifyTotp,
  otpauthUrl,
};
