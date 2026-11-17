#!/usr/bin/env bash
# Regenerate packages/core/src/parity/legacy-cases.json from the legacy Laravel app.
# Usage: tools/parity/export-legacy.sh /path/to/pos-system/bite
# Needs PHP 8.3+ with pdo_sqlite and `composer install` done in the legacy app.
set -euo pipefail
LEGACY="${1:?path to the legacy Laravel app (pos-system/bite)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../packages/core/src/parity/legacy-cases.json"
TEST="$LEGACY/tests/Feature/LegacyParityExportTest.php"
cp "$HERE/LegacyParityExportTest.php" "$TEST"
trap 'rm -f "$TEST"' EXIT
mkdir -p "$(dirname "$OUT")"
(cd "$LEGACY" && PARITY_OUT="$OUT" php artisan test --filter=LegacyParityExportTest)
echo "wrote $OUT"
