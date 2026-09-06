// Historical OHLC via Yahoo Finance chart API — free, no key, continuous futures contracts
// GC=F Gold, SI=F Silver, PL=F Platinum, PA=F Palladium

const SYMBOLS = {
  gold:      'GC=F',
  silver:    'SI=F',
  platinum:  'PL=F',
  palladium: 'PA=F'
};

// range param -> upstream Yahoo range/interval
// '1d' and '1w' both pull the same 5d/15m window; '1d' is then trimmed
// server-side to the most recent trading session so it still works over
// weekends/holidays when Yahoo has no same-day bars.
const RANGE_MAP = {
  '1d':  { range: '5d',  interval: '15m', trimToLastSession: true },
  '1w':  { range: '5d',  interval: '15m' },
  '1mo': { range: '1mo', interval: '1d'  },
  '3mo': { range: '3mo', interval: '1d'  },
  '1y':  { range: '1y',  interval: '1wk' },
  '5y':  { range: '5y',  interval: '1wk' }
};

// Cache TTL per range — shorter for intraday, longer for slow-moving history
const CACHE_TTL_MS = {
  '1d': 5 * 60 * 1000,
  '1w': 5 * 60 * 1000,
  '1mo': 30 * 60 * 1000,
  '3mo': 30 * 60 * 1000,
  '1y': 60 * 60 * 1000,
  '5y': 60 * 60 * 1000
};

const cache = {};

function localDateKey(unixSeconds, gmtoffsetSeconds) {
  const shifted = new Date((unixSeconds + (gmtoffsetSeconds || 0)) * 1000);
  return shifted.toISOString().slice(0, 10);
}

function trimToLastSession(points, gmtoffsetSeconds) {
  if (!points.length) return points;
  const lastKey = localDateKey(points[points.length - 1].t, gmtoffsetSeconds);
  const sameDay = points.filter(p => localDateKey(p.t, gmtoffsetSeconds) === lastKey);
  return sameDay.length ? sameDay : points;
}

async function fetchSeries(symbol, cfg) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${cfg.range}&interval=${cfg.interval}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  let points = timestamps
    .map((t, i) => ({ t, c: closes[i] }))
    .filter(p => typeof p.c === 'number');

  if (cfg.trimToLastSession) {
    points = trimToLastSession(points, result.meta?.gmtoffset);
  }

  return points;
}

exports.handler = async (event) => {
  const range = event.queryStringParameters?.range || '1d';
  const cfg = RANGE_MAP[range];

  if (!cfg) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid range' }) };
  }

  const cached = cache[range];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS[range]) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(cached.payload)
    };
  }

  try {
    const entries = Object.entries(SYMBOLS);
    const results = await Promise.all(
      entries.map(([, symbol]) => fetchSeries(symbol, cfg).catch(() => []))
    );

    const series = {};
    entries.forEach(([name], i) => { series[name] = results[i]; });

    const payload = { range, series };
    cache[range] = { at: Date.now(), payload };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(payload)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
