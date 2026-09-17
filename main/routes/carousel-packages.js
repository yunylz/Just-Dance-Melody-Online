const express = require('express');
const path = require('path');
const router = express.Router();
const validator = require("../logger/sessionvalidator");
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const logger = require("../logger/logger");
const fs = require('fs');

router.post('/carousel/v2/packages',validator,rateLimitMiddleware, (req, res) => {
    const skuId = req.headers['x-skuid'];
    
    // Initialize packageIds array
    let packageIds = [];
    
    // Check if skuId exists and implement the logic
    if (skuId) {
        if (skuId.startsWith("jd2016") || skuId.startsWith("jdmelody")) {
            packageIds = ["KP"];
        } else if (skuId.startsWith("jd2017")) {
            packageIds = ["abba_2017"];
        }
    }
    
    // Return the response
    res.json({
        "__class": "PackageIds",
        "packageIds": packageIds
    });
});



module.exports = router;