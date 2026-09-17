const fs = require("fs");
const path = require("path");

const BASE_PATH = path.join(__dirname,"..","database", "Maps");
console.log(BASE_PATH);

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}`, error);
    return null;
  }
}


function loadMaps(directoryPath) {
  const mapData = {};

  if (!fs.existsSync(directoryPath)) return mapData;

  const files = fs.readdirSync(directoryPath).filter(file => file.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const jsonData = readJsonFile(filePath);

    if (jsonData && jsonData.data) {
      const { mapName } = jsonData.data;
      mapData[mapName] = {
        ...jsonData.data,
        ...jsonData.urls,
      };
    }
  }

  return mapData;
}


function getSongList() {
  return {
    Patreon: loadMaps(path.join(BASE_PATH, "Patreon")),
    Dev: loadMaps(path.join(BASE_PATH, "Dev")),
    Public: loadMaps(BASE_PATH),
  };
}

module.exports = { getSongList };