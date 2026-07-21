#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Assigned ecosystem ports (do not use 4000/5173 — those are HRMS)
API_PORT=4002
WEB_PORT=5174

echo "==> Freeing ports ${API_PORT} (API) and ${WEB_PORT} (frontend)..."
for port in "$API_PORT" "$WEB_PORT"; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    echo "    Killed process(es) on port $port"
  else
    echo "    Port $port is free"
  fi
done

echo "==> Starting PostgreSQL (Docker, port 5436)..."
docker compose up db -d

echo "==> Waiting for database..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U potracker >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Backend setup..."
cd "$ROOT/backend"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created backend/.env from .env.example"
fi
npm install --silent 2>/dev/null || npm install
npx prisma generate
npx prisma migrate deploy

echo "==> Frontend setup..."
cd "$ROOT/frontend"
npm install --silent 2>/dev/null || npm install

echo "==> Starting backend (http://localhost:${API_PORT})..."
cd "$ROOT/backend"
npm run dev &
BACKEND_PID=$!

echo "==> Starting frontend (http://localhost:${WEB_PORT})..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "  PO Tracker dev stack is running"
echo "  App:      http://localhost:${WEB_PORT}"
echo "  API:      http://localhost:${API_PORT}"
echo "  Postgres: localhost:5436"
echo "  Login:    admin@ufp.local / ChangeMe123!"
echo "============================================"
echo "  Backend PID:  $BACKEND_PID"
echo "  Frontend PID: $FRONTEND_PID"
echo "  Press Ctrl+C to stop both servers"
echo "============================================"

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT TERM
wait
