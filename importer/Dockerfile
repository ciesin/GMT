##
# osgeo/gdal:ubuntu-small

# This file is available at the option of the licensee under:
# Public domain
# or licensed under MIT (LICENSE.TXT) Copyright 2019 Even Rouault <even.rouault@spatialys.com>

# General idea is base this off ubuntu-small  -- https://github.com/OSGeo/gdal/blob/master/docker/ubuntu-small/Dockerfile
# Except with FileGDB and LibJXL

ARG PROJ_INSTALL_PREFIX=/usr/local
ARG BASE_IMAGE=ubuntu:24.04
ARG TARGET_BASE_IMAGE=ubuntu:24.04

FROM $BASE_IMAGE AS builder

# Derived from osgeo/proj by Howard Butler <howard@hobu.co>
LABEL maintainer="Even Rouault <even.rouault@spatialys.com>"

ARG TARGET_ARCH=
RUN echo ${TARGET_ARCH}
COPY ./docker/bh-set-envvars.sh /buildscripts/bh-set-envvars.sh


# Setup build env for PROJ
USER root
RUN . /buildscripts/bh-set-envvars.sh \
    && apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --fix-missing --no-install-recommends \
        build-essential ca-certificates \
        git make cmake wget unzip libtool automake \
        zlib1g-dev${APT_ARCH_SUFFIX} libsqlite3-dev${APT_ARCH_SUFFIX} pkg-config sqlite3 libcurl4-openssl-dev${APT_ARCH_SUFFIX} \
        libtiff-dev${APT_ARCH_SUFFIX}

# Setup build env for GDAL
RUN . /buildscripts/bh-set-envvars.sh \
    && apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --fix-missing --no-install-recommends \
       python3-dev${APT_ARCH_SUFFIX} python3-numpy${APT_ARCH_SUFFIX} python3-setuptools${APT_ARCH_SUFFIX} \
       libjpeg-dev${APT_ARCH_SUFFIX} libgeos-dev${APT_ARCH_SUFFIX} \
       libexpat-dev${APT_ARCH_SUFFIX} libxerces-c-dev${APT_ARCH_SUFFIX} \
       libwebp-dev${APT_ARCH_SUFFIX} libpng-dev${APT_ARCH_SUFFIX} \
       libzstd-dev${APT_ARCH_SUFFIX} bash zip curl \
       libpq-dev${APT_ARCH_SUFFIX} libssl-dev${APT_ARCH_SUFFIX} libopenjp2-7-dev${APT_ARCH_SUFFIX} \
       libspatialite-dev${APT_ARCH_SUFFIX} \
       autoconf automake sqlite3 bash-completion swig


ARG WITH_FILEGDB=yes
RUN . /buildscripts/bh-set-envvars.sh \
  && if echo "$WITH_FILEGDB" | grep -Eiq "^(y(es)?|1|true)$"  ; then ( \
  wget -q https://github.com/Esri/file-geodatabase-api/raw/master/FileGDB_API_1.5.2/FileGDB_API-RHEL7-64gcc83.tar.gz \
  && tar -xzf FileGDB_API-RHEL7-64gcc83.tar.gz \
  && chown -R root:root FileGDB_API-RHEL7-64gcc83 \
  && mv FileGDB_API-RHEL7-64gcc83 /usr/local/FileGDB_API \
  && rm -rf /usr/local/FileGDB_API/lib/libstdc++* \
  && mkdir -p /build_thirdparty/usr/lib/x86_64-linux-gnu \
  && cp /usr/local/FileGDB_API/lib/* /build_thirdparty/usr/lib/x86_64-linux-gnu \
  && cp /usr/local/FileGDB_API/include/* /usr/include \
  && rm -rf FileGDB_API-RHEL7-64gcc83.tar.gz \
  ) ; fi

# Build libjxl
RUN . /buildscripts/bh-set-envvars.sh \
    && apt-get update -y \
    && apt-get install -y --fix-missing --no-install-recommends libgflags-dev${APT_ARCH_SUFFIX} \
    && git clone https://github.com/libjxl/libjxl.git --depth 1 --single-branch --recursive --branch v0.8.2 \
    && cd libjxl \
    && mkdir build \
    && cd build \
    && cmake -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release -DJPEGXL_ENABLE_JPEGLI_LIBJPEG=OFF -DBUILD_TESTING=OFF -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF .. \
    && make -j$(nproc) \
    && make -j$(nproc) install \
    && make install DESTDIR="/build_thirdparty" \
    && rm -f /lib/${GCC_ARCH}-linux-gnu/libjxl*.a \
    && rm -f /build_thirdparty/lib/${GCC_ARCH}-linux-gnu/libjxl*.a \
    && cd ../.. \
    && rm -rf libjxl

ARG PROJ_INSTALL_PREFIX
ARG PROJ_DATUMGRID_LATEST_LAST_MODIFIED
RUN \
    mkdir -p /build_projgrids/${PROJ_INSTALL_PREFIX}/share/proj \
    && curl -LOs http://download.osgeo.org/proj/proj-datumgrid-latest.zip \
    && unzip -q -j -u -o proj-datumgrid-latest.zip  -d /build_projgrids/${PROJ_INSTALL_PREFIX}/share/proj \
    && rm -f *.zip

RUN apt-get update -y \
    && apt-get install -y --fix-missing --no-install-recommends rsync ccache

ARG RSYNC_REMOTE

# Build PROJ
ARG PROJ_VERSION=9.5.1
RUN . /buildscripts/bh-set-envvars.sh \
    && mkdir proj \
    && wget -q https://github.com/OSGeo/PROJ/archive/${PROJ_VERSION}.tar.gz -O - \
        | tar xz -C proj --strip-components=1 \
    && cd proj \
    && if test "${RSYNC_REMOTE:-}" != ""; then \
        echo "Downloading cache..."; \
        rsync -ra ${RSYNC_REMOTE}/proj/${GCC_ARCH}/ $HOME/; \
        echo "Finished"; \
        export CC="ccache ${GCC_ARCH}-linux-gnu-gcc"; \
        export CXX="ccache ${GCC_ARCH}-linux-gnu-g++"; \
        export PROJ_DB_CACHE_DIR="$HOME/.ccache"; \
        ccache -M 100M; \
    fi \
    && CFLAGS='-DPROJ_RENAME_SYMBOLS -O2' CXXFLAGS='-DPROJ_RENAME_SYMBOLS -DPROJ_INTERNAL_CPP_NAMESPACE -O2' \
        cmake . \
        -DBUILD_SHARED_LIBS=ON \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=${PROJ_INSTALL_PREFIX} \
        -DBUILD_TESTING=OFF \
    && make -j$(nproc) \
    && make install DESTDIR="/build" \
    && if test "${RSYNC_REMOTE:-}" != ""; then \
        ccache -s; \
        echo "Uploading cache..."; \
        rsync -ra --delete $HOME/.ccache ${RSYNC_REMOTE}/proj/${GCC_ARCH}/; \
        echo "Finished"; \
        rm -rf $HOME/.ccache; \
        unset CC; \
        unset CXX; \
    fi \
    && cd .. \
    && rm -rf proj \
    && PROJ_SO=$(readlink -f /build${PROJ_INSTALL_PREFIX}/lib/libproj.so | awk 'BEGIN {FS="libproj.so."} {print $2}') \
    && PROJ_SO_FIRST=$(echo $PROJ_SO | awk 'BEGIN {FS="."} {print $1}') \
    && mv /build${PROJ_INSTALL_PREFIX}/lib/libproj.so.${PROJ_SO} /build${PROJ_INSTALL_PREFIX}/lib/libinternalproj.so.${PROJ_SO} \
    && ln -s libinternalproj.so.${PROJ_SO} /build${PROJ_INSTALL_PREFIX}/lib/libinternalproj.so.${PROJ_SO_FIRST} \
    && ln -s libinternalproj.so.${PROJ_SO} /build${PROJ_INSTALL_PREFIX}/lib/libinternalproj.so \
    && rm /build${PROJ_INSTALL_PREFIX}/lib/libproj.*  \
    && ${GCC_ARCH}-linux-gnu-strip -s /build${PROJ_INSTALL_PREFIX}/lib/libinternalproj.so.${PROJ_SO} \
    && for i in /build${PROJ_INSTALL_PREFIX}/bin/*; do ${GCC_ARCH}-linux-gnu-strip -s $i 2>/dev/null || /bin/true; done \
    && apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y patchelf \
    && rm -rf /var/lib/apt/lists/* \
    && patchelf --set-soname libinternalproj.so.${PROJ_SO_FIRST} /build${PROJ_INSTALL_PREFIX}/lib/libinternalproj.so.${PROJ_SO} \
    && for i in /build${PROJ_INSTALL_PREFIX}/bin/*; do patchelf --replace-needed libproj.so.${PROJ_SO_FIRST} libinternalproj.so.${PROJ_SO_FIRST} $i; done


# Build GDAL
ARG GDAL_VERSION=v3.10.2
ARG GDAL_RELEASE_DATE
ARG GDAL_BUILD_IS_RELEASE
ARG GDAL_REPOSITORY=OSGeo/gdal

COPY ./docker/bh-gdal.sh /buildscripts/
RUN chmod u+x /buildscripts/*.sh && \
    . /buildscripts/bh-set-envvars.sh && \
    /buildscripts/bh-gdal.sh

COPY ./docker/bh-postgis.sh /buildscripts/
RUN chmod u+x /buildscripts/*.sh && /buildscripts/bh-postgis.sh

# Build final image
FROM $TARGET_BASE_IMAGE AS gmt-importer

ENV GDAL_LIB_DIR=/usr/lib/x86_64-linux-gnu

USER root
RUN date

# Update distro
RUN apt-get update -y && apt-get upgrade -y


RUN apt-get update \
# PROJ dependencies
    && DEBIAN_FRONTEND=noninteractive apt-get install -y  --no-install-recommends \
        libsqlite3-0 libtiff6 libcurl4 \
        curl unzip ca-certificates

# Upgrade to python 3.12
#RUN apt-get install -y software-properties-common \
#  && add-apt-repository -y ppa:deadsnakes/ppa \
#    && apt-get update -y \
#    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3.11-distutils python3.11 python-is-python3


# GDAL dependencies and some specific to ABLE
# pil for antialias option of gdal2tiles
# cifs-utils is to mount cifs shares (The NAS)
# rsync is used to sync the NAS with the local disk
RUN apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y  --no-install-recommends \
       python3-numpy libpython3.12 \
       libjpeg-turbo8 libgeos3.12.1 libgeos-c1v5 \
       libexpat1 \
       libxerces-c3.2 \
       libwebp7 libpng16-16 \
       libzstd1 bash libpq5 libssl3 libopenjp2-7 libspatialite8 \
       # pil for antialias option of gdal2tiles
       python3-pil  \
       cifs-utils rsync \
       python3-pip \
       python3.12-venv \
       dos2unix \
        build-essential libpq-dev \
        inotify-tools \
        libclang-dev \
        libgeos-dev \
        gettext iputils-ping dnsutils netcat-openbsd \
        wget
    # && rm -rf /var/lib/apt/lists/*

# Install PostGIS (to have client tools)
COPY ./docker/install_postgis.sh /
RUN dos2unix install_postgis.sh && chmod +x install_postgis.sh && ./install_postgis.sh

# Install DOC tools
RUN wget --quiet https://github.com/jgm/pandoc/releases/download/2.9/pandoc-2.9-linux-amd64.tar.gz && \
    tar xvzf pandoc-2.9-linux-amd64.tar.gz --strip-components 1 -C /usr/local

# Order layers starting with less frequently varying ones
# Only used for custom libopenjp2
# COPY --from=builder  /build_thirdparty/usr/ /usr/

COPY --from=builder  /build_projgrids/usr/ /usr/

ARG PROJ_INSTALL_PREFIX
COPY --from=builder  /build${PROJ_INSTALL_PREFIX}/share/proj/ ${PROJ_INSTALL_PREFIX}/share/proj/
COPY --from=builder  /build${PROJ_INSTALL_PREFIX}/include/ ${PROJ_INSTALL_PREFIX}/include/
COPY --from=builder  /build${PROJ_INSTALL_PREFIX}/bin/ ${PROJ_INSTALL_PREFIX}/bin/
COPY --from=builder  /build${PROJ_INSTALL_PREFIX}/lib/ ${PROJ_INSTALL_PREFIX}/lib/

# Added, copy FileGDB driver
COPY --from=builder  /build_thirdparty/usr/ /usr/

COPY --from=builder  /build/usr/share/gdal/ /usr/share/gdal/
COPY --from=builder  /build/usr/include/ /usr/include/
COPY --from=builder  /build_gdal_python/usr/ /usr/
COPY --from=builder  /build_gdal_version_changing/usr/ /usr/

COPY --from=builder  /postgis/raster/loader/raster2pgsql /usr/bin

RUN ldconfig




WORKDIR /usr/src/app


    # This is a library used by a library to do alphashapes (openblas-src)
    # https://github.com/mblackgeo/fast-alphashape
    #libopenblas-dev \
    # these dependencies are to be able to try out CGAL
    #gfortran libcgal-dev libgmp3-dev

# libopenblas-dev gfortran  are probably not needed

# Get Rust
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
#Rust needs a username
ENV USER="root"

# Used to be able to run cargo watch -x test during development
RUN cargo install cargo-watch bindgen-cli

# Dev lib, restart celery on code change
#RUN curl --silent --show-error --retry 5 https://bootstrap.pypa.io/get-pip.py | python
#RUN pip install watchdog

# Build Python image with required modules

COPY ./docker/requirements.txt /usr/src/app
RUN python3.12 -m venv /usr/gmt-venv
RUN /usr/gmt-venv/bin/pip3 install -r /usr/src/app/requirements.txt

# We want osgeo in the venv environment, not the system packages
RUN mv /usr/lib/python3/dist-packages/osgeo /usr/gmt-venv/lib/python3.12/site-packages && \
    mv /usr/lib/python3/dist-packages/osgeo_utils /usr/gmt-venv/lib/python3.12/site-packages && \
    cp -r /usr/lib/python3/dist-packages/pkg_resources /usr/gmt-venv/lib/python3.12/site-packages

COPY ./scripts /scripts
COPY ./src /src
COPY ./rust /rust
COPY ./config_files /config_files

# use a different directory than scripts as scripts may be mapped in local dev
COPY ./docker/custom_entrypoint.sh /usr/local/bin
COPY ./docker/wait-for.sh /usr/local/bin
RUN dos2unix /scripts/*.sh && chmod +x /scripts/*.sh && dos2unix /usr/local/bin/*.sh && chmod +x /usr/local/bin/*.sh

ENV PYTHONPATH=/src \
    ENV_FILE=local_docker.env \
    FLASK_APP=api.flask_root \
    PATH="/root/.cargo/bin:${PATH}" \
    USER="root"

RUN cd /rust && cargo build --release


ENTRYPOINT ["custom_entrypoint.sh"]

CMD ["flask", "run", "--host", "0.0.0.0"]