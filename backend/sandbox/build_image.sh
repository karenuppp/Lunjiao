#!/bin/bash
# Build the sandbox image and optionally export to tar for offline deployment.
set -e

IMAGE_NAME="zhiwei-sandbox"
TAG="latest"
FULL_NAME="${IMAGE_NAME}:${TAG}"
TAR_FILE="${IMAGE_NAME}_${TAG}.tar"

cd "$(dirname "$0")"

echo "==> Building sandbox image: ${FULL_NAME}"
docker build -t "${FULL_NAME}" .

if [ "${1}" = "--export" ]; then
    echo "==> Exporting to: ${TAR_FILE}"
    docker save -o "${TAR_FILE}" "${FULL_NAME}"
    echo "==> Done. Copy ${TAR_FILE} to the offline server and run:"
    echo "    docker load -i ${TAR_FILE}"
else
    echo "==> Done. To export for offline deployment:"
    echo "    $0 --export"
fi
