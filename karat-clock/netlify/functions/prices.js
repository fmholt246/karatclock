// gold-api.com — free, no key, no rate limits
// Only returns live price — we calculate change from cached previous price

const METALS = [
  { name: 'gold',      symbol: 'XAU' },
  { name: 'silver',    symbol: 'XAG' },
  { name: 'platinum',  symbol: 'XPT' },
  { name: 'palladium', symbol: 'XPD' }
];

// In-memory cache to calculate price change between calls
// (persists as long as the Netlify function container stays warm)
const priceCache = {};

async function fetchMetal(symbol) {
  const res  = await fetch(`https://api.gold-api.com/price/${symbol}`);
  const data = await res.json();

  const price = data.price || 0;

  // Use cached previous price to compute change
  const prev  = priceCache[symbol] || price;
  const ch    = parseFloat((price - prev).toFixed(4));
  const chp   = prev ? parseFloat(((ch / prev) * 100).toFixed(4)) : 0;

  // Update cache
  priceCache[symbol] = price;

  return { price, ch, chp, '52weekHigh': 0, '52weekLow': 0 };
}

exports.handler = async () => {
  try {
    const results = await Promise.all(METALS.map(m => fetchMetal(m.symbol)));

    const payload = {};
    METALS.forEach((m, i) => { payload[m.name] = results[i]; });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(payload)
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
