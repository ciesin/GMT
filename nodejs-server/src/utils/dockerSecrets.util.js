const fs = require('fs');

const dockerSecret = {};
// TODO logging is not implemented

dockerSecret.read = function read(secretName) {
  try {
    return fs.readFileSync(`/run/secrets/${secretName}`).toString();
  } catch(err) {
    console.log(`Secret not found: ${secretName}. Err: ${err}`);
    return false;
  }
};

module.exports = dockerSecret;