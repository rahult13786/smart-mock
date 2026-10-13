#!/bin/sh
set -eu

VERSION=""
CLEAN=no
TESTS=yes
ARCHIVE=yes
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --clean) CLEAN=yes; shift ;;
    --skip-tests) TESTS=no; shift ;;
    --no-archive) ARCHIVE=no; shift ;;
    -h|--help)
      echo "usage: sh deploy/build-package.sh [--version X.Y.Z] [--clean] [--skip-tests] [--no-archive]"
      echo "result: dist/Dockerfile, dist/mock-api-portal-<version>.tar.gz (+ .sha256), dist/DEPLOY.md"
      exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT=$(pwd)
step() { printf '\n▶ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is not installed (need 20.19+ or 22)"
command -v npm >/dev/null 2>&1 || die "npm is not installed"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  die "Node.js $(node -v) is too old – install 20.19+ or 22 (needed by Vite 8)"
fi
[ -n "$VERSION" ] || VERSION=$(node -p 'require("./package.json").version')
NAME="mock-api-portal-$VERSION"
echo "Building $NAME with Node $(node -v)"

if [ "$TESTS" = yes ]; then
  step "1/6 API tests"
  [ -d server/node_modules ] || npm --prefix server ci --no-audit --no-fund
  npm --prefix server test || die "tests failed – fix them or use --skip-tests"
else
  step "1/6 API tests skipped"
fi

step "2/6 building the portal"
if [ "$CLEAN" = yes ] || [ ! -d frontend/node_modules ]; then
  npm --prefix frontend ci --include=dev --no-audit --no-fund
fi
npm --prefix frontend run build

step "3/6 assembling release/"
rm -rf release
mkdir -p release/server release/frontend release/openshift
cp -R server/src server/package.json server/package-lock.json release/server/
cp -R frontend/dist release/frontend/dist
cp -R samples release/samples
cp deploy/release.Dockerfile release/Dockerfile
cp openshift/mock-api-portal.yaml openshift/simple-build.yaml release/openshift/
[ -f change.md ] && cp change.md release/change.md
cp USER_MANUAL.md release/USER_MANUAL.md

cat > release/start.sh <<'EOS'
#!/bin/sh
cd "$(dirname "$0")/server"
export NODE_ENV=production
export PORT="${PORT:-8080}"
export DATA_DIR="${DATA_DIR:-$(pwd)/data}"
echo "Mock API Portal on http://localhost:$PORT  (data: $DATA_DIR)"
exec node src/index.js
EOS
chmod +x release/start.sh

GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "n/a")
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > release/build-info.json <<EOS
{
  "name": "mock-api-portal",
  "version": "$VERSION",
  "gitCommit": "$GIT_COMMIT",
  "builtAt": "$BUILT_AT",
  "builtWithNode": "$(node -v)",
  "requiresNode": ">=20.19"
}
EOS

cat > release/DEPLOY.md <<EOS
# Mock API Portal $VERSION – deployment

Built $BUILT_AT (commit $GIT_COMMIT). Portal + API run in one Node.js process on one port (8080).
Health check: \`GET /health\`. Portal login: \`smadmin\` / \`smadmin\` (set \`SMADMIN_PASSWORD\`). Data: files in \`DATA_DIR\` (image default \`/opt/mock-api-portal/server/data\`;
the OpenShift Deployment mounts its volume at \`/data\` and sets \`DATA_DIR=/data\`) – keep it on a volume.

Files to deploy (all in the same folder):

    Dockerfile                         node:22-alpine + ADD mock-api-portal-$VERSION.tar.gz
    mock-api-portal-$VERSION.tar.gz    the application (Docker / OpenShift unpack it themselves)

## OpenShift

One time:

    oc new-project mock-api-portal
    oc apply -f openshift/mock-api-portal.yaml      # in the archive, or the project's openshift/ folder
    oc apply -f openshift/simple-build.yaml         # build = node:22-alpine from the cluster + this package

Every release (in the folder with Dockerfile + .tar.gz):

    oc start-build mock-api-portal --from-dir=. --follow
    oc rollout status deployment/mock-api-portal
    oc get route mock-api-portal -o jsonpath='https://{.spec.host}{"\n"}'

## Docker / Podman

    docker build --platform linux/amd64 -t mock-api-portal:$VERSION .
    docker run -d -p 8080:8080 -v mock-data:/opt/mock-api-portal/server/data mock-api-portal:$VERSION

Other base image (mirror / UBI): \`--build-arg NODE_IMAGE=<registry>/node:22-alpine\`

## Plain server with Node.js 20.19+ / 22 (no container)

    tar -xzf mock-api-portal-$VERSION.tar.gz
    PORT=8080 DATA_DIR=/var/lib/mock-api ./mock-api-portal/start.sh

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| PORT | 8080 | listen port |
| DATA_DIR | /opt/mock-api-portal/server/data (image) · server/data (start.sh) | data folder – keep it persistent |
| SEED_APIS | – | demo data, e.g. agreement@v1=samples/agreement.json |
| UPSTASH_REDIS_REST_URL / _TOKEN | – | keep data in Redis instead (hosts without a disk) |
| BODY_LIMIT | 50mb | max request size |
| SMADMIN_PASSWORD | smadmin | password of the built-in \`smadmin\` portal login – change it |
| SESSION_HOURS | 12 | portal login session length |
EOS

step "4/6 installing server dependencies (production only)"
(cd release/server && npm ci --omit=dev --no-audit --no-fund)
mkdir -p release/server/data
chmod -R g=u release

step "5/6 starting the package once to verify it"
node deploy/verify-release.js release || die "the package did not start correctly"

if [ "$ARCHIVE" = yes ]; then
  step "6/6 creating the archive"
  rm -rf dist
  mkdir -p dist/stage
  cp -Rp release dist/stage/mock-api-portal
  rm -f dist/stage/mock-api-portal/Dockerfile
  if tar --version 2>/dev/null | grep -q 'GNU tar'; then
    OWNER="--owner=0 --group=0 --numeric-owner"
  else
    OWNER="--uid 0 --gid 0"
  fi
  (cd dist/stage && COPYFILE_DISABLE=1 tar $OWNER -czf "../$NAME.tar.gz" mock-api-portal)
  rm -rf dist/stage
  sed "s/__VERSION__/$VERSION/" deploy/package.Dockerfile > dist/Dockerfile
  cp release/DEPLOY.md dist/DEPLOY.md
  [ -f release/change.md ] && cp release/change.md dist/change.md
  cp release/USER_MANUAL.md dist/USER_MANUAL.md
  if command -v sha256sum >/dev/null 2>&1; then
    (cd dist && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
  else
    (cd dist && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
  fi
  SIZE=$(du -h "dist/$NAME.tar.gz" | cut -f1)
  printf '\n✓ Ready to deploy – %s/dist:\n' "$ROOT"
  printf '    Dockerfile  %s.tar.gz (%s)  %s.tar.gz.sha256  DEPLOY.md\n' "$NAME" "$SIZE" "$NAME"
  printf '  OpenShift:  oc start-build mock-api-portal --from-dir=dist --follow\n'
  printf '  Docker:     cd dist && docker build --platform linux/amd64 -t mock-api-portal:%s .\n' "$VERSION"
else
  step "6/6 archive skipped (--no-archive)"
fi
[ "$ARCHIVE" = yes ] || printf '  folder:     %s/release  →  oc start-build mock-api-portal --from-dir=release --follow\n' "$ROOT"
