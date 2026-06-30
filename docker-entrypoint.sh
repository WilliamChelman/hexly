#!/bin/sh
# Boots the production server: one TrailBase process serving the built Angular SPA
# and the API/admin on a single origin (ADR-0008, ADR-0032).
set -e

# Seed the committed closed-set config (ADR-0004) into a fresh depot. Never clobber
# an existing one — once running, the admin UI owns config.textproto in the volume.
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/config.textproto" ]; then
  cp /app/config.textproto "$DATA_DIR/config.textproto"
fi

# Always refresh the migrations from the image: they are forward-only and
# TrailBase's apply-once ledger skips ones already run, so a new release's
# migrations reach an existing volume while applied ones are no-ops.
# ponytail: full overwrite; Hexly authors migrations in-repo, not via the admin UI.
mkdir -p "$DATA_DIR/migrations"
cp -R /app/migrations/. "$DATA_DIR/migrations/"

# --spa falls index.html back for client routes; /api and /_ stay owned by TrailBase.
# The depot (DB, config, uploads) lives in $DATA_DIR, mounted as a volume.
exec trail run -a "0.0.0.0:${PORT}" --public-dir /app/web --spa
