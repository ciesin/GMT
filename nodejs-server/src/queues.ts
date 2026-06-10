import bodyParser from "koa-bodyparser";
const mount = require('koa-mount');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { KoaAdapter } = require('@bull-board/koa');
const serve = require('koa-static');
const Router = require('koa-router');
const session = require('koa-session');
const passport = require('koa-passport');
const LocalStrategy = require('passport-local').Strategy;
const Koa = require('koa');


import queuesAuth from "./utils/auth/queuesAuthInit.util";
import {isLoggedIn, loginAdminUser, logoutAdminUser} from "./middleware/user-admin/admin-login.middleware";
import {adminSessionConfig} from "./config/admin-auth.config";
import logger from "./middleware/logger";
import {
  catchmentUpdatesQueue, dataChecksQueue,
  dataExportQueue,
  indicatorUpdatesQueue, stateExportsQueue,
  syncingUpdatesQueue
} from "./queues/declarations";
import {initializeQueueWorkers} from "./queues/hook-queue-processes";


passport.use(
  new LocalStrategy(function (username, password, cb) {
    // TODO for some reason LocalStrategy required, but I guess that is passport misconfiguration
    return cb(null, false);
  })
);

// Configure Passport authenticated session persistence.
//
// In order to restore authentication state across HTTP requests, Passport needs
// to serialize users into and deserialize users out of the session.  The
// typical implementation of this is as simple as supplying the user ID when
// serializing, and querying the user record by ID from the database when
// deserializing.
passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

const run = async () => {
  const _app = new Koa();
  _app.proxy = process.env.ADMIN_SESSION_SECURE == "true";
  _app.use(logger(null));
  const publicRouter = new Router(); // you can access without session login
  const privateRouter = new Router();  // access only with session login

  const serverAdapter = new KoaAdapter();
  createBullBoard({
    queues: [
      new BullAdapter(syncingUpdatesQueue),
      new BullAdapter(indicatorUpdatesQueue),
      new BullAdapter(catchmentUpdatesQueue),
      new BullAdapter(dataExportQueue),
      new BullAdapter(stateExportsQueue),
      new BullAdapter(dataChecksQueue),
    ],
    serverAdapter: serverAdapter,
  });
  serverAdapter.setBasePath('/queues/queue');
  publicRouter
      .use(queuesAuth.protect())
      .get('/login', loginAdminUser)
      .get('/logout', logoutAdminUser);
  // _app.use(mount('/', serve(path.join(__dirname, '/views/queues-login'))))
  _app.use(session(adminSessionConfig, _app))
      .use(bodyParser())
      .use(passport.initialize())
      .use(passport.session());
  // to be able to use queuesAuth.protect()
  queuesAuth.middleware().map(item => {
     _app.use(item)
  });

  _app.use(mount('/', serve('/usr/src/app/src/views/queues-login')))
      .use(mount('/auth', serve('/usr/src/app/src/views/queues-login')))
      .use(mount('/auth', publicRouter.routes()))
      .use(mount('/auth', publicRouter.allowedMethods()))
      .use(isLoggedIn)
      .use(serverAdapter.registerPlugin({mount: '/queue'}))
      .use(privateRouter.routes())
 .use(mount('/queues', _app));

  //set up the queue workers
  initializeQueueWorkers();

  const port = process.env.QUEUES_INTERNAL_PORT || 5000;
  await _app.listen(port);

  console.log(`Running on ${port}...`);
  console.log(`For the UI of instance1, open http://localhost:${port}/`);
  console.log(`Make sure Redis is running on port ${process.env.REDIS_INTERNAL_PORT}`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});