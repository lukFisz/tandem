// Applies the saved theme before first paint. A separate file, not an inline script: the
// daemon's Content-Security-Policy allows scripts from 'self' only.
try {
  var t = localStorage.getItem('tdm.theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch (e) {}
