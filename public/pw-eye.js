/* Gershon — show/hide eye on every password field (v1).
   Drop-in: load this file once per page (script tag, or inlined). No dependencies.
   The button lives in <body>, positioned over the field, so the page's own markup
   (React, Next, plain HTML) is never touched. */
(function () {
  if (window.__gershonPwEye) return;
  window.__gershonPwEye = true;
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.1 9.1 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  var css = '.gpw-eye{position:absolute;z-index:2147483000;width:30px;height:30px;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.gpw-eye:hover,.gpw-eye:focus-visible{color:#FE1B04;outline:none;background:rgba(254,27,4,.06)}.gpw-eye svg{width:18px;height:18px}.gpw-pad{padding-right:38px!important}';
  var items = []; // {input, btn}

  function addStyle() {
    if (document.getElementById('gpw-eye-css')) return;
    var s = document.createElement('style');
    s.id = 'gpw-eye-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  function known(input) {
    for (var i = 0; i < items.length; i++) if (items[i].input === input) return true;
    return false;
  }
  function setIcon(it) {
    var shown = it.input.type === 'text';
    it.btn.innerHTML = shown ? EYE_OFF : EYE;
    it.btn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    it.btn.title = shown ? 'Hide password' : 'Show password';
    it.btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
  }
  function enhance(input) {
    if (known(input) || input.hasAttribute('data-no-eye')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gpw-eye';
    btn.tabIndex = 0;
    var it = { input: input, btn: btn };
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus/caret in the field
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      input.type = input.type === 'password' ? 'text' : 'password';
      setIcon(it);
      try { input.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    });
    if (getComputedStyle(input).boxSizing === 'border-box') input.classList.add('gpw-pad');
    setIcon(it);
    document.body.appendChild(btn);
    items.push(it);
    place(it);
  }
  function place(it) {
    var r = it.input.getBoundingClientRect();
    var visible = it.input.isConnected && r.width > 40 && r.height > 10 && getComputedStyle(it.input).visibility !== 'hidden';
    if (!visible) { it.btn.style.display = 'none'; return; }
    it.btn.style.display = 'flex';
    it.btn.style.top = (window.scrollY + r.top + (r.height - 30) / 2) + 'px';
    it.btn.style.left = (window.scrollX + r.right - 34) + 'px';
  }
  function scan() {
    if (!document.body) return;
    addStyle();
    var list = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < list.length; i++) enhance(list[i]);
    for (var j = items.length - 1; j >= 0; j--) {
      if (!items[j].input.isConnected) { items[j].btn.remove(); items.splice(j, 1); }
      else place(items[j]);
    }
  }
  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan(); }); }
  function start() {
    scan();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) { var t = muts[i].target; if (!(t.classList && t.classList.contains('gpw-eye'))) { soon(); return; } }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] });
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    setInterval(scan, 1000); // catches layout shifts (fonts, animations) the observer cannot see
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
