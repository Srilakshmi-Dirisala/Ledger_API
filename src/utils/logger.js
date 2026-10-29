// Tiny logger. Silent under Jest so test output stays readable.
const silent = process.env.NODE_ENV === 'test';

function write(level, args) {
  if (silent) return;
  console[level](`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
