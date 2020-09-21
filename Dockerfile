FROM node:14-alpine

COPY . /opt/kanjialive

WORKDIR /opt/kanjialive

RUN npm install

CMD ["npm", "start"]