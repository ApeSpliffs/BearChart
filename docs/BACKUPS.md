# Backups

Membership data (subscriptions, synced collections, value history, saved
insurance reports, showcases) lives only in Supabase. The catalogue can be rebuilt
from the repo; member data cannot. Backups are layered so that losing any one
layer is survivable.

## Layers

1. **Supabase daily backups.** Pro plan: daily, 7-day retention, restorable from
   the dashboard. Free projects have no downloadable backups — upgrading is an
   owner TODO.
2. **Point-in-time recovery (PITR) add-on.** Recommended once paid members exist:
   it brings the recovery point from a day down to minutes.
3. **`.github/workflows/backup.yml`.** A nightly logical dump (roles, schema,
   data) taken with `supabase db dump`, encrypted with
   [`age`](https://age-encryption.org) on the runner, and copied off-platform to
   an S3-compatible bucket (Cloudflare R2 or Backblaze B2). Recovery point: 24
   hours. Retention: a 30-day lifecycle rule on the bucket. Until its secrets
   exist the workflow finishes green with a notice and does nothing.
4. **Storage buckets are not in the dump.** `bear-photos`, `showcase-photos` and
   `photo-submissions` hold files, not rows; `pg_dump` only has their metadata.
   Copy them separately with [rclone](https://rclone.org) against Supabase's
   S3-compatible storage endpoint (Dashboard → Storage → S3 connection). This is
   documented, not automated.

## Why the dump is encrypted with age

Only the **public** key (`BACKUP_AGE_RECIPIENT`) is stored in GitHub. The private
key stays offline with the owner. A leaked GitHub secret, or a leaked bucket key,
therefore yields files nobody can read.

```bash
age-keygen -o bearchart-backup.key      # keep this file offline
grep 'public key' bearchart-backup.key  # -> BACKUP_AGE_RECIPIENT
```

## Why the session pooler URL

GitHub-hosted runners have no IPv6, and the direct database host
(`db.<ref>.supabase.co`) is IPv6-only. Use the **session pooler** connection string
(Dashboard → Connect → Session pooler, port 5432) for `BACKUP_DATABASE_URL`. The
transaction pooler (port 6543) is not suitable for `pg_dump`.

## Setting it up

1. Create the bucket with a 30-day lifecycle rule, and an access key limited to
   that bucket.
2. Create the `age` keypair (above).
3. In GitHub, create an environment named `backups` and add:
   - secrets `BACKUP_DATABASE_URL`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
     `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`
   - variable `BACKUP_AGE_RECIPIENT`
4. Run the workflow by hand from the Actions tab and confirm a
   `db/bearchart-<timestamp>.tar.gz.age` object appears.

## Restore procedure

Always restore into a fresh **staging** project first, never straight over
production.

```bash
aws s3 cp s3://$BUCKET/db/bearchart-<timestamp>.tar.gz.age . --endpoint-url $ENDPOINT
age -d -i bearchart-backup.key bearchart-<timestamp>.tar.gz.age | tar -xzf -
psql "$STAGING_DB_URL" -f roles.sql
psql "$STAGING_DB_URL" -f schema.sql
psql "$STAGING_DB_URL" -c 'SET session_replication_role = replica' -f data.sql
```

`session_replication_role = replica` stops triggers and foreign-key checks firing
while rows load in dump order. Then smoke test:

- `select count(*) from subscriptions, collection_entries, value_history;` look
  plausible against production.
- Sign in on a preview pointed at the staging project; a known member sees their
  collection and tier.
- `supabase test db` against a local stack still passes (schema sanity).

Only after that, decide whether to promote (point production at the restored
project, or copy specific rows back).

## Quarterly restore drill

- [ ] Download last night's dump and decrypt it with the offline key.
- [ ] Restore into a scratch staging project using the procedure above.
- [ ] Run the smoke checks; record row counts and how long the restore took.
- [ ] Confirm the bucket lifecycle rule still deletes objects older than 30 days.
- [ ] Copy one storage bucket with rclone and spot-check a photo.
- [ ] Delete the scratch project.
- [ ] Note the date and any problems in the ops log.
