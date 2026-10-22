#!/usr/bin/env bash
# SGBD de test pour l'exécution réelle des scripts LDD générés (overrides O-29, O-35).
#   scripts/sgbd.sh up [sgbd…]    démarre les SGBD (par défaut : postgres mysql oracle mssql)
#   scripts/sgbd.sh wait [sgbd…]  attend qu'ils acceptent les connexions
#   scripts/sgbd.sh down          arrête et supprime les conteneurs
# Puis : pnpm test:sgbd   (SGBD_DOCKER=1 vitest run src/core/ddl/sgbd : sgbd.test.ts, sgbdPostgres.test.ts)
# Exemple (CI) : scripts/sgbd.sh up postgres mysql && scripts/sgbd.sh wait postgres mysql
set -euo pipefail

MSSQL_PASSWORD='ModelIt-2026'
ALL=(postgres postgis mysql oracle mssql)

start() {
  case "$1" in
    postgres) docker run -d --name merise-postgres -e POSTGRES_PASSWORD=postgres postgres:18 >/dev/null ;;
    # PostgreSQL 18 + PostGIS (O-42) : image officielle amd64, émulée sur Apple Silicon.
    postgis) docker run -d --name merise-postgis --platform linux/amd64 -e POSTGRES_PASSWORD=postgres postgis/postgis:18-3.6 >/dev/null ;;
    mysql) docker run -d --name merise-mysql -e MYSQL_ROOT_PASSWORD=root mysql:8.4 >/dev/null ;;
    oracle) docker run -d --name merise-oracle -e ORACLE_PASSWORD=oracle gvenzl/oracle-free:23-slim-faststart >/dev/null ;;
    # Image amd64 uniquement : émulée sur Apple Silicon (Rosetta).
    mssql) docker run -d --name merise-mssql --platform linux/amd64 -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$MSSQL_PASSWORD" \
      mcr.microsoft.com/mssql/server:2022-latest >/dev/null || echo "SQL Server : démarrage impossible (émulation amd64 ?)" ;;
    *) echo "SGBD inconnu : $1" >&2; exit 1 ;;
  esac
}

ready() {
  case "$1" in
    postgres) docker exec merise-postgres pg_isready -U postgres >/dev/null 2>&1 && docker exec merise-postgres psql -U postgres -c 'SELECT 1' >/dev/null 2>&1 ;;
    postgis) docker exec merise-postgis pg_isready -U postgres >/dev/null 2>&1 && docker exec merise-postgis psql -U postgres -c 'SELECT 1' >/dev/null 2>&1 ;;
    # L'image démarre d'abord un serveur temporaire (initialisation), puis le redémarre : prêt
    # seulement après « init process done », sinon les tests tombent pendant le redémarrage.
    mysql) [[ $(docker logs merise-mysql 2>&1) == *'MySQL init process done'* ]] \
      && docker exec merise-mysql mysql -uroot -proot -e 'SELECT 1' >/dev/null 2>&1 ;;
    oracle) docker exec merise-oracle healthcheck.sh >/dev/null 2>&1 ;;
    mssql) docker exec merise-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_PASSWORD" -Q 'SELECT 1' >/dev/null 2>&1 ;;
  esac
}

wait_for() {
  for db in "$@"; do
    docker inspect "merise-$db" >/dev/null 2>&1 || { echo "$db : absent"; continue; }
    printf '%s : ' "$db"
    for _ in $(seq 1 150); do ready "$db" && { echo prêt; continue 2; }; sleep 2; done
    echo "pas prêt après 5 min"
    exit 1
  done
}

down() {
  docker rm -f merise-postgres merise-postgis merise-mysql merise-oracle merise-mssql >/dev/null 2>&1 || true
}

command="${1:-}"
shift || true
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=("${ALL[@]}")
case "$command" in
  up) for db in "${targets[@]}"; do start "$db"; done ;;
  wait) wait_for "${targets[@]}" ;;
  down) down ;;
  *) echo "usage : $0 up|wait|down [postgres postgis mysql oracle mssql]" >&2; exit 1 ;;
esac
