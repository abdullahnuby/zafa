#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PARTS_DIR="$SCRIPT_DIR/zaffa-mvp-parts"
ARCHIVE="$SCRIPT_DIR/zaffa-mvp-0.1.0.tar.xz"
EXPECTED_SHA256="f321b4f6d7f0770e118cd3f5183346087a6ce415bd59ac81bf17c1294aca53e9"

if [[ ! -f "$ARCHIVE" ]]; then
  if [[ ! -d "$PARTS_DIR" ]]; then
    echo "Missing archive and fallback parts directory: $PARTS_DIR" >&2
    exit 1
  fi
  shopt -s nullglob
  parts=("$PARTS_DIR"/part-[0-9][0-9].b64)
  if [[ "${#parts[@]}" -ne 9 ]]; then
    echo "Expected 9 archive parts; found ${#parts[@]}" >&2
    exit 1
  fi
  if base64 --decode </dev/null >/dev/null 2>&1; then
    decoder=(base64 --decode)
  else
    decoder=(base64 -D)
  fi
  {
    for part in "${parts[@]}"; do
      tr -d '\r\n ' < "$part"
    done
  } | "${decoder[@]}" > "$ARCHIVE"
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
fi

if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "Archive SHA-256 mismatch. Expected $EXPECTED_SHA256; got $ACTUAL_SHA256" >&2
  exit 1
fi

tar -xJf "$ARCHIVE" --strip-components=1 -C "$ROOT"
echo "ZAFFA 0.1.0 restored successfully."
echo "Next: npm test && npm start"
