const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const http2 = require('http');
const http3 = require('http');
const fetch = require('node-fetch');
const app = express();
const wdfHandlerApp = express(); 
const rateLimitMiddleware = require("./ratelimit/rate-limiter");
const logger = require("./logger/logger");
const validator = require("./logger/sessionvalidator");
require('./routes/db'); 
app.use(express.json()); 
wdfHandlerApp.use(express.json());
// Para parsear JSON en peticiones POST
const sslOptions = {
  key: fs.readFileSync('./certs/key.pem'),
  cert: fs.readFileSync('./certs/cert.pem'),
  ca: fs.readFileSync('./certs/ca_bundle.pem'),
   ciphers: "DEFAULT:@SECLEVEL=0"
};

app.set('trust proxy', 1)


const jsonErrorHandler = (err, req, res, next) => {
  res.status(err.status).send({
    status: err.status,
    message: err.message,
  });
};
app.use(jsonErrorHandler);



const { router, router2 } = require('./wdf/wdf');
app.use('/', router);
wdfHandlerApp.use('/', router2);

const httpPort = 7010;
const httpServer = https.createServer(sslOptions, app);

httpServer.listen(httpPort, () => {
  logger.info(`WDF server running at http://37.114.63.219:${httpPort}/`);
});

const httpPort1 = 312;
const httpServer1 = http2.createServer(wdfHandlerApp);

const httpPort2 = 777;
const httpServer2 = http3.createServer(app);

httpServer1.listen(httpPort1, () => {
  logger.info(`WDF Handler running at http://37.114.63.219:${httpPort1}/`);
});

httpServer2.listen(httpPort2, () => {
  logger.info(`WDF HTTP running at http://37.114.63.219:${httpPort2}/`);
});