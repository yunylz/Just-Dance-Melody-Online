const express = require('express');
const router = express.Router();
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const redirectMiddleware = async (req, res) => {
	const modifiedUrl = req.originalUrl.replace('/next-proxy', '');
	newUrl = `https://prod-next.just-dance.com${modifiedUrl}`;
	res.redirect(307, newUrl);
};
const validator = require("../logger/sessionvalidator");
router.get('/next-proxy/songdb/v3/content-authorization/map/:guid/formatVersion/v0', (req, res) => {
    const guid = req.params.guid; 
    const redirectUrl = `https://jd-api.azure-api.net/jdnext-clone/songdb/v3/content-authorization/map/${guid}/formatVersion/v0`;
    res.redirect(307, redirectUrl);

});
router.get('/next-proxy/songdb/v3/party-content-authorization/party/:party/map/:guid/formatVersion/v0', (req, res) => { 
    const guid = req.params.guid;
	const party = req.params.party;
    const redirectUrl = `https://jd-api.azure-api.net/jdnext-clone/songdb/v3/party-content-authorization/party/${party}/map/${guid}/formatVersion/v0`;
    res.redirect(307, redirectUrl);
});
router.post('/next-proxy/*',  rateLimitMiddleware, redirectMiddleware);
router.get('/next-proxy/*', rateLimitMiddleware, redirectMiddleware);
router.delete('/next-proxy/*', rateLimitMiddleware, redirectMiddleware);
router.put('/next-proxy/*', rateLimitMiddleware, redirectMiddleware);
router.head('/next-proxy/*', rateLimitMiddleware, redirectMiddleware);
module.exports = router;