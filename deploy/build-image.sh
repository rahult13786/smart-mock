#!/bin/sh
set -eu

ARCH=amd64
FILE=Dockerfile
TAG=mock-api-portal:1.0
SAVE=no
EXTRA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --ubi) FILE=Dockerfile.ubi; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --save) SAVE=yes; shift ;;
    --build-arg) EXTRA="$EXTRA --build-arg $2"; shift 2 ;;
    --network) EXTRA="$EXTRA --network $2"; shift 2 ;;
    -h|--help)
      echo "usage: deploy/build-image.sh [--arch amd64|arm64|ppc64le|s390x] [--ubi] [--tag name:tag] [--save] [--build-arg K=V] [--network N]"
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  podman build --platform "linux/$ARCH" $EXTRA -f "$FILE" -t "$TAG" .
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
  docker buildx build --platform "linux/$ARCH" $EXTRA -f "$FILE" -t "$TAG" --load .
else
  echo "podman or docker is required" >&2; exit 1
fi

BUILT=$($ENGINE image inspect --format '{{.Os}}/{{.Architecture}}' "$TAG")
echo "Built $TAG for $BUILT"
if [ "$BUILT" != "linux/$ARCH" ]; then
  echo "WARNING: expected linux/$ARCH – this image will fail with 'exec format error' on $ARCH nodes" >&2
  exit 1
fi

if [ "$SAVE" = yes ]; then
  OUT="$(echo "$TAG" | tr '/:' '--')-$ARCH.tar"
  $ENGINE save -o "$OUT" "$TAG"
  echo "Saved $OUT – copy it to the cluster side and: $ENGINE load -i $OUT"
fi
