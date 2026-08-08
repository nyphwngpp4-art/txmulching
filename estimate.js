(() => {
  'use strict';

  /* ============== CONFIG — edit rates here, nothing else ============== */
  const CFG = {
    phone: '+19035679917',
    minJob: 2500,                 /* minimum job, dollars */
    smallLightAcres: 3,           /* light brush under this acreage -> referred out */
    densities: [
      { id: 'heavy',   t: 'Heavy',      d: "Thick trees & undergrowth, can't see through", lo: 3000, hi: 4600 },
      { id: 'extreme', t: 'Very heavy', d: 'Dense timber wall — needs a look in person',   lo: 0,    hi: 0 },
      { id: 'medium',  t: 'Medium',     d: 'Mixed brush & small trees, hard to walk',      lo: 1800, hi: 3000 },
      { id: 'light',   t: 'Light',      d: 'Grass, weeds, saplings you can walk through',  lo: 1000, hi: 1800 }
    ],
    zones: {
      near: { add: 0, label: 'Included' },
      mid:  { addLo: 400, addHi: 900, label: 'Travel added' },
      far:  { visit: true, label: 'Quoted per project' }
    }
  };
  /* ==================================================================== */

  const loadedAt = Date.now();
  let sel = CFG.densities[0];

  const $ = (id) => document.getElementById(id);
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

  const densBox = $('dens');
  CFG.densities.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<div class="t">' + d.t + '</div><div class="d">' + d.d + '</div>';
    if (d.id === sel.id) b.className = 'on';
    b.addEventListener('click', () => {
      sel = d;
      densBox.querySelectorAll('button').forEach((x) => { x.className = ''; });
      b.className = 'on';
    });
    densBox.appendChild(b);
  });

  function show(step) {
    ['step1', 'step2', 'step3'].forEach((s) => {
      $(s).className = 'card' + (s === step ? '' : ' hide');
    });
    const n = parseInt(step.slice(4), 10);
    ['s1', 's2', 's3'].forEach((id, i) => { $(id).className = i < n ? 'on' : ''; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function calc() {
    const a = Math.max(0.5, parseFloat($('acres').value) || 0);
    const z = CFG.zones[$('zone').value];
    const refer = sel.id === 'light' && a < CFG.smallLightAcres;
    const siteVisit = !refer && (sel.lo === 0 || z.visit === true);
    let lo = sel.lo * a, hi = sel.hi * a;
    let mob = 'Included';
    if (z.addLo) { lo += z.addLo; hi += z.addHi; mob = 'Travel included in range'; }
    if (z.visit) mob = 'Quoted per project';
    if (!siteVisit && !refer && lo < CFG.minJob) { lo = CFG.minJob; hi = Math.max(hi, CFG.minJob + 500); }
    return { a, lo, hi, mob, siteVisit, refer };
  }

  function summary(r) {
    const zoneText = $('zone').options[$('zone').selectedIndex].text;
    if (r.refer) return r.a + ' acres, ' + sel.t + ' brush, ' + zoneText + '. Small light-brush job — referred toward compact machine, wants advice.';
    if (r.siteVisit) return r.a + ' acres, ' + sel.t + ' brush, ' + zoneText + '. Needs a site walk.';
    return r.a + ' acres, ' + sel.t + ' brush, ' + zoneText + '. Range shown: ' + usd(r.lo) + '-' + usd(r.hi) + '.';
  }

  function render() {
    const r = calc();
    $('acOut').textContent = r.a + ' acres';
    $('dnOut').textContent = sel.t;
    $('mbOut').textContent = r.refer ? '—' : r.mob;
    if (r.refer) {
      $('rangeOut').textContent = 'Honest answer';
      $('rangeOut').style.fontSize = 'clamp(26px,6vw,40px)';
      $('perOut').textContent = "For light brush on a lot this size, a compact machine will likely cost you less than our minimum. Call or text and we'll point you to the right fit — and if the brush is thicker than it sounds, we've got you.";
    } else if (r.siteVisit) {
      $('rangeOut').textContent = 'Site walk';
      $('rangeOut').style.fontSize = 'clamp(30px,7vw,44px)';
      $('perOut').textContent = 'This one deserves eyes on the ground — the call takes two minutes to set up.';
    } else {
      $('rangeOut').style.fontSize = '';
      $('rangeOut').textContent = usd(r.lo) + ' – ' + usd(r.hi);
      $('perOut').textContent = '≈ ' + usd(r.lo / r.a) + '–' + usd(r.hi / r.a) + ' per acre, mulched in place. No burn piles, no hauling.';
    }
    const body = 'Hi, I used the estimate tool on txmulching.com. ' + $('name').value.trim() + ' — ' + summary(r);
    $('smsBtn').href = 'sms:' + CFG.phone + '?&body=' + encodeURIComponent(body);
  }

  function send() {
    const r = calc();
    const payload = {
      name: $('name').value.trim(),
      phone: $('phone').value.trim(),
      email: '',
      zipcode: '',
      acreage: r.a + ' acres',
      serviceType: 'Forestry Mulching',
      description: 'INSTANT ESTIMATE TOOL — ' + summary(r),
      website: $('website').value,
      formStartedAt: loadedAt
    };
    fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => { /* estimate still shown; lead reachable via call/text */ });
  }

  $('toStep2').addEventListener('click', () => {
    const a = parseFloat($('acres').value);
    if (!a || a <= 0) { $('acres').focus(); return; }
    show('step2');
  });

  $('toStep3').addEventListener('click', () => {
    const phone = $('phone').value.trim();
    if (!phone || phone.replace(/\D/g, '').length < 10) { $('phone').focus(); return; }
    if (!$('name').value.trim()) { $('name').focus(); return; }
    render();
    send();
    show('step3');
  });
})();
