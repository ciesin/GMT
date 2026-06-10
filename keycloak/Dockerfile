#FROM jboss/keycloak:16.1.1
FROM harbor.novel-t.ch/gmt/jboss-keycloak:16.1.1

USER root
RUN microdnf install -y dos2unix \
    && microdnf clean all \
    && rm -rf /var/cache/yum
USER jboss

COPY ./gmt-realm.json.template /tmp/gmt-realm.json.template
# note that startup scripts seems to be deprecated and has to be replaced in further versions
RUN mkdir -p /opt/jboss/startup-scripts

COPY ./startup-scripts/* /opt/jboss/startup-scripts/
COPY ./gmt-theme /opt/jboss/keycloak/themes/gmt-theme

USER root
RUN dos2unix /tmp/gmt-realm.json.template
RUN for f in /opt/jboss/startup-scripts/*.sh; do dos2unix $f; done

RUN chown jboss:jboss /tmp/gmt-realm.json.template && \
    chown -R jboss:jboss /opt/jboss/startup-scripts/ && \
    chmod +x /opt/jboss/startup-scripts/*.sh
