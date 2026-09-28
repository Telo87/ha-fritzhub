# https://developers.home-assistant.io/docs/apps/configuration#app-dockerfile
ARG BUILD_FROM=ghcr.io/home-assistant/base-python:3.13-alpine3.24
FROM ${BUILD_FROM}

# Python-Abhängigkeiten – vorgebaute Wheels von Home Assistant bevorzugen,
# Compiler nur temporär als Fallback installieren.
COPY requirements.txt /tmp/requirements.txt
RUN apk add --no-cache --virtual .build-deps gcc musl-dev \
    && pip3 install --no-cache-dir \
        --extra-index-url "https://wheels.home-assistant.io/musllinux-index/" \
        -r /tmp/requirements.txt \
    && apk del .build-deps \
    && rm /tmp/requirements.txt

# Anwendung + s6-Service
COPY rootfs /
RUN chmod a+x /etc/services.d/fritzhub/run /etc/services.d/fritzhub/finish

WORKDIR /opt

LABEL \
    org.opencontainers.image.title="Home Assistant App: FritzHub" \
    org.opencontainers.image.description="FRITZ!Box & Mesh dashboard for Home Assistant" \
    org.opencontainers.image.source="https://github.com/Telo87/ha-fritzhub" \
    org.opencontainers.image.licenses="MIT"
