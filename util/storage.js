const fs = require("fs");
const path = require("path");
const { getUploadDir } = require("./file-paths");

const saveFile = ({ buffer, originalname }) => {
  const uploadDir = getUploadDir();
  const safeName = sanitizeFilename(originalname);
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  const fullPath = path.join(uploadDir, fileName);
  fs.writeFileSync(fullPath, buffer);
  return {
    fileName,
    url: `/uploads/${fileName}`,
  };
};

module.exports = {
  saveFile,
};

function sanitizeFilename(name) {
  if (!name || typeof name !== "string") {
    return "upload.bin";
  }
  const normalized = path
    .basename(name)
    .replace(/[^\w.-]/g, "-")
    .replace(/-+/g, "-");
  return normalized || "upload.bin";
}
