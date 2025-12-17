const fs = require("fs");
const path = require("path");

const resolveDirectory = (input, fallback) => {
  const target = input && input.trim().length ? input.trim() : fallback;
  if (!target) {
    throw new Error("A fallback directory must be provided.");
  }
  return path.isAbsolute(target) ? target : path.resolve(target);
};

const DATA_DIR = resolveDirectory(
  process.env.CASHLY_DATA_DIR || process.env.DATA_DIR || "",
  path.join(__dirname, "../data"),
);

const UPLOAD_DIR = resolveDirectory(
  process.env.CASHLY_UPLOAD_DIR || process.env.UPLOAD_DIR || "",
  path.join(__dirname, "../public/uploads"),
);

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const getDataDir = () => {
  ensureDirectory(DATA_DIR);
  return DATA_DIR;
};

const getUploadDir = () => {
  ensureDirectory(UPLOAD_DIR);
  return UPLOAD_DIR;
};

const resolveDataPath = (fileName) => path.join(getDataDir(), fileName);

const resolveUploadPath = (fileName) => path.join(getUploadDir(), fileName);

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  ensureDirectory,
  getDataDir,
  getUploadDir,
  resolveDataPath,
  resolveUploadPath,
};
