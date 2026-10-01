// Starts the app once the map and Supabase libraries have loaded, and registers the
// small background helper that lets phones install the site on the home screen.
const card = document.getElementById('bootCard');

// Read links from emails (password reset) before the database library tidies the address bar.
{
  const h = new URLSearchParams(location.hash.slice(1));
  window.__authLink = { recovery: h.get('type') === 'recovery', error: h.get('error_code') || h.get('error') || '', errorText: h.get('error_description') || '' };
}

function waitFor(test, ms) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() { if (test()) return resolve(true); if (Date.now() - t0 > ms) return resolve(false); setTimeout(poll, 100); })();
  });
}

const ready = await waitFor(() => window.L && window.supabase && window.supabase.createClient, 15000);
if (!ready) {
  card.innerHTML = '<h1 style="font-size:22px;margin:0 0 10px">Turtle Patrol could not start</h1>' +
    '<p style="margin:0">The map or database library did not load. Check your internet connection and reload the page.</p>' +
    '<p class="hint" style="margin:10px 0 0">Missing: ' + [!window.L && 'map library', !window.supabase && 'database library'].filter(Boolean).join(', ') + '</p>';
} else {
  try {
    const { start } = await import('./app.js');
    await start();
  } catch (e) {
    console.error(e);
    card.innerHTML = '<h1 style="font-size:22px;margin:0 0 10px">Something went wrong while starting</h1><p style="margin:0">Reload the page. If it keeps happening, send this message to an admin:</p><pre style="white-space:pre-wrap;font-size:12px">' +
      String(e && e.message || e).replace(/</g, '&lt;') + '</pre>';
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
