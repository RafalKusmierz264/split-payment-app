function sendError(res, status, code, message) {
  return res.status(status).json({
    code,
    message,
  });
}

module.exports = { sendError };
