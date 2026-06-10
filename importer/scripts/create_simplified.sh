#!/usr/gmt-venv/bin/python

import sys
from pathlib import Path

sys.path.append((Path(__file__).parent.parent / 'src').absolute())

from simplify.simplify_boundaries import simplify_boundaries

# Create a simplified version of boundary polygons
simplify_boundaries()