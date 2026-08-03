#!/bin/sh
# One-shot MinIO bootstrap (idempotent): bucket, bucket-scoped policy,
# least-privilege service account. Root credentials stay here and in human
# ops only; services use UNE_STORAGE_ACCESS_KEY/SECRET_KEY.
set -eu

mc alias set local http://minio:9000 "$UNE_MINIO_ROOT_USER" "$UNE_MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "local/$UNE_MINIO_BUCKET"

# Policy generated here (mc image has no sed); bucket name from env.
cat > /tmp/une-app.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": ["arn:aws:s3:::$UNE_MINIO_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::$UNE_MINIO_BUCKET/*"]
    }
  ]
}
EOF
if mc admin policy info local une-app > /dev/null 2>&1; then
  echo "policy une-app exists"
else
  mc admin policy create local une-app /tmp/une-app.json
fi

# 'user add' on an existing key updates its secret, so re-runs stay in sync
# with infrastructure/.env.
mc admin user add local "$UNE_STORAGE_ACCESS_KEY" "$UNE_STORAGE_SECRET_KEY"

# case instead of grep: the mc image has no coreutils.
#
# CC-160 fix: the guard used to match `*une-app*` against the PLAIN-TEXT output,
# but the access key itself is generated as `une-app-<random>` (see
# .env.example), so the pattern matched the key name and the policy was NEVER
# attached. Every request from the service account then failed with 403, which
# only surfaced when CC-160 became the first code to actually use the bucket.
# Match the JSON field instead — `--json` omits `policyName` entirely when no
# policy is attached, so the pattern cannot be satisfied by the key name.
case "$(mc --json admin user info local "$UNE_STORAGE_ACCESS_KEY")" in
  *'"policyName":"une-app"'*) echo "policy une-app already attached" ;;
  *) mc admin policy attach local une-app --user "$UNE_STORAGE_ACCESS_KEY" ;;
esac

# Fail loudly if the attach did not take effect. A service account without a
# policy looks healthy in `docker compose ps` and fails only at first use.
case "$(mc --json admin user info local "$UNE_STORAGE_ACCESS_KEY")" in
  *'"policyName":"une-app"'*) echo "policy attachment verified" ;;
  *) echo "ERROR: policy une-app is not attached to $UNE_STORAGE_ACCESS_KEY" >&2; exit 1 ;;
esac

echo "bucket $UNE_MINIO_BUCKET and service account ready"
