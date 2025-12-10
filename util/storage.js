const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(__dirname, "../public/uploads");

const ensureDir = () => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
};

const saveFile = ({ buffer, originalname }) => {
  ensureDir();
  const safeName = originalname.replace(/\s+/g, "-");
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  const fullPath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(fullPath, buffer);
  return {
    fileName,
    url: `/uploads/${fileName}`,
  };
};

module.exports = {
  saveFile,
};
