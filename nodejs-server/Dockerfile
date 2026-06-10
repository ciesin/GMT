# Best practices based on:  https://snyk.io/wp-content/uploads/10-best-practices-to-containerize-Node.js-web-applications-with-Docker.pdf
FROM node:22 AS base

WORKDIR /usr/src/app

RUN apt-get update && apt-get install gettext-base
RUN npm i -g typescript

COPY package*.json ./
RUN npm ci --only=production
RUN npm i --save-dev @types/node
COPY . .
EXPOSE 8000


FROM base AS dev
ENV NODE_ENV development
RUN npm ci --also=dev
CMD ["npm", "start"]

FROM base AS prod
RUN apt-get install dumb-init
ENV NODE_OPTIONS="--max-old-space-size=750"
ENV NODE_ENV production
CMD ["dumb-init", "npm", "run", "start:prod"]
