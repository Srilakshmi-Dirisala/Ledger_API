// Express 4 does not catch rejected promises from async handlers; this forwards them to next().
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
