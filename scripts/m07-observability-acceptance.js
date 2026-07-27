/**
 * M-07 acceptance: correlation IDs, structured logs, health/ops APIs, audits, alerts.
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

assert("SECURITY_M07 doc", fs.existsSync(path.join(root, "docs/SECURITY_M07_OBSERVABILITY.md")));
assert("FRONTEND_M07 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M07_OPS_OBSERVABILITY.md")));
assert("RUNBOOK monitoring", fs.existsSync(path.join(root, "docs/RUNBOOK_MONITORING_INCIDENT.md")));

assert("requestContext", fs.existsSync(path.join(root, "src/utils/requestContext.js")));
assert("AdminAuditEvent model", fs.existsSync(path.join(root, "src/models/security/AdminAuditEvent.js")));
assert("opsObservability service", fs.existsSync(path.join(root, "src/services/opsObservability.service.js")));

const asyncHandler = read("src/utils/asyncHandler.js");
assert("asyncHandler correlation ALS", /runWithRequestContext/.test(asyncHandler));
assert("asyncHandler sets x-correlation-id", /x-correlation-id/.test(asyncHandler));

const logger = read("src/utils/logger.js");
assert("logger correlationId", /getCorrelationId/.test(logger));
assert("logger PII redact", /REDACTED|PII_KEYS/.test(logger));

const yml = read("serverless.yml");
assert("GET /api/health route", /path:\s*\/api\/health/.test(yml));
assert("ops observability route", /path:\s*\/api\/admin\/ops\/observability/.test(yml));
assert("CAD_DELIVERY_SLA_MS env", /CAD_DELIVERY_SLA_MS:/.test(yml));
assert("CORS expose X-Correlation-Id", /X-Correlation-Id/.test(yml) && /exposeHeaders:/.test(yml));

const authApi = read("src/handlers/authApi.js");
assert("authApi health case", /GET \/api\/health/.test(authApi));
assert("authApi observability case", /GET \/api\/admin\/ops\/observability/.test(authApi));

const handler = read("src/handlers/auth.handler.js");
assert("admin audit on block", /USER_BLOCK/.test(handler));
assert("admin audit on refund", /BALANCE_REFUND/.test(handler));
assert("admin audit on pullback", /ASSIGNMENT_PULLBACK_REASSIGN/.test(handler));
assert("admin audit on wallet pay", /CAD_WALLET_/.test(handler));

const recon = read("src/handlers/paymentReconciliation.js");
assert("payment alert log", /ALERT_PAYMENT_RECON_FLAGS/.test(recon));
assert("SLA alert log", /ALERT_SLA_BREACH/.test(recon));

assert("FileAccessEvent model", fs.existsSync(path.join(root, "src/models/security/FileAccessEvent.js")));
assert("AuthAuditEvent model", fs.existsSync(path.join(root, "src/models/auth/AuthAuditEvent.js")));

const ops = read("src/services/opsObservability.service.js");
assert("funnel + sla + capacity", /getOrderFunnel/.test(ops) && /getSlaAging/.test(ops) && /getOperatorCapacity/.test(ops));
assert("availabilityStatus field", /availabilityStatus/.test(ops));

const pkg = JSON.parse(read("package.json"));
assert("test:m07 script", typeof pkg.scripts["test:m07"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
