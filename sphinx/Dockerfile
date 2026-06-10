FROM sphinxdoc/sphinx
WORKDIR /docs
COPY UserGuide/ /docs
RUN pip3 install Sphinx sphinx-rtd-theme
RUN make html
ENTRYPOINT /bin/true
