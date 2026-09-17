const express = require('express');
const fs = require('fs');
const path = require('path');
const logger = require("../logger/logger");
const router = express.Router();

// Helper function to get the file path
const getFilePath = (console, fileName) => path.resolve(__dirname, `../data/packages/${console.toUpperCase()}/${fileName}.json`);

// Helper function to read JSON files
const readJSONFile = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Helper function to write JSON files
const writeJSONFile = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

// Function to update SKU packages
const updateSkuPackages = (mapName, isDev) => {
	const mapFilesPath = path.join(__dirname, '../database/Maps');
	const consoles = ['nx', 'pc', 'ps4'];

	const skuPackages = {
		nx: {},
		pc: {},
		ps4: {}
	};

	const updatedChanges = {
		nx: [],
		pc: [],
		ps4: []
	};

	const mapFilePath = path.join(mapFilesPath, `${mapName}.json`);
	if (!fs.existsSync(mapFilePath)) {
		throw new Error(`File for mapName ${mapName} not found.`);
	}

	const mapData = readJSONFile(mapFilePath);

	consoles.forEach(console => {
		if (mapData.packages[console]) {
			const packageData = mapData.packages[console];
			const skuPackageName = `${mapName}_mapContent`;

			const newPackage = {
				md5: packageData.md5,
				storageType: packageData.storageType,
				url: `https://jdmo-cdn.c0llydoll.com${packageData.url}`,
				version: 1
			};

			const consolePackagePath = getFilePath(console, 'sku-packages');
			const consoleDevPackagePath = getFilePath(console, 'sku-packages-dev');
			let existingPackages = {};

			if (isDev) {
				if (fs.existsSync(consoleDevPackagePath)) {
					existingPackages = readJSONFile(consoleDevPackagePath);

					if (existingPackages[skuPackageName]) {
						// Update existing package
						if (JSON.stringify(existingPackages[skuPackageName]) !== JSON.stringify(newPackage)) {
							updatedChanges[console].push({
								name: skuPackageName,
								env: 'dev',
								status: 'Updated',
								before: existingPackages[skuPackageName],
								now: newPackage
							});
							logger.info(`Song Mainscene Manager: Updated ${mapName} Mainscene in Dev Environment`);
						}
					} else {
						// Add new package
						updatedChanges[console].push({
							name: skuPackageName,
							env: 'dev',
							status: 'Added',
							before: 'Not present',
							now: newPackage
						});
						logger.info(`Song Mainscene Manager: Added ${mapName} Mainscene in Dev Environment`);
					}

					existingPackages[skuPackageName] = newPackage;
				} else {
					// Add new package when file does not exist
					updatedChanges[console].push({
						name: skuPackageName,
						env: 'dev',
						status: 'Added',
						before: 'Not present',
						now: newPackage
					});
					logger.info(`Song Mainscene Manager: Created Dev File and Added ${mapName} Mainscene in Dev Environment `);

					existingPackages[skuPackageName] = newPackage;
				}

				writeJSONFile(consoleDevPackagePath, existingPackages);
				
			} else {
				if (fs.existsSync(consolePackagePath)) {
					existingPackages = readJSONFile(consolePackagePath);
					existingPackagesDev = readJSONFile(consoleDevPackagePath);

					if (existingPackages[skuPackageName]) {
						// Update existing package
						if (JSON.stringify(existingPackages[skuPackageName]) !== JSON.stringify(newPackage)) {
							updatedChanges[console].push({
								name: skuPackageName,
								env: 'prod-patreon',
								status: 'Updated',
								before: existingPackages[skuPackageName],
								now: newPackage
							});
							logger.info(`Song Mainscene Manager: Updated ${mapName} Mainscene in Prod Environment`);
						}
					} else {
						// Add new package
						updatedChanges[console].push({
							name: skuPackageName,
							env: 'prod-patreon',
							status: 'Added',
							before: 'Not present',
							now: newPackage
						});
						logger.info(`Song Mainscene Manager: Added ${mapName} Mainscene in Prod Environment`);
					}

					existingPackages[skuPackageName] = newPackage;
					existingPackagesDev[skuPackageName] = newPackage;
				} else {
					// Add new package when file does not exist
					updatedChanges[console].push({
						name: skuPackageName,
						env: 'prod-patreon',
						status: 'Added',
						before: 'Not present',
						now: newPackage
					});
					logger.info(`Song Mainscene Manager: Created Prod File and Added ${mapName} Mainscene in Prod Environment`);
					existingPackages[skuPackageName] = newPackage;
					existingPackagesDev[skuPackageName] = newPackage;
				}

				writeJSONFile(consolePackagePath, existingPackages);
				writeJSONFile(consoleDevPackagePath, existingPackagesDev);
			}
		}
	});

	return updatedChanges;
};

// Route to handle SKU package updates
router.post('/songdb/v1/update-package', (req, res) => {
	const {
		mapName,
		isDev
	} = req.body;

	if (!mapName) {
		return res.status(400).json({
			error: 'mapName is required in the request body'
		});
	}

	try {
		const changes = updateSkuPackages(mapName, isDev);
		res.json({
			mapName,
			message: 'SKU packages updated successfully',
			changes
		});
	} catch (error) {
		res.status(500).json({
			error: `Internal Server Error: ${error.message}`
		});
	}
});

module.exports = router;
