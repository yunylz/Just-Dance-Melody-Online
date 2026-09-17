const express = require('express');
const router = express.Router();

router.get('/status/v1/info', (req, res) => {
  res.sendStatus(200);
});

router.get('/status/v1/ping', (req, res) => {
  res.status(200).send();
})


module.exports = router;