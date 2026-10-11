#!/bin/sh
exec sh "$(dirname "$0")/build-package.sh" --skip-tests --no-archive "$@"
