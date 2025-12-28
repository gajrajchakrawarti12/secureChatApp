const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const accessLogStream = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });
const errorLogPath = path.join(logsDir, 'error.log');
const wsLogPath = path.join(logsDir, 'websocket.log');

function logError(err) {
  try {
    const entry = `[${new Date().toISOString()}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(errorLogPath, entry);
  } catch (e) {
    console.error('Failed to write to error log', e);
  }
  console.error(err);
}
function logWs(message) {
  try {
    const entry = `[${new Date().toISOString()}] ${String(message)}\n`;
    fs.appendFileSync(wsLogPath, entry);
  } catch (e) {
    console.error('Failed to write to websocket log', e);
  }
  try {
    console.log(message);
  } catch (_) {}
}

module.exports = { accessLogStream, logError, logWs };
