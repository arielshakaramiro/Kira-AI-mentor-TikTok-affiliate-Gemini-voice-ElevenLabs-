// lib/logger.js
// Logging terstruktur (JSON) + metrik penggunaan token Gemini.
// Tujuannya: gampang dibaca mesin (log aggregator) dan dipakai untuk
// memantau biaya — tiap panggilan Gemini mencatat jumlah token.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

// Tulis satu baris JSON ke stdout/stderr. Field standar: ts, level, msg, + meta.
function emit(level, msg, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta && typeof meta === 'object' ? meta : {}),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

// Akumulasi metrik token sederhana di memori (reset saat restart). Cukup untuk
// pantauan kasar biaya; untuk produksi sungguhan sebaiknya dikirim ke DB/metrics.
const usage = { requests: 0, promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

// Ambil usageMetadata dari respons Gemini (bentuknya bisa beda antar versi SDK).
export function extractUsage(response) {
  const u =
    response?.usageMetadata ||
    response?.response?.usageMetadata ||
    null;
  if (!u) return null;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    candidatesTokens: u.candidatesTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

// Catat penggunaan token satu request ke akumulator + log.
export function recordUsage({ endpoint, model, usage: u, userId } = {}) {
  usage.requests += 1;
  if (u) {
    usage.promptTokens += u.promptTokens || 0;
    usage.candidatesTokens += u.candidatesTokens || 0;
    usage.totalTokens += u.totalTokens || 0;
  }
  logger.info('gemini_usage', {
    endpoint,
    model,
    userId: userId || null,
    promptTokens: u?.promptTokens ?? null,
    candidatesTokens: u?.candidatesTokens ?? null,
    totalTokens: u?.totalTokens ?? null,
    cumulativeTotalTokens: usage.totalTokens,
  });
}

// Snapshot metrik kumulatif (dipakai endpoint /api/metrics).
export function getUsageSnapshot() {
  return { ...usage };
}

// Middleware Express: log tiap request HTTP beserta durasi & status.
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('http_request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?.id || null,
    });
  });
  next();
}
