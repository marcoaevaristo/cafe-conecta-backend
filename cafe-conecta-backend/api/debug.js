const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  
  res.json({
    supabase_url: url ? url.substring(0, 30) + '...' : 'NAO DEFINIDA',
    service_key: key ? key.substring(0, 20) + '...' : 'NAO DEFINIDA',
    node_version: process.version,
  });
});

module.exports = router;
