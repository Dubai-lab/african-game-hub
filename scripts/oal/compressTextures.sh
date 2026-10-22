#!/bin/bash
# One Africa Life: a packed game file's pictures made KTX2 (Basis ETC1S; the game turns them on
# the device into its graphics chip's own compressed form: a fraction of the memory). Its shapes
# unpacked and packed again from plain numbers. Usage:
#   scripts/oal/compressTextures.sh <from under public/oal> <to under public/oal> [gltfpack flags]
# (-kv for the characters: their hide marks are vertex colours; -vpf for the big street scenes.)
# Needs the native gltfpack (the npm one has no BasisU): GLTFPACK=/path/to/gltfpack, and in
# scripts/oal: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
set -e
from=$1; to=$2; shift 2
tmp=$(mktemp --suffix=.glb)
node "$(dirname "$0")/toPng.mjs" "public/oal/$from" "$tmp" >/dev/null
"${GLTFPACK:-gltfpack}" -i "$tmp" -o "public/oal/$to" -tc -tq 10 -cc -kn -km -ke "$@"
rm -f "$tmp"
