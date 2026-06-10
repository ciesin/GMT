FROM mdillon/postgis:11-alpine

RUN mkdir /init-scripts && mkdir /migrations && mkdir /populate && mkdir /tools

ENV PATH="${PATH}:/tools"

COPY ./scripts/sql/init /init-scripts
COPY ./scripts/sql/migrations /migrations
COPY ./scripts/tools /tools

RUN chmod +x /tools/*.sh
RUN chmod +x /init-scripts/*.sh

COPY ./bin/*.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/custom-entrypoint.sh /usr/local/bin/wait-for.sh

ENTRYPOINT ["custom-entrypoint.sh"]
