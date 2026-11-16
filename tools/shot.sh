#!/bin/bash
# Dev helper: headless screenshot of the built game (Windows + Edge).
#   tools/shot.sh <name> <query> [virtual_time_ms] [width,height]
# e.g. tools/shot.sh play "autoplay&warp=20&arena=sunset" 9000
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
OUT="${OUT:-$(pwd -W 2>/dev/null || pwd)/shots}"
mkdir -p "$OUT"
PROFILE="$(mktemp -d)"
"$EDGE" --headless=new --disable-gpu-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader \
  --window-size=${4:-1280,720} --virtual-time-budget=${3:-6000} --user-data-dir="$(cygpath -w "$PROFILE" 2>/dev/null || echo "$PROFILE")" \
  --screenshot="$OUT/$1.png" "file:///$(pwd -W 2>/dev/null || pwd)/dist/index.html?$2" 2>&1 | grep -i "written"
rm -rf "$PROFILE"
