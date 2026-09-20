#!/bin/sh
# Respaldo de la base de datos. Ejecutar desde la raiz del proyecto:
#   ./deploy/respaldo.sh
# Restaurar:
#   gunzip -c deploy/respaldos/fina-AAAAMMDD-HHMMSS.sql.gz | \
#     docker compose exec -T db psql -U fina -d fina
set -eu

ARCHIVO="fina-$(date +%Y%m%d-%H%M%S).sql.gz"
USUARIO="${POSTGRES_USER:-fina}"
BASE="${POSTGRES_DB:-fina}"

mkdir -p deploy/respaldos
docker compose exec -T db pg_dump -U "$USUARIO" -d "$BASE" --clean --if-exists \
  | gzip -9 > "deploy/respaldos/$ARCHIVO"

echo "Respaldo listo: deploy/respaldos/$ARCHIVO ($(du -h "deploy/respaldos/$ARCHIVO" | cut -f1))"

# Conserva los ultimos 30 respaldos.
ls -1t deploy/respaldos/fina-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
