#!/usr/bin/env bash
# Restore Lambda PutObject on caddrawing (the pre-rename working bucket).
#
# Your CLI must be account 603685644260 and NOT under AWSCompromisedKeyQuarantineV3.
# If you see Account 063526151302, you are on the wrong account:
#   unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
#   export AWS_PROFILE=default   # or your 603685644260 admin profile
set -euo pipefail
ROLE=cad-backend-api-dev-ap-south-1-lambdaRole
ROOT="$(cd "$(dirname "$0")" && pwd)"
DOC="$ROOT/CadBackendS3CaddrawingAccess.json"

echo "=== caller ==="
aws sts get-caller-identity
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
if [[ "$ACCOUNT" != "603685644260" ]]; then
  echo "ERROR: wrong AWS account ($ACCOUNT). Need 603685644260."
  echo "Tip: unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN && export AWS_PROFILE=default"
  exit 1
fi

echo "=== put inline policy CadBackendS3CaddrawingInline ==="
aws iam put-role-policy \
  --role-name "$ROLE" \
  --policy-name CadBackendS3CaddrawingInline \
  --policy-document "file://$DOC"

echo "=== verify S3 resources on role ==="
aws iam get-role-policy --role-name "$ROLE" --policy-name CadBackendS3CaddrawingInline \
  --query 'PolicyDocument.Statement[].Resource' --output json

echo "OK — hard-refresh https://north-cot.com and retry Save Recording"
