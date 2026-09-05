#!/usr/bin/env bash
# Downloads Vazirmatn (SIL OFL) and vendors the woff2 files this project ships
# self-hosted, under web/public/assets/fonts/. Nothing in the running app ever
# fetches a font from a CDN — these files are committed so a clean clone
# builds and runs completely offline.
#
# Usage: scripts/fetch-fonts.sh
set -euo pipefail

VERSION="v33.003"
URL="https://github.com/rastikerdar/vazirmatn/releases/download/${VERSION}/vazirmatn-${VERSION}.zip"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ROOT_DIR}/web/public/assets/fonts"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "fetch-fonts: downloading Vazirmatn ${VERSION}..."
if ! curl -fL --retry 3 -o "${WORK_DIR}/vazirmatn.zip" "${URL}"; then
  echo "fetch-fonts: FAILED to download ${URL}" >&2
  exit 1
fi

echo "fetch-fonts: extracting..."
if ! unzip -q -o "${WORK_DIR}/vazirmatn.zip" -d "${WORK_DIR}/extracted"; then
  echo "fetch-fonts: FAILED to extract archive" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"

# Variable font (weights 100-900 in one file) plus static 400/500/700, which
# is what web/src/styles/theme.css's @font-face rules reference.
FILES=(
  "fonts/webfonts/Vazirmatn[wght].woff2"
  "fonts/webfonts/Vazirmatn-Regular.woff2"
  "fonts/webfonts/Vazirmatn-Medium.woff2"
  "fonts/webfonts/Vazirmatn-Bold.woff2"
)

for f in "${FILES[@]}"; do
  src="${WORK_DIR}/extracted/${f}"
  if [ ! -f "${src}" ]; then
    echo "fetch-fonts: expected file missing from archive: ${f}" >&2
    exit 1
  fi
  cp "${src}" "${DEST_DIR}/$(basename "${f}")"
  echo "fetch-fonts: wrote ${DEST_DIR}/$(basename "${f}")"
done

# OFL license text, so the vendored binaries carry their license alongside them.
cp "${WORK_DIR}/extracted/OFL.txt" "${DEST_DIR}/OFL.txt"

echo "fetch-fonts: done. Commit web/public/assets/fonts/*.woff2 and OFL.txt."
