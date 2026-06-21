const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;
const https = require('https');


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Install / setup screen — Bitrix calls this on app install
app.all('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// The Booking Form tab rendered inside the Deal
app.all('/bookingform.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'bookingform.html'));
});
app.get('/image-proxy', (req, res) => {
  const target = req.query.url || '';
 
  // Validate the host — only allow Bitrix CDN (prevents this being an open relay).
  let host;
  try { host = new URL(target).hostname.toLowerCase(); }
  catch (e) { return res.status(400).send('Bad url'); }
 
  const allowedHosts = ['cdn.bitrix24.com', 'cdn.bitrix24.de', 'cdn.bitrix24.eu'];
  if (!allowedHosts.includes(host)) return res.status(403).send('Host not allowed');
 
  // Bitrix image filenames often contain spaces — encode them for the upstream request.
  https.get(encodeURI(target), (upstream) => {
    if (upstream.statusCode && upstream.statusCode >= 400) {
      upstream.resume();
      return res.status(502).send('Upstream HTTP ' + upstream.statusCode);
    }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.pipe(res);
  }).on('error', () => res.status(502).send('Fetch failed'));
});
app.listen(PORT, () => {
    console.log(`Dubai Booking Form server running on port ${PORT}`);
});
