FROM node:22

RUN apt-get update && apt-get install jq gawk -y

WORKDIR /app/nodejs
COPY ./nodejs/package.json ./nodejs/package-lock.json ./
RUN npm ci

COPY . /app

ENTRYPOINT ["npm", "run", "start", "--"]
