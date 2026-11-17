#!/usr/bin/env bash
# stress.sh C1 C2 ... : one level per C (tenant-equivalents), each on its own sim day.
cd "$(dirname "$0")"
i=0
for C in "$@"; do
  i=$((i+1)); DAY=$(date -d "2026-11-21 +$i day" +%F); NEXT=$(date -d "$DAY" +%F)
  echo "=== C=$C day=$DAY"
  SIM_C=$C ./run.sh stress-c$C $DAY 20:00 ${NEXT}T21:30 40 stress ${QRF:-0} ${POOL:-10} > /dev/null 2>&1
  node analyze.mjs out/stress-c$C.json | head -1
done
