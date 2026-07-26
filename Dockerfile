# Must track engines.node in package.json — as must .github/workflows/ci.yml.
# npm does not enforce engines without engine-strict, so a drift here does not fail
# the build: it just quietly verifies a runtime nothing else runs.
FROM node:24-alpine

COPY . /opt/kanjialive

WORKDIR /opt/kanjialive

# ci, not install: installs exactly what package-lock.json pins, so an image built
# today and one built in five years contain the same tree. It still runs postinstall,
# so the TypeScript build happens as before.
RUN npm ci

CMD ["npm", "start"]
