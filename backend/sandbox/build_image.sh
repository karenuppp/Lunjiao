#!/bin/bash
# Build the sandbox image and optionally export to tar for offline deployment.
set -e

IMAGE_NAME="zhiwei-sandbox"
TAG="latest"
FULL_NAME="${IMAGE_NAME}:${TAG}"
TAR_FILE="${IMAGE_NAME}_${TAG}.tar"

cd "$(dirname "$0")"

# Copy fonts from project fonts directory into build context
FONTS_SRC="../../fonts"
if [ -d "$FONTS_SRC" ]; then
    echo "==> Copying fonts from ${FONTS_SRC}"
    rm -rf fonts
    cp -r "$FONTS_SRC" fonts
else
    echo "==> Warning: fonts directory not found at ${FONTS_SRC}, skipping"
    mkdir -p fonts
fi

echo "==> Building sandbox image: ${FULL_NAME}"
docker build -t "${FULL_NAME}" .

# Clean up copied fonts
rm -rf fonts

if [ "${1}" = "--export" ]; then
    echo "==> Exporting to: ${TAR_FILE}"
    docker save -o "${TAR_FILE}" "${FULL_NAME}"
    echo "==> Done. Copy ${TAR_FILE} to the offline server and run:"
    echo "    docker load -i ${TAR_FILE}"
else
    echo "==> Done. To export for offline deployment:"
    echo "    $0 --export"
fi
