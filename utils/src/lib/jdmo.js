//const async = require("async");
const axios = require("axios");

const jdmoFQDN = "localhost:80";
const userAgent = "UbiServices_SDK_2019.Release.11_SWITCH64";
const s2sKey = "68635702-83c8-41f1-ab78-69e1e2cf2de4";
const skuId = "jd2022-nx-all";

const init = () => {
    fetchItemDb();
    setInterval(fetchItemDb, 5 * 60 * 1000); // get every 5 minutes
};

const fetchItemDb = async () => {
    try {
        const url = `http://${jdmoFQDN}/customizable-itemdb/v1/items`;

        await axios.get(url, {
            headers: {
                "host": "localhost",
                "user-agent": userAgent,
                "accept": "*/*",
                "accept-encoding": "gzip",
                "accept-language": "en-us,en",
                "x-api-key": s2sKey,
                "x-skuid": skuId
            }
        }).then((response) => {
            global.itemDb = response.data;
        });
    } catch (error) {
        console.error("Error fetching item database:", error);
    }
};

module.exports = {
    init
};