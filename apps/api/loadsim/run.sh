#!/usr/bin/env bash
# usage: run.sh <out> <day YYYY-MM-DD> <from HH:MM> <to ISO-local e.g. 2026-11-20T01:20> <speed> [mode] [qrFixed] [pool]
set -euo pipefail
pkill -f "loadsim/server.ts" 2>/dev/null || true; sleep 1
cd "$(dirname "$0")/.."
OUT=$1; DAY=$2; FROM=$3; TO=$4; SPEED=$5; MODE=${6:-day}; QRF=${7:-0}; POOL=${8:-10}
export SIM_DAY=$DAY SIM_SPEED=$SPEED SIM_MODE=$MODE SIM_QR_FIXED=$QRF SIM_OUT=$OUT SIM_POOL=$POOL
export SIM_FROM="${DAY}T${FROM}:00+04:00"
export SIM_VIRT0=$(node -e "console.log(new Date(Date.parse(process.env.SIM_FROM)-60000*${SPEED}*0.1).toISOString())")
export SIM_TO="${TO}:00+04:00"
export SIM_REAL0=$(( $(date +%s%3N) + 4000 ))
# virt0 is 0.1 real-min before FROM; real0 is 4s from now
npx tsx --env-file=.env loadsim/server.ts > loadsim/out/$OUT.server.log 2>&1 &
API=$!
sleep 3
API_PID=$(pgrep -f "preflight.cjs.*loadsim/server.ts" | tail -1)
(./loadsim/cpumon.sh $API_PID loadsim/out/$OUT.apicpu.txt &)
sleep 3
API_PID=$API_PID npx tsx loadsim/sim.ts 2>&1 | tee loadsim/out/$OUT.sim.log
kill $API $API_PID 2>/dev/null || true
