module.exports = async (_req, res) => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  res.json({
    enabled: Boolean(url && key),
    url: url || null,
    key: key || null,
  });
};
