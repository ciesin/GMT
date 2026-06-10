FROM cypress/included:12.3.0

RUN apt update && apt upgrade -y
RUN apt install -y dos2unix

WORKDIR /e2e

COPY package.json /e2e/package.json
COPY package-lock.json /e2e/package-lock.json

RUN npm install

COPY cypress/ /e2e/cypress/
COPY cypress.config.ts ./
COPY tsconfig.json ./

COPY ./bin/*.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

ENTRYPOINT ["custom-entrypoint.sh"]

CMD ["cypress", "run" , "--browser", "chrome"]