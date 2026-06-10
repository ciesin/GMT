// Register aliases with module "module-alias": "^2.2.2", - not used for now until we know if we can share functionality with pwa and tests
// const moduleAlias = require('module-alias');
// moduleAlias.addAliases({
//   '@src': __dirname,
//   '@utils': __dirname + '/utils',
// });

import app from './app';
const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`Koa started on port ${port}`);
});

server.timeout =         120000;
server.requestTimeout =  300000;
server.headersTimeout =  120000;
server.keepAliveTimeout = 30000;
