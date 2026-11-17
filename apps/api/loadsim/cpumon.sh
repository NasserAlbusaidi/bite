#!/usr/bin/env bash
# cpumon.sh <pid> <outfile>: API process CPU% every 2s (epoch_ms cpu%)
P=$1; OUT=$2; HZ=$(getconf CLK_TCK)
prev=$(awk '{print $14+$15}' /proc/$P/stat); pt=$(date +%s%3N)
while kill -0 $P 2>/dev/null; do sleep 2; cur=$(awk '{print $14+$15}' /proc/$P/stat 2>/dev/null) || break; t=$(date +%s%3N)
echo "$t $(echo "scale=1; ($cur-$prev)*100*1000/$HZ/($t-$pt)" | bc)" >> $OUT; prev=$cur; pt=$t; done
