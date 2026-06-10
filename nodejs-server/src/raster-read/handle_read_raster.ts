const axios = require('axios').default;

export let IMPORTER_HOST = process.env.DOCKER_IMPORTER_HOSTNAME;
export let IMPORTER_PORT = '5000';
//If nodeJS is being run outside of docker, it no longer has access to the docker network names, so
//we must access it through localhost and the published ports
if(process.env.RUN_NODEJS_OUTSIDE_OF_DOCKER == "true") {
    IMPORTER_PORT = process.env.IMPORTER_PUBLISHED_PORT
    IMPORTER_HOST = process.env.EXTERNAL_IMPORTER_HOSTNAME
}


export async function handle_read_pop_raster(ctx, next) {
    console.log("Got handle_read_pop_raster");
    console.log(ctx.request.query);

    const response = await axios.get(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/read_pop_raster`, {
        params: ctx.request.query,
        responseType: 'arraybuffer'
    });

    console.log("Response");
    console.log(response.status);
    console.log(response.statusText);
    console.log(response.data.length);

    ctx.body = response.data;
    ctx.type = "application/x-geotiff";

    await next();
}


export async function handle_read_friction_raster(ctx, next) {
    console.log("Got handle_read_pop_raster");
    console.log(ctx.request.query);

    const response = await axios.get(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/read_friction_raster`, {
        params: ctx.request.query,
        responseType: 'arraybuffer'
    });

    console.log("Response");
    console.log(response.status);
    console.log(response.statusText);
    console.log(response.data.length);

    ctx.body = response.data;
    ctx.type = "application/x-geotiff";

    await next();
}
