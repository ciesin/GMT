cd /src

#!/bin/bash

cd /src

for dir in modules api; do
  ruff format --config ruff.toml /src/$dir
  mypy --config-file mypy.ini /src/$dir
  ruff check --config ruff.toml --fix /src/$dir
done
