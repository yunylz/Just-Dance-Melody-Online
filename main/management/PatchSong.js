const fs = require("fs");
const path = require("path");

const BASE_PATH = path.join(__dirname, "..","database", "Maps");

function updateMap(codename, updates) {
  const directories = ["", "Dev", "Patreon"].map(dir => path.join(BASE_PATH, dir));
  let filePath = null;

  for (const dir of directories) {
    const possiblePath = path.join(dir, `${codename}.json`);
    if (fs.existsSync(possiblePath)) {
      filePath = possiblePath;
      break;
    }
  }

  if (!filePath) {
    return { success: false, message: "file not found." };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const jsonData = JSON.parse(content);

    if (jsonData.data) {
      Object.assign(jsonData.data, updates);

      fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), "utf-8");

      return { success: true, message: "Updated" };
    } else {
      return { success: false, message: "Not data section" };
    }
  } catch (error) {
    console.error("Error updating file.:", error);
    return { success: false, message: "Error updating file." };
  }
}

module.exports = { updateMap };