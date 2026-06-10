const REDIS_OPTIONS =
    {
        redis: {
            port: parseInt(process.env.REDIS_INTERNAL_PORT),
            host: process.env.REDIS_HOSTNAME,
            password: process.env.REDIS_PASSWORD
        }
    };
export default REDIS_OPTIONS;


