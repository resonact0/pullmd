#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
MAJOR_MINOR=$(echo "$VERSION" | cut -d. -f1,2)
MAJOR=$(echo "$VERSION" | cut -d. -f1)

echo "Building aeternalabshq/pullmd:$VERSION (also tagged $MAJOR_MINOR, $MAJOR, latest)"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "aeternalabshq/pullmd:$VERSION" \
  -t "aeternalabshq/pullmd:$MAJOR_MINOR" \
  -t "aeternalabshq/pullmd:$MAJOR" \
  -t aeternalabshq/pullmd:latest \
  --push \
  .
