const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');
const puppeteer = require('puppeteer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname)));

// Install / setup screen — Bitrix calls this on app install
app.all('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// The Booking Form tab rendered inside the Deal
app.all('/bookingform.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'bookingform.html'));
});

// Same-origin proxy for the unit image (Bitrix CDN sends no CORS header).
app.get('/image-proxy', (req, res) => {
    const target = req.query.url || '';
    let host;
    try { host = new URL(target).hostname.toLowerCase(); }
    catch (e) { return res.status(400).send('Bad url'); }

    const allowedHosts = ['cdn.bitrix24.com', 'cdn.bitrix24.de', 'cdn.bitrix24.eu'];
    if (!allowedHosts.includes(host)) return res.status(403).send('Host not allowed');

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

// ── Read a static asset from disk as a data-URI (for the running header) ──
function fileDataUrl(file, mime) {
    try {
        const buf = fs.readFileSync(path.join(__dirname, file));
        return 'data:' + mime + ';base64,' + buf.toString('base64');
    } catch (e) { return ''; }
}

// ── Server-side PDF rendering with headless Chrome ──
// Receives the fully-rendered booking-form HTML (CSS + body, unit image inlined),
// renders it with real Chrome pagination, and adds the bf_header.png running header
// plus the page-number / signature footer on every page.
app.post('/render-pdf', async (req, res) => {
    let { html } = req.body || {};
    if (!html) return res.status(400).json({ error: 'missing html' });

    // The letterhead is a running header now, so drop the in-body copy to avoid
    // showing it twice on page 1.
    html = html.replace(/<div class="bf-header">[\s\S]*?<\/div>/, '');

    const header = fileDataUrl('bf_header.png', 'image/png');

    let browser;
    try {
        const launchOpts = {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        };
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        browser = await puppeteer.launch(launchOpts);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

        // Running header: bf_header.png full width. max-height guards against overlap
        // regardless of the image's aspect ratio; adjust the 24mm + top margin together.
        const headerTemplate =
            '<div style="width:100%; box-sizing:border-box; margin:0; padding:0 8mm; -webkit-print-color-adjust:exact;">' +
              (header ? '<img src="' + header + '" style="display:block; width:100%; max-height:24mm; object-fit:contain;">' : '') +
            '</div>';

        // Footer: left = Page N | South Lofts ; right = Signed by Purchaser + line.
        const footerTemplate =
            '<div style="width:100%; box-sizing:border-box; padding:0 8mm; font-family:Arial,sans-serif; font-size:9px; color:#333; display:flex; justify-content:space-between; align-items:flex-end;">' +
              '<span>Page <span class="pageNumber"></span> | South Lofts</span>' +
              '<span>Signed by Purchaser&nbsp;________________________</span>' +
            '</div>';

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: headerTemplate,
            footerTemplate: footerTemplate,
            margin: { top: '30mm', bottom: '16mm', left: '8mm', right: '8mm' }
        });
        await browser.close();
        browser = null;

        res.json({ base64: Buffer.from(pdf).toString('base64') });
    } catch (e) {
        if (browser) { try { await browser.close(); } catch (_) {} }
        console.error('[BookingForm] render-pdf error:', e);
        res.status(500).send(String(e && e.message ? e.message : e));
    }
});

app.listen(PORT, () => {
    console.log(`Dubai Booking Form server running on port ${PORT}`);
});
