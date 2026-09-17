const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const logger = require("../logger/logger");
const router = express.Router();

const s3 = new AWS.S3({
    endpoint: 'https://s3.us-east-005.backblazeb2.com', // Endpoint 
    accessKeyId: '0050fa08d1e77110000000004',
    secretAccessKey: 'K0057nk2rjWEwfyTNgsY7CWie8vZ/GM',
    region: 'us-east-005',
    s3ForcePathStyle: true 
});

function calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

async function uploadFilesToContabo(callback) {
    const bucketName = 'jdmo-s3'; 
    const filesToUpload = [
        'jdmelody-nx-all.json',
        'jdmelody-ps4-all.json',
        'jdmelody-pc-all.json',
        'jdmelody-nx-patreon.json',
        'jdmelody-ps4-patreon.json',
        'jdmelody-pc-patreon.json',
		'jdmelody-nx-dev.json',
        'jdmelody-ps4-dev.json',
        'jdmelody-pc-dev.json'
    ];
    const folderPath = path.join(__dirname, '../data/songdb');

    let uploadCount = 0;
    let uploadErrors = [];

    for (const fileName of filesToUpload) {
        try {
            const filePath = path.join(folderPath, fileName);
            const md5Hash = await calculateMD5(filePath);
            const newFileName = `${fileName.split('.')[0]}.${md5Hash}.json`;
            const fileStream = fs.createReadStream(filePath);
            const fileKey = `private/songdb/${newFileName}`;

            console.log(`Uploading file: ${fileName} as ${newFileName}`);

            await s3.putObject({
                Body: fileStream,
                Bucket: bucketName,
                Key: fileKey,
                ContentType: 'application/json',
            }).promise();

            console.log(`File uploaded: ${newFileName}`);

            // Update the local JSON file with the new URL
            let localJsonPath, localJson;

            if (fileName.includes('-patreon')) {
                localJsonPath = path.join(`./data/songdb/${fileName.split('-')[1].toUpperCase()}/SongDB_Patreon.json`);
            } else if (fileName.includes('-dev')){
				localJsonPath = path.join(`./data/songdb/${fileName.split('-')[1].toUpperCase()}/SongDB_Dev.json`);
			} else {
                localJsonPath = path.join(`./data/songdb/${fileName.split('-')[1].toUpperCase()}/SongDB.json`);
            }

            localJson = JSON.parse(fs.readFileSync(localJsonPath, 'utf-8'));
            localJson.songdbUrl = `https://jdmo-cdn.c0llydoll.com/private/songdb/${newFileName}`;
            fs.writeFileSync(localJsonPath, JSON.stringify(localJson, null, 2), 'utf-8');

            console.log(`Updated local JSON file: ${localJsonPath} with URL: ${localJson.songdbUrl}`);

        } catch (err) {
            uploadErrors.push({ file: fileName, error: err.message });
            console.error(`Error uploading file: ${fileName}`, err);
        } finally {
            uploadCount++;
            if (uploadCount === filesToUpload.length) {
                if (uploadErrors.length > 0) {
                    callback({ status: 'error', errors: uploadErrors });
                } else {
                    callback({ status: 'uploaded files successfully' });
                }
            }
        }
    }
}
router.post('/songdb/v1/upload-songdb', (req, res) => {
    try {
        uploadFilesToContabo((result) => {
            res.status(200).json(result);
        });
    } catch (error) {
        logger.error(error,'Error uploading files to Contabo Storage:');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
