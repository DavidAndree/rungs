#!/usr/bin/env bash
# Download the O*NET 31.0 CSV files Rungs is built from (CC BY 4.0, USDOL/ETA).
set -euo pipefail
cd "$(dirname "$0")/../data" && mkdir -p onet && cd onet
BASE="https://www.onetcenter.org/dl_files/database/db_31_0_csv"
for f in occupation_data transferable_skills essential_skills knowledge software_skills related_occupations job_zones job_titles; do
  echo "fetching $f.csv"
  curl -fsSL -A "Mozilla/5.0" -o "$f.csv" "$BASE/$f.csv"
done
echo "done: $(ls | wc -l | tr -d ' ') files in data/onet"
