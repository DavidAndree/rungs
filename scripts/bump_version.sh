#!/usr/bin/env bash
# Bump the cache-busting ?v=N on every asset (HTML, JS modules, CSS and graph.json) after a change.
set -euo pipefail
cd "$(dirname "$0")/../docs"
cur=$(grep -o 'app.js?v=[0-9]*' index.html | grep -o '[0-9]*$')
next=$((cur + 1))
sed -i '' "s/?v=$cur/?v=$next/g" index.html js/*.js
echo "v$cur -> v$next"
