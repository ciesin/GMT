let EMAIL_CONFIG = {
    transportOptions: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false
    },
    from: process.env.SMTP_FROM,
    //Administrator email in case of db failures
    admin: process.env.SMTP_ADMIN,
};
if(process.env.SMTP_USER){
    EMAIL_CONFIG.transportOptions["auth"] = {
        user: process.env.SMTP_USER,
        pass: process.env.GMT_SMTP_PASSWORD,
    };
}
export default EMAIL_CONFIG;