# Minimal makefile for Sphinx documentation
#

# You can set these variables from the command line, and also
# from the environment for the first two.
SPHINXOPTS    ?=
SPHINXBUILD   ?= sphinx-build
SOURCEDIR     = .
BUILDDIR      = _build

# Put it first so that "make" without argument is like "make help".
help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

.PHONY: help Makefile

# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

# collect all files to cache
	cd ./_build/html && find -type f > _static/filesToCache.txt
# the service worker anf the manifest must be beside the root
	cd ./_build/html && cp _static/sw.js sw.js
	cd ./_build/html && cp _static/manifest.webmanifest manifest.webmanifest
# Allow change detection
	cd ./_build/html/_static && date +"%y.%d.%m %H:%M:%S" > version
