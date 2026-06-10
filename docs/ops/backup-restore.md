# Backup and Restore Operations

> Operational guide for backing up and restoring the OpenHawkins durable state
> (SQLite event store + Vault file). Applies to any node running `openhawkins-run`.

---

## What to back up

Two files contain all durable state:

| File                     | Purpose                        | Notes                                                                                      |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `openhawkins.db`         | SQLite event store + audit log | WAL mode enabled; sibling `-wal` and `-shm` files appear at runtime                        |
| `openhawkins-vault.json` | Encrypted Vault (AES-256-GCM)  | Holds the audit HMAC key and any adapter secrets; **never** back up without the passphrase |

> **Important:** The SQLite database uses WAL (`journal_mode = WAL`). You must include
> the `-wal` and `-shm` files if you copy while the process is running, **or** perform a
> WAL checkpoint first so the single `.db` file is self-contained.

---

## How to back up (atomic copy with WAL checkpoint)

### Option A — Online backup (process stays up)

Use the SQLite CLI to perform a checkpoint, then copy all three files atomically:

```bash
DB=/var/lib/openhawkins/openhawkins.db
VAULT=/var/lib/openhawkins/openhawkins-vault.json
BACKUP_DIR=/backup/openhawkins/$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# 1. Checkpoint WAL into the main database file
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);"

# 2. Copy the now self-contained .db file and the Vault
#    Use cp --reflink=auto when available (CoW filesystems) for instant snapshots
cp --reflink=auto "$DB" "$BACKUP_DIR/openhawkins.db"
cp --reflink=auto "$VAULT" "$BACKUP_DIR/openhawkins-vault.json"

# 3. Record checksums
sha256sum "$BACKUP_DIR/openhawkins.db" "$BACKUP_DIR/openhawkins-vault.json" > "$BACKUP_DIR/sha256sums"
```

> `TRUNCATE` blocks writers briefly, merges the WAL completely, and deletes the `-wal`/`-shm`
> files so you only need to copy the `.db` file. For read-heavy systems where you cannot
> tolerate even a brief write pause, use `PASSIVE` instead and copy all three files together.

### Option B — Offline backup (process stopped)

If you can stop the service (e.g. during a maintenance window):

```bash
systemctl stop openhawkins.service

BACKUP_DIR=/backup/openhawkins/$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
cp /var/lib/openhawkins/openhawkins.db   "$BACKUP_DIR/"
cp /var/lib/openhawkins/openhawkins-vault.json "$BACKUP_DIR/"
sha256sum "$BACKUP_DIR"/* > "$BACKUP_DIR/sha256sums"

systemctl start openhawkins.service
```

### Option C — SQLite online backup API (most robust)

If the `sqlite3` CLI is available, use its built-in backup command, which handles WAL
consistency automatically:

```bash
sqlite3 /var/lib/openhawkins/openhawkins.db ".backup '$BACKUP_DIR/openhawkins.db'"
cp /var/lib/openhawkins/openhawkins-vault.json "$BACKUP_DIR/"
```

---

## How to restore from backup

1. **Stop the service** (never restore into a live database):

   ```bash
   systemctl stop openhawkins.service
   ```

2. **Restore the files**:

   ```bash
   # Example: restoring from today's backup
   RESTORE_DIR=/backup/openhawkins/20260610-030000
   DB_DIR=/var/lib/openhawkins

   cp "$RESTORE_DIR/openhawkins.db" "$DB_DIR/"
   cp "$RESTORE_DIR/openhawkins-vault.json" "$DB_DIR/"
   chown openhawkins:openhawkins "$DB_DIR/openhawkins.db" "$DB_DIR/openhawkins-vault.json"
   chmod 600 "$DB_DIR/openhawkins-vault.json"
   ```

3. **Remove stale WAL/SHM** if they exist from a previous run (they would mismatch the restored DB):

   ```bash
   rm -f "$DB_DIR/openhawkins.db-wal" "$DB_DIR/openhawkins.db-shm"
   ```

4. **Start the service**:

   ```bash
   systemctl start openhawkins.service
   ```

---

## How to verify integrity after restore

Run `verifyDurable` via the `openhawkins-run` CLI in `--verify` mode:

```bash
node packages/state/dist/bin/openhawkins-run.js \
  --db /var/lib/openhawkins/openhawkins.db \
  --vault /var/lib/openhawkins/openhawkins-vault.json \
  --verify
```

Expected output (human-readable):

```
verify: {"events":1234,"auditEntries":1234,"auditVerified":true}
```

Or with `--json` for programmatic use:

```bash
node packages/state/dist/bin/openhawkins-run.js \
  --db /var/lib/openhawkins/openhawkins.db \
  --vault /var/lib/openhawkins/openhawkins-vault.json \
  --verify --json
```

### Interpreting the result

| Field           | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `events`        | Number of domain events in the event store                                      |
| `auditEntries`  | Number of entries in the keyed audit log                                        |
| `auditVerified` | `true` if the HMAC chain is intact; `false` indicates tampering or corruption   |
| `auditBrokenAt` | (present only if `auditVerified` is `false`) The index of the first broken link |
| `auditReason`   | (present only if `auditVerified` is `false`) Human-readable failure reason      |

> **If `auditVerified` is `false`, do not start production runs.** Investigate whether the
> backup itself was corrupted, whether the wrong Vault passphrase was used, or whether the
> database and Vault files came from mismatched backups.

---

## Recommended backup schedule and retention

| Environment             | Frequency                                                         | Retention                    | Notes                                                                   |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| **Production**          | Every 4 hours + continuous streaming WAL archiving (if available) | 30 days daily, 7 days hourly | Use `sqlite3 .backup` or LVM/ZFS snapshots for near-instant consistency |
| **Staging**             | Daily                                                             | 7 days                       | Align with prod for validation                                          |
| **Development / local** | On-demand before schema migrations                                | 3 most recent                | Manual `cp` is sufficient                                               |

### Automation tips

- Run backups from a systemd timer or cron job as the `openhawkins` user (or root with `sudo -u openhawkins`).
- Always validate the checksum of the backup immediately after creation (`sha256sum -c sha256sums`).
- Store backups off-host; the Vault file is encrypted, but treat it with the same care as the database.
- Test restores quarterly on a non-production instance.
- Keep the Vault passphrase in a separate secrets manager (e.g. HashiCorp Vault, 1Password, AWS Secrets Manager); **do not** store it next to the backup files.

---

## Emergency: recovering from a corrupted database

If SQLite reports `database disk image is malformed`:

1. Stop the service.
2. Attempt a dump/restore of the schema + data:
   ```bash
   sqlite3 corrupted.db ".dump" > dump.sql
   sqlite3 new.db < dump.sql
   ```
3. Restore the Vault file from the same point-in-time backup as the database.
4. Run `--verify`; if the audit chain fails, the dump/restore may have changed row IDs or timestamps. In that case, fall back to the last verified backup.
5. Start the service.

> Because the audit chain is hash-linked, any mutation to the database contents (even
> well-intentioned repair) will break `auditVerified`. Always prefer restoring a known-good
> backup over in-place repair.
