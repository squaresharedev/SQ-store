#!/usr/bin/env bash
# CI ONLY (Linux runners). The Postgres binaries that embedded-postgres ships
# for Linux were built against ICU 60 (Ubuntu 18.04's libicu60), which the
# current Ubuntu runners do not have: without it initdb dies with
# "libicuuc.so.60: cannot open shared object file", and every suite that
# boots a database (test:db, the e2e stack) fails before a test runs.
#
# Installs that one package from Ubuntu's own archive, pinned to the checksum
# published in Ubuntu's signed bionic-updates package index, so a changed
# download fails here instead of being installed.
set -euo pipefail

URL="http://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu60_60.2-3ubuntu3.2_amd64.deb"
SHA256="f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209"
DEB="${RUNNER_TEMP:-/tmp}/libicu60.deb"

curl -fsSL --retry 3 -o "$DEB" "$URL"
echo "$SHA256  $DEB" | sha256sum -c -
sudo dpkg -i "$DEB"
echo "libicu60 installed."
