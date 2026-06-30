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

# --spa falls index.html back for client routes; /api and /_ stay owned by TrailBase.
# The depot (DB, config, uploads) lives in $DATA_DIR, mounted as a volume.
exec trail run -a "0.0.0.0:${PORT}" --public-dir /app/web --spa
