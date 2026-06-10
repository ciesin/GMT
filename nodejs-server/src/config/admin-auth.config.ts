export const adminSessionConfig = {
    key: 'gmt.sess',
    /** (number || 'session') maxAge in ms (default is 1 days) */
    /** 'session' will result in a cookie that expires when session/browser is closed */
    /** Warning: If a session cookie is stolen, this cookie will never expire */
    maxAge: parseInt(process.env.ADMIN_SESSION_MAX_AGE), // || 5 * 60 * 1000, // default 5 mins
    secret: process.env.ADMIN_SESSION_SECRET,
    autoCommit: true, /** (boolean) automatically commit headers (default true) */
    overwrite: false, /** (boolean) can overwrite or not (default true) */
    httpOnly: process.env.ADMIN_SESSION_HTTP_ONLY == "true" || false, /** (boolean) httpOnly or not (default true) */
    signed: process.env.ADMIN_SESSION_SIGNED == "true" || false, /** (boolean) signed or not (default true) */
    rolling: process.env.ADMIN_SESSION_ROLLING == "true" || false, /** (boolean) Force a session identifier cookie to be set on every response. The expiration is reset to the original maxAge, resetting the expiration countdown. (default is false) */
    renew: process.env.ADMIN_SESSION_RENEW == "true" || false, /** (boolean) renew session when session is nearly expired, so we can always keep user logged in. (default is false)*/
    secure: process.env.ADMIN_SESSION_SECURE == "true" || false, /** (boolean) secure cookie*/
    sameSite: null, /** (string) session cookie sameSite options (default null, don't set it) */
    //   resave: false,
    //   saveUninitialized: true,
    //   store: memoryStore,
    //   domain: '.app.localhost',
  };
  // if (_app.get('env') === 'production') {
  //   _app.set('trust proxy', 1); // trust first proxy
  //   CONFIG.secure = true; // serve secure cookies
  // }