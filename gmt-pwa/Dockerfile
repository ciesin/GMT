FROM node:22-alpine AS dev
WORKDIR /usr/src/app
# This is to run envsubst
RUN apk add gettext libintl
RUN npm install -g npm && npm install -g @angular/cli@19.2.13

COPY package*.json ./
RUN npm install
COPY . .

RUN ng build --configuration production

COPY ./docker/*.sh /
RUN chmod +x /*.sh
EXPOSE 4200
ENTRYPOINT ["/custom-entrypoint.sh"]
FROM dev AS ci
WORKDIR /usr/src/app
RUN apk update && apk add --no-cache chromium gettext libintl
ENV CHROME_BIN="/usr/bin/chromium-browser"
ENV CHROME_PATH=/usr/lib/chromium/
COPY karma.conf.ci.js karma.conf.js

FROM nginx:stable-alpine AS prod
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/
RUN rm -rf /usr/share/nginx/html/*
COPY --from=dev /usr/src/app/dist/browser /usr/share/nginx/html
COPY ./docker/* /
RUN chmod +x /*.sh
EXPOSE 80
ENTRYPOINT ["/custom-entrypoint.sh"]
CMD ["nginx"]
