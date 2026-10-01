/* Effects are opt-in from JS: the `js` class is what arms the hidden-until-revealed
   states, so with scripting off or broken every section stays visible and readable.
   Nothing here is required to understand the page. */
(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;          // the page is complete without any of this
  root.classList.add('js');

  /* ---- reading progress ---- */
  var bar = document.createElement('div');
  bar.className = 'progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
      document.body.classList.toggle('scrolled', window.scrollY > 12);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- reveal on entry, staggered within a group ---- */
  var targets = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);          // reveal once; re-animating on scroll-up is noise
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    targets.forEach(function (el, i) {
      el.style.setProperty('--delay', (i % 4) * 70 + 'ms');
      io.observe(el);
    });
  } else {
    targets.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---- cards track the cursor, so the grid feels lit rather than painted ---- */
  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('pointermove', function (event) {
      var box = card.getBoundingClientRect();
      card.style.setProperty('--mx', (event.clientX - box.left) + 'px');
      card.style.setProperty('--my', (event.clientY - box.top) + 'px');
    });
    card.addEventListener('pointerleave', function () {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  });

  /* ---- the transcript replays itself once, because the point is the sequence ---- */
  var term = document.querySelector('.term[data-replay]');
  if (term && 'IntersectionObserver' in window) {
    var lines = term.querySelectorAll('.line');
    lines.forEach(function (line, i) { line.style.setProperty('--step', i * 190 + 'ms'); });
    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        term.classList.add('play');
        tio.unobserve(term);
      });
    }, { threshold: 0.35 });
    tio.observe(term);
  }

  /* ---- the onboarding terminal types itself: commands char by char, output in
       one beat. The markup is already the whole transcript, so without JS (or
       before it scrolls into view) nothing is missing — `armed` only hides it
       at the moment playback starts. ---- */
  var typeTerm = document.querySelector('.term[data-typeit]');
  if (typeTerm && 'IntersectionObserver' in window) {
    var script = Array.prototype.map.call(typeTerm.querySelectorAll('.line'), function (line) {
      var t = line.querySelector('.t');
      return { line: line, t: t, text: t ? t.textContent : '' };
    });
    var typeIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        typeIo.unobserve(typeTerm);
        typeTerm.classList.add('armed');
        script.forEach(function (s) { if (s.t) s.t.textContent = ''; });
        playTypeit(typeTerm, script);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
    typeIo.observe(typeTerm);
  }

  function playTypeit(term, script) {
    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    /* Hidden lines still occupy their space, so scrollHeight is already the full
       transcript — pinning to it would stare at the tail while the typing
       happens at the top. Pin to the line being written instead. */
    var pin = function (line) {
      term.scrollTop = line.offsetTop + line.offsetHeight - term.clientHeight + 14;
    };
    var i = 0;
    (function step() {
      if (i >= script.length) return;
      var s = script[i++];
      s.line.classList.add('show');
      pin(s.line);
      if (!s.t) { setTimeout(step, 150); return; }   // output arrives in one beat
      s.line.appendChild(caret);                   // .rest is display:none, so the caret hugs the text
      var n = 0;
      (function tick() {
        s.t.textContent = s.text.slice(0, ++n);
        pin(s.line);                               // an emptied line is heightless — pin as it regrows
        if (n < s.text.length) { setTimeout(tick, 16 + Math.random() * 34); return; }
        s.line.classList.add('done');
        if (i >= script.length) return;            // the caret stays blinking on the last prompt
        caret.remove();
        setTimeout(step, 420);
      })();
    })();
  }

  /* ---- copy the install line, with the result said out loud ---- */
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy');
      var done = function (ok) {
        button.setAttribute('data-state', ok ? 'ok' : 'fail');
        button.textContent = ok ? 'Copied' : 'Press ⌘C';
        setTimeout(function () {
          button.removeAttribute('data-state');
          button.textContent = 'Copy';
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);   // no silent failure: the button says what happened
      }
    });
  });
})();
