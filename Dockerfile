FROM node:18-alpine

COPY . /opt/kanjialive

WORKDIR /opt/kanjialive

RUN npm install

CMD ["npm", "start"]
