# Used in visual studio code task

#!/bin/bash
set -e

cd "$(dirname "$0")"
cd ../..

docker exec -i --tty=false  `docker ps -aqf "name=gmt_importer"` bash <<'EOF'
cd /rust
cargo build
EOF
