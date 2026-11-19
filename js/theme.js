// Tema prati izbor iz aplikacije The Golden Circle (ista adresa, isti localStorage "gc:v1").
// Učitava se u <head> pre stilova da ne bi trepnula pogrešna tema.
(function () {
  function apply() {
    var t = 'dark';
    try { t = JSON.parse(localStorage.getItem('gc:v1') || '{}').theme === 'light' ? 'light' : 'dark'; } catch (e) { /* bez pristupa storage-u ostaje tamna */ }
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#F7F3EA' : '#111111');
  }
  apply();
  window.addEventListener('storage', function (e) { if (e.key === 'gc:v1') apply(); });
})();
