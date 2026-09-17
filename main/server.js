const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const http2 = require('http');
const http1 = require('http');
const fetch = require('node-fetch');
const app = express();
require('./routes/db'); 
const managementApp = express(); 
require("dotenv").config();
const wdfHandlerApp = express(); 
const rateLimitMiddleware = require("./ratelimit/rate-limiter");
const logger = require("./logger/logger");
const validator = require("./logger/sessionvalidator");
app.use(express.json()); 
managementApp.use(express.json()); 
wdfHandlerApp.use(express.json()); 
const cors = require('cors')
const process = require('node:process');

app.set('trust proxy', 1)
const sslOptions = {
  key: fs.readFileSync('./certs/key.pem'),
  cert: fs.readFileSync('./certs/cert.pem'),
  ca: fs.readFileSync('./certs/ca_bundle.pem') ,
   ciphers: "DEFAULT:@SECLEVEL=0"
};

const jsonErrorHandler = (err, req, res, next) => {
  res.status(err.status).send({
    status: err.status,
    message: err.message,
  });
};
app.use(jsonErrorHandler);
managementApp.use(jsonErrorHandler);
managementApp.use(cors())
const SessionsService = require('./routes/sessions');
app.use('/', SessionsService);

app.use((req, res, next) => {
  const host = req.headers.host;
  if (host === 'public-ubiservices.ubi.com') {
    const originalPath = req.originalUrl; 
    const redirectUrl = `http://jd-api-backup.azure-api.net/ubi${originalPath}`;
    return res.redirect(307, redirectUrl);
  }
  next(); 
});

managementApp.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.includes(process.env.MANAGEMENT_KEY_FLOP || !authHeader.includes(process.env.MANAGEMENT_KEY_MITCHY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

//songdb routes
const songdbSkuData = require('./routes/songdb');
app.use('/', songdbSkuData);
const jdnextProxy = require('./routes/next-services');
app.use('/', jdnextProxy);
//carousel v1-v2 routes
//subscription-routes
app.post('/subscription/v1/refresh',rateLimitMiddleware, (req, res) => {
  res.sendFile(__dirname + '/data/subscription/refresh.json');
});
//itemdb-routes
const customizableItemRoutes = require('./routes/itemdb');
app.use('/', customizableItemRoutes);
//sku-constant routes
app.get('/constant-provider/v1/sku-constants', rateLimitMiddleware,(req, res) => {
  res.sendFile(__dirname + '/data/constants/sku-constants.json');
});
//quests-route
app.get('/questdb/v1/quests', validator,rateLimitMiddleware,(req, res) => {
  res.sendFile(__dirname + '/data/questdb/quests.json');
});
//profile system routes
const profileRoute = require('./routes/profiles');
app.use('/', profileRoute);

// Leaderboard
const leaderboardData = require('./routes/leaderboard');
app.use('/', leaderboardData);
//homedb-routes
const homeData = require('./routes/homedb');
app.use('/', homeData);
//relevance kill
const carouselPackages = require('./routes/carousel-packages');
app.use('/', carouselPackages);
const carouselRoutes = require('./routes/carousel');
app.use('/', carouselRoutes);

app.get('/recommendation/v1/relevance-sorting', validator,(req, res) => {
    res.status(500).send('Womp womp pertinence');
});
//wdf-room-setting
const WdfAssignService = require('./routes/wdf-routes');
app.use('/', WdfAssignService);

const RedirectionRoutes = require('./routes/redirect-proxy');
app.use('/', RedirectionRoutes);

// 11. Content Authorization
const contentAuthorizationRoutes = require('./routes/content-authorization');
app.use('/', contentAuthorizationRoutes);

// Statuses and metrics
const metricRoutes = require('./routes/metrics');
app.use('/', metricRoutes);
const statusRoutes = require('./routes/status');
app.use('/', statusRoutes);

const instanceId = Math.floor(Math.random() * 100000);

app.get('/status/v1/instanceId', (req, res) => {
    res.json({
        status: 200,
        InstanceId: instanceId,
		workerId: process.pid
    });
});

app.use((req, res) => {
   res.status(404).json({ error: 404,message: 'Resource not found' });
});


// Rutas y operaciones para HTTP (solo managementSongs)
const managementSongs = require('./management/songdb-package');
managementApp.use('/', managementSongs);

const genPackages = require('./management/update-packages');
managementApp.use('/', genPackages);

const genAuths = require('./management/update-auth');
managementApp.use('/', genAuths);

const delDotws = require('./management/delete-dotws');
managementApp.use('/', delDotws);

const userManagement = require('./management/user-management');
managementApp.use('/', userManagement);

const processMaps = require('./management/update-db');
managementApp.post('/songdb/v1/update-db', processMaps);

const deleteMap = require('./management/delete-map');
managementApp.post('/songdb/v1/delete-map', deleteMap);

const uploadSongdbtoCDN = require('./management/upload-db');
managementApp.post('/songdb/v1/upload-songdb', uploadSongdbtoCDN);

const uploadSongDBRouter = require('./management/upload-db'); 
managementApp.use('/', uploadSongDBRouter);

const carouselManagement = require('./management/carousel-management');
managementApp.use('/', carouselManagement);

const { getSongList } = require("./management/songList");
managementApp.get("/songdb/song-list", (req, res) => {
  try {
    const songList = getSongList();
    res.json(songList);
  } catch (error) {
    console.error("Error reading songs:", error);
    res.status(500).json({ error: "Check Internal Error,songs were not loaded" });
  }
});
const { updateMap } = require("./management/PatchSong");
managementApp.patch("/song/:codename/update", (req, res) => {
  const { codename } = req.params;
  const updates = req.body;

  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Bad Request" });
  }

  const result = updateMap(codename, updates);

  if (result.success) {
    res.json({ message: result.message });
  } else {
    res.status(404).json({ error: result.message });
  }
});
// Start HTTPS Server
const httpsPort = 443;
const httpsServer = https.createServer(sslOptions, app);
httpsServer.listen(httpsPort, () => {
  console.log(`JDM API Server running at https://2.56.246.74:${httpsPort}/`);
});

// Start HTTP Server
const httpPort = 4300;
const httpServer = http.createServer(managementApp);
httpServer.listen(httpPort, () => {
   logger.info(`JDM Management Server running at http://2.56.246.74:${httpPort}/`);
});


const httpPort1 = 80;
const httpServer1 = http1.createServer(app);
httpServer1.listen(httpPort1, () => {
   logger.info(`JDM Management Server running at http://2.56.246.74:${httpPort1}/`);
});
