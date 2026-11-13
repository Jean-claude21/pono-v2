// Proposition de design pour la console Pono : coquille commune, données d'exemple, pages.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* sans stockage, la page marche quand même */
      }
    },
  };

  /* ═════════════ Icônes ═════════════ */
  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12l3 3M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5z"/>',
    plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M19 19v2H6"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    updown: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    chart: '<path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-6"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  };
  const icon = (n) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] ?? ''}</svg>`;
  const paint = (root = document) =>
    $$('i[data-icon]', root).forEach((i) => (i.innerHTML = icon(i.dataset.icon)));

  /* ═════════════ Pages ═════════════ */
  const PAGES = {
    overview: { file: 'index.html', title: "Vue d'ensemble", icon: 'grid', group: 'Travail' },
    projects: { file: 'projets.html', title: 'Projets', icon: 'folder', group: 'Travail', count: '8' },
    servers: { file: 'serveurs.html', title: 'Serveurs', icon: 'server', group: 'Travail', count: '2/3' },
    releases: { file: 'mises-en-ligne.html', title: 'Mises en ligne', icon: 'rocket', group: 'Travail', count: '2', alert: true },
    connections: { file: 'connexions.html', title: 'Connexions', icon: 'plug', group: 'Réglages' },
    catalog: { file: 'catalogue.html', title: 'Catalogue', icon: 'book', group: 'Réglages' },
    agents: { file: 'agents.html', title: 'Agents', icon: 'bot', group: 'Réglages' },
    journal: { file: 'journal.html', title: 'Journal', icon: 'list', group: 'Réglages' },
    project: { file: 'projet.html', title: 'lectio', parent: 'projects' },
  };
  const current = document.body.dataset.page in PAGES ? document.body.dataset.page : 'overview';

  /* ═════════════ Données d'exemple ═════════════ */
  const PROJECTS = [
    { name: 'lectio', repo: 'Jean-claude21/lectio', state: ['active', 'En développement'], stack: 'Vite · React', server: ['healthy', 'Actif'], mode: 'demander', visits: [22, 30, 28, 35, 41, 39, 48], when: 'il y a 4 min' },
    { name: 'kya-energy', repo: 'kya/energy-site', state: ['healthy', 'En ligne'], stack: 'Next.js', server: ['idle', 'Aucun'], mode: 'auto', visits: [210, 260, 240, 300, 280, 330, 310], when: 'il y a 2 h' },
    { name: 'atelier-api', repo: 'studio/atelier-api', state: ['warning', 'Décision attendue'], stack: 'Hono · Neon', server: ['idle', 'En veille'], mode: 'demander', visits: [8, 9, 7, 12, 10, 11, 13], when: 'hier' },
    { name: 'pono-devloop-probe', repo: 'Jean-claude21/pono-devloop-probe', state: ['healthy', 'En ligne'], stack: 'Vite', server: ['idle', 'Aucun'], mode: 'libre', visits: [1, 0, 2, 1, 0, 1, 3], when: 'il y a 3 j' },
    { name: 'vitrine-2026', repo: 'studio/vitrine', state: ['failing', 'Build échoué'], stack: 'Astro', server: ['idle', 'Aucun'], mode: 'demander', visits: [90, 85, 70, 40, 12, 5, 3], when: 'il y a 5 j' },
    { name: 'carnet', repo: 'studio/carnet', state: ['warning', 'Décision attendue'], stack: 'SvelteKit', server: ['idle', 'Aucun'], mode: 'demander', visits: [40, 44, 39, 52, 48, 55, 60], when: 'il y a 6 j' },
    { name: 'docs-kya', repo: 'kya/docs', state: ['healthy', 'En ligne'], stack: 'Starlight', server: ['idle', 'Aucun'], mode: 'auto', visits: [130, 120, 150, 140, 160, 158, 170], when: 'il y a 2 sem' },
    { name: 'boutique-test', repo: 'studio/boutique', state: ['idle', 'En pause'], stack: 'Next.js · Stripe', server: ['idle', 'Aucun'], mode: 'demander', visits: [0, 0, 0, 0, 0, 0, 0], when: 'il y a 3 sem' },
  ];
  const SERVERS = [
    { project: 'lectio', id: 'a37-lectio-7f2c', state: ['healthy', 'Actif'], agent: 'Claude Code', hours: 212, since: 'il y a 6 j', on: true },
    { project: 'atelier-api', id: 'a37-atelier-91b0', state: ['idle', 'En veille'], agent: 'Codex', hours: 96, since: 'il y a 12 j', on: false },
  ];
  const WEEKS = [
    { lbl: 'S40', ok: 3, ko: 0 },
    { lbl: 'S41', ok: 5, ko: 1 },
    { lbl: 'S42', ok: 2, ko: 0 },
    { lbl: 'S43', ok: 6, ko: 0 },
    { lbl: 'S44', ok: 4, ko: 1 },
    { lbl: 'S45', ok: 7, ko: 0 },
    { lbl: 'S46', ok: 3, ko: 0 },
  ];
  const VISITS = [180, 240, 210, 320, 290, 410, 380, 460, 430, 520, 610, 580, 690, 740];
  const ALERTS = [
    { ref: 'lectio', what: 'Clé Stripe trouvée dans src/pay.ts:14', state: ['failing', 'Poussée bloquée'] },
    { ref: 'vitrine-2026', what: 'Build Netlify échoué sur main', state: ['failing', 'À corriger'] },
    { ref: 'kya-energy', what: 'Certificat renouvelé dans 9 jours', state: ['warning', 'À surveiller'] },
    { ref: 'atelier-api', what: 'Mise en ligne en attente de ta décision', state: ['warning', 'Décision'] },
    { ref: 'Neon', what: 'Connexion vérifiée de nouveau', state: ['healthy', 'Résolu'] },
  ];
  const PROVIDERS = [
    { id: 'GH', name: 'GitHub', role: 'Code · Actions', account: 'Jean-claude21', used: 0.91, unit: 'minutes Actions', left: '120 min restantes' },
    { id: 'NF', name: 'Netlify', role: 'Hébergement', account: 'studio-messan', used: 0.83, unit: 'minutes de build', left: '50 min restantes' },
    { id: 'A37', name: 'Agent37', role: 'Serveurs de projet', account: 'studio', used: 0.58, reserved: 0.12, unit: 'heures-serveur', left: '72 h restantes' },
    { id: 'NE', name: 'Neon', role: 'Base de données', account: 'studio', used: 0.34, unit: 'heures de calcul', left: '126 h restantes' },
    { id: 'CF', name: 'Cloudflare', role: 'Domaines · Workers', account: 'studio', used: 0.12, unit: 'requêtes Workers', left: '8,8 M restantes' },
    { id: 'UM', name: 'Umami', role: "Mesure d'audience", account: 'cloud', used: 0.22, unit: 'événements', left: '78 000 restants' },
    { id: 'ST', name: 'Stripe', role: 'Paiement', account: null },
    { id: 'RS', name: 'Resend', role: 'E-mails', account: null },
    { id: 'PH', name: 'PostHog', role: 'Analyse produit', account: null },
    { id: 'CO', name: 'Coolify', role: 'Auto-hébergement', account: null },
  ];
  const TEMPLATES = [
    { name: 'Site vitrine', stack: 'Astro · Netlify', level: 'novice', text: 'Pages, formulaire de contact et mesure d’audience prêts.' },
    { name: 'Application web', stack: 'TanStack Start · Neon', level: 'novice', text: 'Comptes, base Postgres et mise en ligne sur Netlify.' },
    { name: 'API', stack: 'Hono · Neon · Cloudflare', level: 'expert', text: 'Routes typées, migrations SQL, RLS par organisation.' },
    { name: 'Boutique', stack: 'Next.js · Stripe', level: 'novice', text: 'Catalogue, panier et paiement Stripe en mode test.' },
    { name: 'Documentation', stack: 'Starlight', level: 'novice', text: 'Recherche, versions et thème clair/sombre.' },
    { name: 'Service auto-hébergé', stack: 'Docker · Coolify', level: 'expert', text: 'Dockerfile, santé et déploiement sur ton Coolify.' },
  ];
  const SKILLS = [
    { name: 'nextjs-app-router', family: 'front', level: 'expert', text: 'Composants serveur, routes et cache.' },
    { name: 'neon-migrations', family: 'données', level: 'expert', text: 'Migrations SQL écrites à la main, une branche par preview.' },
    { name: 'rls-par-organisation', family: 'sécurité', level: 'expert', text: 'Chaque table a sa politique dans la même migration.' },
    { name: 'premiers-pas', family: 'méthode', level: 'novice', text: 'Petites étapes, toujours une preview à montrer.' },
    { name: 'secrets', family: 'sécurité', level: 'novice', text: 'Aucune clé dans le code : request_variable.' },
    { name: 'textes-fr-en', family: 'front', level: 'novice', text: 'Aucun texte visible en dur, messages Paraglide.' },
  ];
  const TOKENS = [
    { name: 'Claude Code · portable', scope: 'écriture', created: '2 nov.', used: 'il y a 4 min' },
    { name: 'Codex · bureau', scope: 'lecture', created: '28 oct.', used: 'hier' },
    { name: 'Script de sauvegarde', scope: 'lecture', created: '3 sept.', used: 'il y a 41 j' },
  ];
  const EVENTS = [
    { day: "Aujourd'hui", time: '10:42', channel: 'Agent', actor: 'Claude Code', project: 'lectio', what: 'a poussé 3 fichiers vers dev', detail: 'b81e04d · contrôle des secrets passé', state: 'healthy' },
    { day: "Aujourd'hui", time: '10:31', channel: 'MCP', actor: 'Claude Code', project: 'lectio', what: 'poussée refusée', detail: 'secret trouvé dans src/pay.ts:14 (valeur jamais montrée)', state: 'failing' },
    { day: "Aujourd'hui", time: '10:05', channel: 'Console', actor: 'Jean-Claude', project: 'lectio', what: 'a démarré le serveur de dev', detail: 'vite dev · port 5173 · prêt en 9 s', state: 'active' },
    { day: "Aujourd'hui", time: '09:12', channel: 'Système', actor: 'Pono', project: 'vitrine-2026', what: 'build Netlify échoué', detail: 'alerte envoyée par e-mail', state: 'failing' },
    { day: 'Hier', time: '18:20', channel: 'MCP', actor: 'Codex', project: 'atelier-api', what: 'a proposé une mise en ligne', detail: 'PR #31 vers main · mode demander', state: 'warning' },
    { day: 'Hier', time: '16:02', channel: 'Console', actor: 'Jean-Claude', project: 'kya-energy', what: 'a choisi le mode auto', detail: 'les PR vertes partent seules en production', state: 'active' },
    { day: 'Hier', time: '11:47', channel: 'Système', actor: 'Pono', project: 'atelier-api', what: 'a mis le serveur en veille', detail: '30 min sans activité', state: 'idle' },
    { day: '10 nov.', time: '15:33', channel: 'Agent', actor: 'Claude Code', project: 'carnet', what: 'a créé la skill « textes-fr-en »', detail: 'proposée au catalogue de l’équipe', state: 'active' },
    { day: '10 nov.', time: '09:00', channel: 'Système', actor: 'Pono', project: 'docs-kya', what: 'retour arrière automatique', detail: 'santé en échec 3 fois · version précédente remise', state: 'warning' },
  ];

  /* ═════════════ Petits outils ═════════════ */
  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
  const st = ([cls, txt], live) => `<span class="state ${cls}${live ? ' live' : ''}">${txt}</span>`;
  const stats = (items, four) =>
    `<div class="stats${four ? ' four' : ''}">${items
      .map(([v, l, u]) => `<div class="stat"><b>${v}${u ? `<small>${u}</small>` : ''}</b><span>${l}</span></div>`)
      .join('')}</div>`;
  const bar = (pct, cls = '', reserved = 0, mark = false) =>
    `<div class="bar ${cls}"><span data-w="${Math.min(100, pct)}"></span>${reserved ? `<span class="reserved" data-w="${reserved}"></span>` : ''}${mark ? '<i class="mark"></i>' : ''}</div>`;
  const tools = `<button class="icon-btn" data-toast="Vue en tableau" aria-label="Tableau"><i data-icon="table"></i></button><button class="icon-btn" data-toast="Export CSV prêt" aria-label="Exporter"><i data-icon="download"></i></button>`;
  const card = ({ title, ic, body, foot, cls = '', side = tools }) =>
    `<article class="card ${cls}"><header class="card-head"><span class="card-icon"><i data-icon="${ic}"></i></span><h2>${title}</h2><div class="card-tools">${side}</div></header>${body}${foot ? `<footer class="card-foot">${foot}</footer>` : ''}</article>`;
  const head = (title, text, actions = '') =>
    `<div class="page-head"><div><h1>${title}</h1><p>${text}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  const verdict = (cls, label, title, text, action = '') =>
    `<div class="verdict ${cls}"><div><span class="label">${label}</span><h3>${title}</h3><p>${text}</p></div>${action}</div>`;
  const grow = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        $$('[data-w]').forEach((s) => (s.style.width = `${s.dataset.w}%`));
        $$('[data-h]').forEach((s) => (s.style.height = `${s.dataset.h}%`));
      }),
    );
  const spark = (data) => {
    const max = Math.max(1, ...data);
    const d = data.map((v, i) => `${i ? 'L' : 'M'}${(i / (data.length - 1)) * 80},${20 - (v / max) * 17}`).join(' ');
    return `<svg class="spark" viewBox="0 0 80 22"><path d="${d}"/></svg>`;
  };
  const segmented = (id, items, on) =>
    `<div class="segmented" id="${id}">${items.map(([v, l]) => `<button data-v="${v}" class="${v === on ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const onSegment = (id, fn) =>
    $(`#${id}`)?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v, b);
    });

  /* Toast et info-bulle */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }
  function tip(text, x, y) {
    const t = $('#tooltip');
    t.textContent = text;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
    t.hidden = false;
  }
  const hideTip = () => ($('#tooltip').hidden = true);

  /* Fenêtre de dialogue générique */
  function dialog(html, bind) {
    const d = $('#dialog');
    $('.dialog', d).innerHTML = html;
    paint(d);
    d.hidden = false;
    bind?.($('.dialog', d));
  }
  const closeDialog = () => ($('#dialog').hidden = true);

  /* ═════════════ Coquille commune ═════════════ */
  function shell() {
    const page = PAGES[current];
    const active = page.parent ?? current;
    const groups = ['Travail', 'Réglages'];
    $('#sidebar').innerHTML = `
      <a class="monogram" href="index.html"><b>P</b><span class="hide-collapsed">Pono</span></a>
      ${groups
        .map(
          (g) => `<div class="nav-group label hide-collapsed">${g}</div>${Object.entries(PAGES)
            .filter(([, p]) => p.group === g)
            .map(
              ([k, p]) => `<a class="nav-item ${k === active ? 'active' : ''}" href="${p.file}" title="${p.title}">
                <i data-icon="${p.icon}"></i><span class="hide-collapsed">${p.title}</span>
                ${p.count ? `<b class="count hide-collapsed ${p.alert ? 'alert' : ''}">${p.count}</b>` : ''}</a>`,
            )
            .join('')}`,
        )
        .join('')}
      <div class="sidebar-foot">
        <a class="plan" href="serveurs.html" title="Plan Équipe : 2 serveurs sur 3">
          <svg class="ring" viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15"/><circle class="f" cx="18" cy="18" r="15" style="--p:67"/><text x="18" y="21" text-anchor="middle">2/3</text></svg>
          <div class="hide-collapsed"><strong>Plan Équipe</strong><span>2 serveurs sur 3 utilisés</span></div>
        </a>
        <a class="nav-item" data-toast="Aide : bientôt" title="Aide"><i data-icon="help"></i><span class="hide-collapsed">Aide</span></a>
        <a class="nav-item" id="themeToggle" title="Thème"><i data-icon="moon"></i><span class="hide-collapsed">Thème sombre</span></a>
        <div class="me"><span class="avatar">JC</span><div class="hide-collapsed"><strong>Jean-Claude</strong><span>Administrateur · expert</span></div></div>
        <a class="nav-item" id="collapse" title="Réduire"><i data-icon="sidebar"></i><span class="hide-collapsed">Réduire</span></a>
      </div>`;

    const crumbs = [`<span class="hide-narrow">Studio Messan</span>`, `<i data-icon="chevron" class="hide-narrow"></i>`];
    if (page.parent) crumbs.push(`<a href="${PAGES[page.parent].file}">${PAGES[page.parent].title}</a><i data-icon="chevron"></i>`);
    crumbs.push(`<strong>${page.title}</strong>`);
    $('#topbar').innerHTML = `
      <nav class="crumbs">${crumbs.join('')}</nav>
      <div class="top-actions">
        <button class="search" id="openPalette"><i data-icon="search"></i><span>Chercher un projet, une skill, une action…</span><kbd>Ctrl K</kbd></button>
        <button class="org" data-toast="Une seule organisation pour l’instant"><b>S</b><span>Studio Messan</span><i data-icon="updown"></i></button>
        <a class="icon-btn bell" href="mises-en-ligne.html" aria-label="Alertes"><i data-icon="bell"></i><b></b></a>
      </div>`;
    document.title = `Pono · ${page.title}`;

    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="backdrop" id="palette" hidden><div class="dialog" role="dialog" aria-label="Recherche">
         <div class="palette-input"><i data-icon="search"></i><input id="paletteInput" placeholder="Projet, page, skill, action…" autocomplete="off"/><kbd>Échap</kbd></div>
         <ul class="choices" id="paletteList"></ul></div></div>
       <div class="backdrop" id="dialog" hidden><div class="dialog" role="dialog"></div></div>
       <div class="tooltip" id="tooltip" hidden></div>
       <div class="toast" id="toast" hidden></div>`,
    );

    // Thème
    const root = document.documentElement;
    const saved = store.get('pono-theme');
    if (saved) root.dataset.theme = saved;
    const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
    const paintTheme = () => {
      const t = $('#themeToggle');
      t.querySelector('i').dataset.icon = dark() ? 'sun' : 'moon';
      t.querySelector('span').textContent = dark() ? 'Thème clair' : 'Thème sombre';
      paint(t);
    };
    $('#themeToggle').onclick = () => {
      root.dataset.theme = dark() ? 'light' : 'dark';
      store.set('pono-theme', root.dataset.theme);
      paintTheme();
    };
    // Barre latérale réduite
    if (store.get('pono-collapsed') === '1') $('#app').classList.add('collapsed');
    $('#collapse').onclick = () => {
      const on = $('#app').classList.toggle('collapsed');
      store.set('pono-collapsed', on ? '1' : '0');
    };

    paint();
    paintTheme();
    palette();

    // Délégations communes
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toast]');
      if (t) toast(t.dataset.toast);
      const h = e.target.closest('[data-href]');
      if (h && !e.target.closest('button, a')) location.href = h.dataset.href;
      if (e.target.id === 'dialog' || e.target.closest('[data-close]')) closeDialog();
    });
    document.addEventListener('mouseover', (e) => {
      const c = e.target.closest('[data-tip]');
      if (!c) return;
      const r = ($('.stack', c) ?? c).getBoundingClientRect();
      tip(c.dataset.tip, r.left + r.width / 2, r.top);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tip]')) hideTip();
    });
  }

  /* Palette Ctrl K */
  function palette() {
    const entries = [
      ...Object.values(PAGES)
        .filter((p) => p.group)
        .map((p) => ({ label: p.title, kind: 'Page', ic: p.icon, href: p.file })),
      ...PROJECTS.map((p) => ({ label: p.name, kind: 'Projet', ic: 'folder', href: 'projet.html' })),
      { label: 'Démarrer le dev de lectio', kind: 'Action', ic: 'code', href: 'projet.html#dev' },
      { label: 'Nouveau projet depuis un modèle', kind: 'Action', ic: 'plus', href: 'catalogue.html' },
      { label: 'Créer un jeton pour un agent', kind: 'Action', ic: 'key', href: 'agents.html' },
      ...SKILLS.map((s) => ({ label: s.name, kind: 'Skill', ic: 'book', href: 'catalogue.html#skills' })),
    ];
    const pal = $('#palette');
    const input = $('#paletteInput');
    const list = $('#paletteList');
    let sel = 0;
    let found = entries;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      found = entries.filter((x) => x.label.toLowerCase().includes(q));
      sel = Math.min(sel, Math.max(0, found.length - 1));
      list.innerHTML = found.length
        ? found
            .map((x, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><i data-icon="${x.ic}"></i>${x.label}<span class="kind">${x.kind}</span></li>`)
            .join('')
        : '<li class="empty">Rien ne correspond.</li>';
      paint(list);
    };
    const open = () => {
      pal.hidden = false;
      input.value = '';
      sel = 0;
      render();
      input.focus();
    };
    const go = (i) => found[i] && (location.href = found[i].href);
    $('#openPalette').onclick = open;
    pal.onclick = (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) go(Number(li.dataset.i));
      if (e.target === pal || li) pal.hidden = true;
    };
    input.oninput = () => {
      sel = 0;
      render();
    };
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        pal.hidden ? open() : (pal.hidden = true);
      } else if (e.key === 'Escape') {
        pal.hidden = true;
        closeDialog();
      } else if (!pal.hidden && found.length) {
        if (e.key === 'Enter') go(sel);
        else if (e.key === 'ArrowDown') (sel = (sel + 1) % found.length), render();
        else if (e.key === 'ArrowUp') (sel = (sel - 1 + found.length) % found.length), render();
      }
    });
  }

  /* ═════════════ Blocs partagés ═════════════ */
  function areaChart(data, labels) {
    const W = 320, H = 170, pad = 18;
    const max = Math.max(...data) * 1.15 || 1;
    const x = (i) => (i / (data.length - 1)) * W;
    const y = (v) => H - pad - (v / max) * (H - pad - 6);
    const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const grid = [0.25, 0.5, 0.75, 1].map((g) => `<line class="gl" x1="0" x2="${W}" y1="${y(max * g * 0.87)}" y2="${y(max * g * 0.87)}"/>`).join('');
    const xs = labels
      .map(([i, l], k) => `<text class="x" x="${x(i)}" y="${H - 3}" text-anchor="${k === labels.length - 1 ? 'end' : k ? 'middle' : 'start'}">${l}</text>`)
      .join('');
    return { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<path class="fill" d="${line} L${W},${H - pad} L0,${H - pad} Z"/><path class="line" d="${line}"/>${xs}</svg>`, x, y, H };
  }
  function bindArea(el, data, chart, label) {
    const svg = $('svg', el);
    svg.onmousemove = (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1))));
      tip(label(i, data[i]), r.left + (chart.x(i) / 320) * r.width, r.top + (chart.y(data[i]) / chart.H) * r.height);
    };
    svg.onmouseleave = hideTip;
  }
  function releaseChart(weeks) {
    return `<div class="chart"><div class="axis"><span>8</span><span>6</span><span>4</span><span>2</span><span>0</span></div>
      <div class="plot">${weeks
        .map(
          (w) => `<div class="col" data-tip="${w.lbl} · ${w.ok} réussie${w.ok > 1 ? 's' : ''}${w.ko ? ` · ${w.ko} annulée` : ''}">
          <div class="stack" data-h="${((w.ok + w.ko) / 8) * 100}"><span style="flex:${w.ok}"></span>${w.ko ? `<span style="flex:${w.ko}"></span>` : ''}</div>
          <span class="lbl">${w.lbl}</span></div>`,
        )
        .join('')}</div></div>`;
  }

  /* Boucle de développement (simulée) */
  function devCard(cls = '') {
    return card({
      title: 'Dev · lectio',
      ic: 'code',
      cls,
      side: `<button class="btn primary sm" id="devToggle">Arrêter</button>`,
      body: `<div id="devStats"></div>
        <a class="preview" id="previewLink" href="#"><span class="state healthy live" id="devDot"></span><span>a37-lectio-7f2c-5173.agent37.app</span><i data-icon="external"></i></a>
        <pre class="logs" id="logs"></pre>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost sm" id="devPull">Ramener de dev</button><button class="btn ghost sm" id="devPush">Pousser vers dev</button></div>`,
      foot: 'Branche <b>dev</b> · la preview se recharge à chaque fichier modifié',
    });
  }
  let devTimer;
  function bindDev() {
    const log = $('#logs');
    if (!log) return;
    let on = true;
    let changed = 3;
    const FILES = ['src/routes/index.tsx', 'src/components/Reader.tsx', 'src/styles/app.css', 'src/lib/books.ts'];
    const stamp = () => new Date().toLocaleTimeString('fr-FR');
    const push = (cls, text) => {
      log.insertAdjacentHTML('beforeend', `<span class="t">${stamp()}</span> <span class="${cls}">${text}</span>\n`);
      log.scrollTop = log.scrollHeight;
    };
    const render = () => {
      $('#devStats').innerHTML = stats(
        on ? [['Actif', 'Serveur de dev'], [String(changed), 'Fichiers modifiés'], ['9', 'Prêt en', 's']] : [['Arrêté', 'Serveur de dev'], [String(changed), 'Fichiers modifiés'], ['—', 'Prêt en']],
      );
      $('#devDot').className = `state ${on ? 'healthy live' : 'idle'}`;
      $('#devToggle').textContent = on ? 'Arrêter' : 'Démarrer';
      $('#devPush').disabled = !changed;
    };
    const boot = () => {
      log.innerHTML = '';
      push('', 'git fetch origin dev · à jour (a3f92c1)');
      push('', 'pnpm install · 412 paquets en 6,1 s');
      push('', 'vite dev --host 0.0.0.0 --port 5173');
      push('ok', 'VITE v7.1 ready in 842 ms · preview publiée');
    };
    $('#devToggle').onclick = () => {
      on = !on;
      on ? boot() : push('warn', 'serveur de dev arrêté');
      render();
    };
    $('#devPull').onclick = (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      push('', 'git pull origin dev …');
      setTimeout(() => {
        push('ok', '2 commits ramenés (b81e04d) · la preview suit');
        b.disabled = false;
      }, 900);
    };
    $('#devPush').onclick = () => {
      push('', `contrôle des secrets sur ${changed} fichiers…`);
      setTimeout(() => {
        push('ok', `poussé vers dev · ${changed} fichiers (c47d2a9)`);
        changed = 0;
        render();
        toast('Poussé vers dev. La production attend une proposition.');
      }, 800);
    };
    $('#previewLink').onclick = (e) => {
      e.preventDefault();
      toast('La preview s’ouvrirait dans un nouvel onglet');
    };
    boot();
    render();
    clearInterval(devTimer);
    devTimer = setInterval(() => {
      if (!on) return;
      push('ok', `[vite] hmr update /${FILES[Math.floor(Math.random() * FILES.length)]}`);
      if (Math.random() > 0.6) changed = Math.min(9, changed + 1);
      render();
    }, 4000);
  }

  /* ═════════════ Vue d'ensemble ═════════════ */
  function overview(page) {
    let factor = 1;
    const periods = { 7: 0.3, 30: 1, 90: 2.8, 365: 10.5 };
    page.innerHTML = `
      ${head("Vue d'ensemble", 'Tes projets, leurs serveurs, leurs mises en ligne et ce que consomment tes abonnements. Chaque chiffre vient des mêmes données que le reste de Pono.', segmented('period', [['7', '7 jours'], ['30', '30 jours'], ['90', 'Trimestre'], ['365', 'Année']], '30'))}
      ${verdict('', 'Deux choses t’attendent', 'vitrine-2026 ne se construit plus, et atelier-api attend ta décision.', 'Le build Netlify échoue sur main depuis 5 jours ; une mise en ligne est proposée par Codex depuis hier.', '<a class="btn ghost sm" href="mises-en-ligne.html">Décider</a>')}
      <div class="grid">
        ${card({ title: 'Projets', ic: 'folder', body: `<div id="pStats"></div><ul class="rows" id="pRows"></ul>`, foot: 'Triés par dernière activité · état lu depuis pono.yaml' })}
        ${card({ title: 'Serveurs de projet', ic: 'server', body: `<div id="sStats"></div><ul class="rows" id="sRows"></ul>`, foot: 'Un serveur Agent37 par projet lancé · limite du plan : 3' })}
        ${devCard()}
        ${card({ title: 'Mises en ligne', ic: 'rocket', body: `<div id="rStats"></div>${releaseChart(WEEKS)}`, foot: 'Mode <b>demander</b> sur 5 projets · <b>auto</b> sur 2 · <b>libre</b> sur 1' })}
        ${card({ title: 'Visites', ic: 'chart', body: `<div id="vStats"></div><div class="area" id="vChart"></div>`, foot: 'Umami · tous les projets en ligne · sans cookie' })}
        ${card({ title: 'Alertes', ic: 'alert', body: `${stats([['3', 'Ouvertes'], ['1', 'Secret bloqué'], ['12', 'Résolues']])}<ul class="rows">${ALERTS.map((a) => `<li><div class="row-top"><span class="mono mute">${a.ref}</span><span class="sub" style="margin-left:auto">${st(a.state)}</span></div><div class="soft" style="font-size:13px;margin-top:2px">${a.what}</div></li>`).join('')}</ul>`, foot: 'Vérifiées toutes les 15 minutes · prévenu par e-mail' })}
        ${card({ title: 'Abonnements connectés', ic: 'plug', cls: 'wide', body: `<div class="usage" id="usage"></div>`, foot: `<span class="legend"><span><i class="sw"></i>Utilisé</span><span><i class="sw reserved"></i>Réservé</span><span><i class="sw warn"></i>Au-delà du seuil</span><span><i class="tick"></i>Seuil d'alerte 80 %</span></span>` })}
      </div>
      <p class="note"><span class="tag" id="periodTag">30 jours</span>Les serveurs sont comptés à l'heure ; les visites viennent d'Umami ; les quotas sont lus chez chaque fournisseur avec tes propres clés.</p>`;

    const render = () => {
      $('#pStats').innerHTML = stats([['8', 'Projets'], ['4', 'En ligne'], ['3', 'À regarder']]);
      const maxV = Math.max(...PROJECTS.map((p) => p.visits.reduce((a, b) => a + b)));
      $('#pRows').innerHTML = PROJECTS.slice(0, 5)
        .map((p) => `<li data-href="projet.html" style="cursor:pointer"><div class="row-top"><span class="name">${p.name}</span>${st(p.state)}</div>
          <div class="row-top" style="margin-top:2px"><span class="mono mute" style="flex:1">${p.repo}</span><span class="sub">${p.when}</span></div>
          ${bar((p.visits.reduce((a, b) => a + b) / maxV) * 100, p.state[0] === 'failing' ? 'failing' : '')}</li>`)
        .join('');
      $('#sStats').innerHTML = stats([['2/3', 'Utilisés'], [fmt(308 * factor), 'Heures', 'h'], ['1', 'En veille']]);
      $('#sRows').innerHTML = [...SERVERS, { project: 'Emplacement libre', id: 'disponible pour un projet', state: ['idle', 'Libre'], hours: 0 }]
        .map((s) => `<li><div class="row-top"><span class="name">${s.project}</span><span class="fig sub">${s.hours ? `${fmt(s.hours * factor)} h` : '—'}</span>${st(s.state, s.on)}</div>
          <div class="row-top" style="margin-top:2px"><span class="mono mute">${s.id}</span></div>${bar((s.hours / 240) * 100)}</li>`)
        .join('');
      const total = WEEKS.reduce((a, w) => a + w.ok + w.ko, 0);
      $('#rStats').innerHTML = stats([[fmt(total * factor), 'Mises en ligne'], ['2', 'En attente'], ['2', 'Retours arrière']]);
      const data = VISITS.map((v) => v * factor);
      const sum = data.reduce((a, b) => a + b, 0);
      $('#vStats').innerHTML = stats([[fmt(sum), 'Visiteurs'], [fmt(sum * 2.7), 'Pages vues'], ['38', 'Rebond', '%']]);
      const chart = areaChart(data, [[0, 'J-13'], [4, 'J-9'], [8, 'J-5'], [13, "Aujourd'hui"]]);
      $('#vChart').innerHTML = chart.html;
      bindArea($('#vChart'), data, chart, (i, v) => `J-${data.length - 1 - i} · ${fmt(v)} visiteurs`);
      $('#usage').innerHTML = PROVIDERS.filter((p) => p.account)
        .map((u) => {
          const used = Math.min(0.99, u.used * factor ** 0.2);
          const pct = Math.round((used + (u.reserved ?? 0)) * 100);
          return `<div><div class="row-top"><span class="name">${u.name}</span><span class="fig">${pct} %</span><span class="sub">${u.left}</span></div>
            <div class="row-top"><span class="sub">${u.unit}</span></div>${bar(used * 100, pct >= 80 ? 'warning' : '', (u.reserved ?? 0) * 100, true)}</div>`;
        })
        .join('');
      grow();
    };
    render();
    bindDev();
    onSegment('period', (v, b) => {
      factor = periods[v];
      $('#periodTag').textContent = b.textContent;
      render();
    });
  }

  /* ═════════════ Projets ═════════════ */
  function projects(page) {
    page.innerHTML = `
      ${head('Projets', 'Tous les projets construits par tes agents, quel que soit le dépôt ou la stack. Un clic ouvre la fiche.', '<button class="btn primary" id="newProject"><i data-icon="plus"></i>Nouveau projet</button>')}
      <div class="toolbar">
        <label class="field"><i data-icon="search"></i><input id="q" placeholder="Nom ou dépôt…"/></label>
        ${segmented('filter', [['all', 'Tous'], ['healthy', 'En ligne'], ['active', 'En cours'], ['attention', 'À regarder'], ['idle', 'En pause']], 'all')}
      </div>
      <article class="card flush"><div class="table-wrap"><table>
        <thead><tr><th>Projet</th><th>État</th><th>Stack</th><th>Serveur</th><th>Mise en ligne</th><th class="num">Visites 7 j</th><th></th><th>Activité</th></tr></thead>
        <tbody id="rows"></tbody></table></div></article>
      <p class="note"><span class="tag">pono.yaml</span>L'état, la stack et la règle de mise en ligne sont lus dans le manifeste de chaque dépôt.</p>`;
    let filter = 'all';
    const render = () => {
      const q = $('#q').value.trim().toLowerCase();
      const list = PROJECTS.filter(
        (p) =>
          (filter === 'all' || p.state[0] === filter || (filter === 'attention' && ['warning', 'failing'].includes(p.state[0]))) &&
          (p.name.includes(q) || p.repo.toLowerCase().includes(q)),
      );
      $('#rows').innerHTML = list.length
        ? list
            .map((p) => `<tr class="link" data-href="projet.html">
              <td><span class="name">${p.name}</span><span class="mono">${p.repo}</span></td>
              <td>${st(p.state)}</td><td><span class="tag">${p.stack}</span></td><td>${st(p.server, p.server[1] === 'Actif')}</td>
              <td><span class="tag">${p.mode}</span></td>
              <td class="num">${fmt(p.visits.reduce((a, b) => a + b))}</td><td>${spark(p.visits)}</td>
              <td class="mute" style="white-space:nowrap">${p.when}</td></tr>`)
            .join('')
        : `<tr><td colspan="8" class="empty">Aucun projet ne correspond.</td></tr>`;
    };
    render();
    $('#q').oninput = render;
    onSegment('filter', (v) => {
      filter = v;
      render();
    });
    $('#newProject').onclick = () =>
      dialog(
        `<div class="dialog-body"><h3>Nouveau projet</h3><p class="mute" style="margin-top:4px">Trois façons de commencer. Ton agent peut aussi le faire par MCP.</p></div>
         <ul class="choices">
           <li data-go="catalogue.html"><i data-icon="book"></i><div><b>Depuis un modèle</b><p>Un dépôt prêt, avec son pono.yaml et ses skills.</p></div></li>
           <li data-go="projet.html"><i data-icon="branch"></i><div><b>Adopter un dépôt GitHub</b><p>Pono lit le dépôt et propose un pono.yaml.</p></div></li>
           <li data-go="connexions.html"><i data-icon="globe"></i><div><b>Importer depuis un hébergeur</b><p>Netlify, Cloudflare ou Coolify : on retrouve le dépôt.</p></div></li>
         </ul>
         <div class="dialog-body" style="border-top:1px solid var(--hairline);text-align:right"><button class="btn ghost sm" data-close>Annuler</button></div>`,
        (d) => d.addEventListener('click', (e) => {
          const li = e.target.closest('[data-go]');
          if (li) location.href = li.dataset.go;
        }),
      );
  }

  /* ═════════════ Fiche projet ═════════════ */
  function project(page) {
    const p = PROJECTS[0];
    page.innerHTML = `
      <div class="page-head"><div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h1>lectio</h1>${st(p.state, true)}</div>
        <p><span class="mono">${p.repo}</span> · ${p.stack} · règle de mise en ligne <span class="tag">demander</span></p></div>
        <div class="actions">
          <button class="btn ghost" data-toast="La preview s’ouvrirait dans un nouvel onglet"><i data-icon="external"></i>Preview</button>
          <button class="btn ghost" data-toast="Le dépôt s’ouvrirait sur GitHub"><i data-icon="branch"></i>Dépôt</button>
          <button class="btn primary" id="propose"><i data-icon="rocket"></i>Proposer une mise en ligne</button>
        </div></div>
      ${verdict('warning', 'Pas encore en production', '3 fichiers modifiés sur le serveur, pas encore poussés vers dev.', 'La dernière poussée a été refusée : une clé Stripe était écrite dans src/pay.ts, ligne 14. Elle est maintenant une variable scellée.', '<button class="btn ghost sm" id="goDev">Voir le dev</button>')}
      <div class="tabs" id="tabs">
        ${[['apercu', 'Aperçu'], ['dev', 'Développement'], ['manifeste', 'Manifeste'], ['variables', 'Variables'], ['versions', 'Mises en ligne']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div id="tab"></div>`;

    const TABS = {
      apercu: () => {
        const data = [18, 22, 20, 31, 28, 35, 33, 40, 38, 44, 41, 48, 52, 49];
        const chart = areaChart(data, [[0, 'J-13'], [7, 'J-6'], [13, "Aujourd'hui"]]);
        setTimeout(() => bindArea($('#pv'), data, chart, (i, v) => `J-${13 - i} · ${v} visiteurs`));
        return `<div class="grid">
          ${card({ title: 'Serveur du projet', ic: 'server', side: `<button class="btn ghost sm" data-toast="Serveur mis en veille">Mettre en veille</button>`, body: `<dl class="kv"><dt>État</dt><dd>${st(['healthy', 'Actif'], true)}</dd><dt>Fournisseur</dt><dd>Agent37</dd><dt>Identifiant</dt><dd class="mono">a37-lectio-7f2c</dd><dt>Agent</dt><dd>Claude Code</dd><dt>Ce mois</dt><dd class="fig">212 h sur 240 h</dd></dl>${bar(88, 'warning', 0, true)}`, foot: 'Mise en veille automatique après 30 min sans activité' })}
          ${card({ title: 'Production', ic: 'globe', side: '', body: `<dl class="kv"><dt>Adresse</dt><dd class="mono">—</dd><dt>Hébergeur</dt><dd>Netlify</dd><dt>Base</dt><dd>Neon · branche main</dd><dt>Règle</dt><dd><span class="tag">demander</span> tu approuves chaque mise en ligne</dd><dt>Dernière</dt><dd class="mute">aucune pour l’instant</dd></dl>`, foot: 'La production n’avance que par une proposition approuvée' })}
          ${card({ title: 'Visites de la preview', ic: 'chart', body: `${stats([['559', 'Visiteurs'], ['1 402', 'Pages vues'], ['41', 'Rebond', '%']])}<div class="area" id="pv">${chart.html}</div>`, foot: 'Umami · site lié automatiquement au lancement' })}
          ${card({ title: 'Skills suivies', ic: 'book', side: `<a class="btn ghost sm" href="catalogue.html#skills">Gérer</a>`, cls: 'wide', body: `<ul class="rows">${SKILLS.slice(0, 4).map((s) => `<li><div class="row-top"><span class="name mono" style="font-weight:500">${s.name}</span><span class="tag">${s.family}</span><span class="sub">${s.level}</span></div><div class="soft" style="font-size:13px">${s.text}</div></li>`).join('')}</ul>`, foot: 'Lues par l’agent au début de chaque session (get_skill)' })}
        </div>`;
      },
      dev: () => {
        setTimeout(bindDev);
        return `<div class="grid two">${devCard()}
          ${card({ title: 'Ce que voit ton agent', ic: 'bot', side: '', body: `<p class="soft" style="font-size:13px">Au début de chaque session, le plugin Pono donne à Claude Code le projet, son serveur et sa preview. La ligne de statut reste à jour :</p>
            <pre class="code">pono · lectio · server running · dev running
a37-lectio-7f2c-5173.agent37.app · 3 changed · release ask</pre>
            <p class="soft" style="font-size:13px;margin-top:12px">Les outils MCP de la boucle :</p>
            <pre class="code"><span class="k">start_dev</span>  <span class="k">dev_status</span>  <span class="k">stop_dev</span>
<span class="k">pull_changes</span>  <span class="k">push_changes</span>  <span class="k">check_secrets</span></pre>`, foot: 'Commandes : /pono:status · /pono:logs · /pono:ship' })}</div>`;
      },
      manifeste: () => `<div class="grid two">
        ${card({ title: 'pono.yaml', ic: 'file', side: `<button class="btn ghost sm" data-toast="Proposition de changement ouverte sur GitHub">Proposer un changement</button>`, body: `<pre class="code"><span class="k">version</span>: 1
<span class="k">name</span>: lectio
<span class="k">stack</span>: [vite, react]
<span class="k">release</span>:
  <span class="k">mode</span>: ask            <span class="c"># ask · auto · bypass</span>
  <span class="k">host</span>: netlify
<span class="k">database</span>: neon
<span class="k">skills</span>: [premiers-pas, secrets, textes-fr-en, neon-migrations]
<span class="k">dev</span>:
  <span class="k">install</span>: pnpm install
  <span class="k">command</span>: pnpm dev --host 0.0.0.0
  <span class="k">port</span>: 5173</pre>`, foot: 'Synchronisé il y a 4 min · commit a3f92c1' })}
        ${card({ title: 'Ce que Pono en lit', ic: 'shield', side: '', body: `<dl class="kv"><dt>Statut</dt><dd>${st(['healthy', 'Valide'])}</dd><dt>Origine</dt><dd>créé par Pono, adopté</dd><dt>Modèle</dt><dd>Application web</dd><dt>Dev</dt><dd class="mono">pnpm dev · port 5173</dd><dt>Problèmes</dt><dd class="mute">aucun</dd></dl>
          <div class="verdict healthy" style="margin:16px 0 0"><div><span class="label">Lisible</span><h3>Le manifeste est complet.</h3><p>Pono sait installer, lancer et mettre en ligne ce projet.</p></div></div>`, foot: 'Les anciens formats (HCL, .pono) sont lus et convertis' })}
      </div>`,
      variables: () => {
        const VARS = [
          ['DATABASE_URL', 'dev · prod', 'Neon', 'scellée'],
          ['STRIPE_SECRET_KEY', 'prod', 'Toi, aujourd’hui', 'scellée'],
          ['PUBLIC_UMAMI_ID', 'dev · prod', 'Pono', 'visible'],
          ['RESEND_API_KEY', 'prod', '—', 'demandée'],
        ];
        return `${card({ title: 'Variables et secrets', ic: 'key', cls: 'flush', side: `<button class="btn primary sm" data-toast="Seule une personne peut saisir une valeur">Ajouter</button>`, body: `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Portée</th><th>Origine</th><th>Valeur</th><th></th></tr></thead><tbody>
          ${VARS.map(([n, s, o, v]) => `<tr><td class="mono" style="color:var(--ink)">${n}</td><td><span class="tag">${s}</span></td><td class="mute">${o}</td>
            <td>${v === 'scellée' ? st(['healthy', 'Scellée']) : v === 'demandée' ? st(['warning', 'Demandée par l’agent']) : '<span class="mono">a1b2-c3d4</span>'}</td>
            <td style="text-align:right">${v === 'demandée' ? '<button class="btn primary sm" data-toast="Valeur enregistrée et scellée">Renseigner</button>' : '<button class="btn ghost sm" data-toast="Nouvelle valeur demandée">Remplacer</button>'}</td></tr>`).join('')}
          </tbody></table></div>`, foot: '<span style="padding:0 18px 12px;display:block">L’agent voit les noms, jamais les valeurs. Il demande une valeur avec request_variable.</span>' })}`;
      },
      versions: () => `${card({ title: 'Historique', ic: 'rocket', side: '', body: `<ul class="timeline">
        ${[
          ['10:42', 'healthy', 'Poussé vers dev', '3 fichiers · c47d2a9 · par Claude Code', 'dev'],
          ['10:31', 'failing', 'Poussée refusée', 'secret trouvé dans src/pay.ts:14', 'dev'],
          ['Hier', 'healthy', 'Preview reconstruite', 'b81e04d · 41 s', 'dev'],
          ['8 nov.', 'active', 'Projet adopté', 'pono.yaml proposé puis accepté', '—'],
        ].map(([t, s, w, d, b]) => `<li><span class="mono mute">${t}</span><span class="dot" style="--dot:var(--${s})"></span><span class="what"><b>${w}</b><p>${d}</p></span><span class="tag">${b}</span></li>`).join('')}
      </ul>`, foot: 'Aucune mise en ligne en production pour l’instant' })}`,
    };
    const show = (k) => {
      $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
      $('#tab').innerHTML = TABS[k]();
      paint($('#tab'));
      grow();
      history.replaceState(null, '', `#${k}`);
    };
    $('#tabs').onclick = (e) => e.target.dataset.tab && show(e.target.dataset.tab);
    $('#goDev').onclick = () => show('dev');
    $('#propose').onclick = () => toast('Proposition envoyée : PR dev → main, en attente de ton accord');
    show(TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'apercu');
  }

  /* ═════════════ Serveurs ═════════════ */
  function servers(page) {
    page.innerHTML = `
      ${head('Serveurs', 'Un serveur par projet lancé, où ton agent écrit le code et où tourne la preview. Ils se mettent en veille seuls.', '<a class="btn primary" href="projets.html"><i data-icon="plus"></i>Donner un serveur</a>')}
      ${verdict('healthy', 'Dans les limites', 'Il te reste un emplacement sur trois.', 'Ce mois-ci : 308 heures, environ 14,20 € sur ton portefeuille Agent37.')}
      <div class="card" style="margin-bottom:14px">${stats([['2/3', 'Emplacements'], ['308', 'Heures ce mois', 'h'], ['1', 'En veille'], ['14,20', 'Coût estimé', '€']], true)}</div>
      <article class="card flush"><div class="table-wrap"><table>
        <thead><tr><th>Projet</th><th>État</th><th>Agent</th><th style="width:22%">Heures ce mois</th><th>Depuis</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></article>
      <div class="grid two" style="margin-top:14px">
        ${card({ title: 'Limite du plan', ic: 'shield', side: '', body: `<p class="soft" style="font-size:13px;margin-bottom:12px">Combien de serveurs ton équipe peut garder en même temps.</p>${segmented('limit', [['1', '1'], ['3', '3'], ['5', '5'], ['10', '10']], '3')}`, foot: 'Plan Équipe : jusqu’à 5 serveurs' })}
        ${card({ title: 'Mise en veille', ic: 'server', side: '', body: `<div class="row-top" style="align-items:center"><span class="name" style="font-weight:500">Endormir après 30 min sans activité</span><button class="switch on" id="sleep" aria-label="Mise en veille automatique"></button></div>
          <p class="mute" style="font-size:12.5px;margin-top:8px">Un serveur en veille garde ses fichiers ; il se réveille en une vingtaine de secondes.</p>`, foot: 'Les heures en veille ne sont pas comptées' })}
      </div>`;
    const render = () => {
      $('#rows').innerHTML = SERVERS.map(
        (s, i) => `<tr><td><span class="name">${s.project}</span><span class="mono">${s.id}</span></td>
          <td>${st(s.on ? ['healthy', 'Actif'] : ['idle', 'En veille'], s.on)}</td><td>${s.agent}</td>
          <td><span class="fig">${s.hours} h</span>${bar((s.hours / 240) * 100, s.hours / 240 > 0.8 ? 'warning' : '', 0, true)}</td>
          <td class="mute">${s.since}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn ghost sm" data-i="${i}" data-act="toggle">${s.on ? 'Mettre en veille' : 'Réveiller'}</button>
          <button class="btn danger sm" data-i="${i}" data-act="release">Rendre</button></td></tr>`,
      ).join('') + `<tr><td colspan="6" class="mute">Emplacement libre · donne-le à un projet depuis sa fiche.</td></tr>`;
      grow();
    };
    render();
    $('#rows').onclick = (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const s = SERVERS[b.dataset.i];
      if (b.dataset.act === 'toggle') {
        s.on = !s.on;
        toast(s.on ? `${s.project} se réveille` : `${s.project} est en veille`);
        render();
      } else
        dialog(
          `<div class="dialog-body"><h3>Rendre le serveur de ${s.project} ?</h3><p class="soft" style="margin-top:8px">Le serveur est supprimé chez Agent37. Le code poussé vers GitHub reste ; ce qui n'a pas été poussé est perdu.</p>
           <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn ghost sm" data-close>Annuler</button><button class="btn primary sm" data-close data-toast="Serveur rendu (maquette : rien n’est supprimé)">Rendre</button></div></div>`,
        );
    };
    $('#sleep').onclick = (e) => e.currentTarget.classList.toggle('on');
    onSegment('limit', (v) => toast(`Limite fixée à ${v} serveur${v > 1 ? 's' : ''}`));
  }

  /* ═════════════ Mises en ligne ═════════════ */
  function releases(page) {
    const PENDING = [
      { project: 'atelier-api', by: 'Codex', when: 'hier, 18:20', pr: '#31', title: 'Ajoute la pagination aux devis', files: 7, plus: 214, minus: 38 },
      { project: 'carnet', by: 'Claude Code', when: 'il y a 6 j', pr: '#12', title: 'Textes en anglais et choix de langue', files: 23, plus: 410, minus: 96 },
    ];
    page.innerHTML = `
      ${head('Mises en ligne', 'Ce qui part en production, sous la règle que tu as choisie pour chaque projet. Tes agents proposent ; selon la règle, tu décides.')}
      ${verdict('warning', 'Ta décision', `${PENDING.length} mises en ligne attendent ton accord.`, 'Les contrôles sont passés pour les deux. Rien ne part tant que tu n’as pas approuvé.')}
      <div class="grid two" id="pending">${PENDING.map(
        (r, i) => `<article class="card" data-p="${i}"><header class="card-head"><span class="card-icon"><i data-icon="rocket"></i></span><h2>${r.project} · ${r.title}</h2><span class="tag">PR ${r.pr}</span></header>
          <dl class="kv"><dt>Proposée par</dt><dd>${r.by}, ${r.when}</dd><dt>Changements</dt><dd class="fig">${r.files} fichiers · <span style="color:var(--healthy)">+${r.plus}</span> <span style="color:var(--failing)">−${r.minus}</span></dd>
          <dt>Contrôles</dt><dd>${st(['healthy', 'CI'])} &nbsp; ${st(['healthy', 'Secrets'])} &nbsp; ${st(['healthy', 'Preview'])}</dd></dl>
          <footer class="card-foot" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>dev → main</span><span style="display:flex;gap:8px"><button class="btn ghost sm" data-act="no">Refuser</button><button class="btn primary sm" data-act="yes">Approuver</button></span></footer></article>`,
      ).join('')}</div>
      <div class="grid two" style="margin-top:14px">
        ${card({ title: 'Règle par projet', ic: 'shield', cls: 'flush', side: '', body: `<div class="table-wrap"><table><tbody>${PROJECTS.slice(0, 6).map((p, i) => `<tr><td><span class="name">${p.name}</span></td><td style="text-align:right">${segmented(`mode${i}`, [['demander', 'Demander'], ['auto', 'Auto'], ['libre', 'Libre']], p.mode)}</td></tr>`).join('')}</tbody></table></div>`, foot: '<span style="padding:0 18px 12px;display:block"><b>Demander</b> : tu approuves · <b>Auto</b> : une PR verte part seule · <b>Libre</b> : l’agent fusionne</span>' })}
        ${card({ title: 'Historique', ic: 'list', side: '', body: `<ul class="timeline">${[
          ['Hier', 'healthy', 'kya-energy', 'Mise en ligne automatique · PR #88 · 1 min 12 s'],
          ['10 nov.', 'warning', 'docs-kya', 'Retour arrière automatique · santé en échec'],
          ['9 nov.', 'healthy', 'docs-kya', 'Approuvée par Jean-Claude · PR #40'],
          ['8 nov.', 'failing', 'vitrine-2026', 'Refusée · build en échec'],
          ['6 nov.', 'healthy', 'pono-devloop-probe', 'Mise en ligne libre par Claude Code'],
        ].map(([t, s, p, d]) => `<li><span class="mono mute">${t}</span><span class="dot" style="--dot:var(--${s})"></span><span class="what"><b>${p}</b><p>${d}</p></span><span></span></li>`).join('')}</ul>`, foot: 'Chaque décision est écrite dans le journal' })}
      </div>`;
    $('#pending').onclick = (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const c = b.closest('[data-p]');
      const r = PENDING[c.dataset.p];
      const yes = b.dataset.act === 'yes';
      c.innerHTML = `<div class="verdict ${yes ? 'healthy' : ''}" style="margin:0"><div><span class="label">${yes ? 'Approuvée' : 'Refusée'}</span><h3>${r.project} · ${r.title}</h3><p>${yes ? 'La fusion vers main est lancée ; la production suit dans une minute.' : 'La PR reste ouverte ; l’agent est prévenu.'}</p></div></div>`;
      toast(yes ? `${r.project} part en production` : `${r.project} : proposition refusée`);
    };
    PROJECTS.slice(0, 6).forEach((p, i) => onSegment(`mode${i}`, (v) => toast(`${p.name} : règle « ${v} »`)));
  }

  /* ═════════════ Connexions ═════════════ */
  function connections(page) {
    page.innerHTML = `
      ${head('Connexions', 'Tes propres comptes. Pono s’en sert avec tes clés, les garde scellées et lit ce que chacun consomme.')}
      ${verdict('warning', 'Proche de la limite', 'GitHub Actions et Netlify ont passé 80 % de leur quota.', 'Il reste 120 minutes d’Actions et 50 minutes de build ce mois-ci.')}
      <div class="grid">${PROVIDERS.map((p) => {
        const pct = p.account ? Math.round((p.used + (p.reserved ?? 0)) * 100) : 0;
        return `<article class="card provider"><header class="card-head" style="margin-bottom:0"><span class="logo">${p.id}</span><div style="flex:1;min-width:0"><h2>${p.name}</h2><p>${p.role}</p></div>
          ${p.account ? st(['healthy', 'Connecté']) : st(['idle', 'Non connecté'])}</header>
          ${p.account ? `<div style="margin-top:14px"><div class="row-top"><span class="sub" style="flex:1">${p.unit}</span><span class="fig">${pct} %</span></div>${bar(p.used * 100, pct >= 80 ? 'warning' : '', (p.reserved ?? 0) * 100, true)}<p style="margin-top:6px">${p.left}</p></div>` : `<p style="margin-top:14px">Pas encore relié. Utile pour ${p.role.toLowerCase()}.</p>`}
          <div class="bottom"><span class="mono mute">${p.account ?? '—'}</span>${p.account ? `<button class="btn ghost sm" data-toast="${p.name} : clé vérifiée">Vérifier</button>` : `<button class="btn primary sm" data-connect="${p.name}">Connecter</button>`}</div></article>`;
      }).join('')}</div>
      <p class="note"><span class="tag">scellé</span>Les clés sont chiffrées au repos et ne sont jamais montrées, ni à toi ni à l’agent, après leur saisie.</p>`;
    page.addEventListener('click', (e) => {
      const b = e.target.closest('[data-connect]');
      if (!b) return;
      dialog(`<div class="dialog-body"><h3>Connecter ${b.dataset.connect}</h3><p class="soft" style="margin-top:6px">Tu seras envoyé chez ${b.dataset.connect} pour autoriser Pono, ou tu colles une clé d’API créée pour lui.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn ghost sm" data-close>Annuler</button><button class="btn primary sm" data-close data-toast="Maquette : la connexion se ferait ici">Continuer</button></div></div>`);
    });
  }

  /* ═════════════ Catalogue ═════════════ */
  function catalog(page) {
    page.innerHTML = `
      ${head('Catalogue', 'Les modèles pour démarrer un projet et les skills que suivent tes agents. Ton niveau choisit ce qui est montré en premier.', segmented('level', [['all', 'Tout'], ['novice', 'Débutant'], ['expert', 'Expert']], 'all'))}
      <div class="tabs" id="tabs"><button data-tab="modeles">Modèles</button><button data-tab="skills">Skills</button><button data-tab="miennes">Les miennes</button></div>
      <div id="tab"></div>`;
    let level = 'all';
    let tab = location.hash.slice(1) === 'skills' ? 'skills' : 'modeles';
    const keep = (x) => level === 'all' || x.level === level;
    const render = () => {
      $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      let html;
      if (tab === 'modeles')
        html = `<div class="grid">${TEMPLATES.filter(keep).map((t) => `<article class="card"><header class="card-head"><span class="card-icon"><i data-icon="folder"></i></span><h2>${t.name}</h2><span class="tag">${t.level === 'novice' ? 'débutant' : 'expert'}</span></header>
          <p class="soft" style="font-size:13px">${t.text}</p><footer class="card-foot" style="display:flex;justify-content:space-between;align-items:center"><span class="mono">${t.stack}</span><button class="btn primary sm" data-toast="Dépôt créé depuis « ${t.name} » (maquette)">Utiliser</button></footer></article>`).join('')}</div>`;
      else if (tab === 'skills')
        html = `<article class="card flush"><div class="table-wrap"><table><thead><tr><th>Skill</th><th>Famille</th><th>Niveau</th><th>Ce qu’elle dit à l’agent</th><th></th></tr></thead><tbody>
          ${SKILLS.filter(keep).map((s) => `<tr><td class="mono" style="color:var(--ink)">${s.name}</td><td><span class="tag">${s.family}</span></td><td class="mute">${s.level === 'novice' ? 'débutant' : 'expert'}</td><td class="soft">${s.text}</td><td style="text-align:right"><button class="btn ghost sm" data-toast="Ajoutée à lectio">Ajouter</button></td></tr>`).join('')}
          </tbody></table></div></article>`;
      else
        html = `${card({ title: 'Créées par toi ou tes agents', ic: 'book', side: `<button class="btn primary sm" data-toast="Ton agent peut aussi le faire : create_skill">Nouvelle skill</button>`, body: `<ul class="rows"><li><div class="row-top"><span class="name mono" style="font-weight:500">textes-fr-en</span>${st(['warning', 'Proposée à l’équipe'])}</div><div class="soft" style="font-size:13px">Créée par Claude Code sur carnet, le 10 nov.</div></li>
          <li><div class="row-top"><span class="name mono" style="font-weight:500">Modèle « API Hono »</span>${st(['healthy', 'Partagé'])}</div><div class="soft" style="font-size:13px">Enregistré depuis atelier-api avec save_as_template.</div></li></ul>`, foot: 'Un administrateur relit avant que tout le monde y ait accès' })}`;
      $('#tab').innerHTML = html;
      paint($('#tab'));
    };
    $('#tabs').onclick = (e) => {
      if (!e.target.dataset.tab) return;
      tab = e.target.dataset.tab;
      history.replaceState(null, '', `#${tab}`);
      render();
    };
    onSegment('level', (v) => {
      level = v;
      render();
    });
    render();
  }

  /* ═════════════ Agents ═════════════ */
  function agents(page) {
    page.innerHTML = `
      ${head('Agents', 'Claude Code, Codex ou tout client MCP se relient à Pono par un jeton à toi, ou par une connexion OAuth.', '<button class="btn primary" id="newToken"><i data-icon="key"></i>Créer un jeton</button>')}
      ${verdict('healthy', 'Relié', 'Claude Code a parlé à Pono il y a 4 minutes.', 'Sur lectio : dev_status, puis push_changes.')}
      <article class="card flush" style="margin-bottom:14px"><div class="table-wrap"><table><thead><tr><th>Jeton</th><th>Portée</th><th>Créé</th><th>Dernière utilisation</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></article>
      <div class="grid two">
        ${card({ title: 'Brancher Claude Code', ic: 'bot', side: `<button class="btn ghost sm" data-copy="cc"><i data-icon="copy"></i>Copier</button>`, body: `<p class="soft" style="font-size:13px">Le plugin Pono : le contexte du projet au début de chaque session, la ligne de statut et les commandes /pono.</p>
          <pre class="code" id="cc">export PONO_URL=https://pono.dev
export PONO_TOKEN=pono_••••••••
claude plugin install ./integrations/claude-code</pre>`, foot: 'Ou par OAuth : ajoute https://pono.dev/mcp comme serveur MCP' })}
        ${card({ title: 'Brancher Codex', ic: 'code', side: `<button class="btn ghost sm" data-copy="cx"><i data-icon="copy"></i>Copier</button>`, body: `<p class="soft" style="font-size:13px">Dans ~/.codex/config.toml, et AGENTS.md à la racine du dépôt.</p>
          <pre class="code" id="cx">[mcp_servers.pono]
url = "https://pono.dev/mcp"
bearer_token_env_var = "PONO_TOKEN"</pre>`, foot: 'Codex n’a pas encore de ligne de statut : AGENTS.md la remplace' })}
      </div>`;
    const render = () =>
      ($('#rows').innerHTML = TOKENS.map(
        (t, i) => `<tr><td><span class="name">${t.name}</span><span class="mono">pono_••••${(i + 3) * 1111}</span></td><td><span class="tag">${t.scope}</span></td><td class="mute">${t.created}</td>
          <td>${st(i === 0 ? ['healthy', t.used] : i === 2 ? ['warning', t.used] : ['idle', t.used], i === 0)}</td>
          <td style="text-align:right"><button class="btn danger sm" data-revoke="${i}">Révoquer</button></td></tr>`,
      ).join(''));
    render();
    $('#rows').onclick = (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      const [t] = TOKENS.splice(Number(b.dataset.revoke), 1);
      render();
      toast(`« ${t.name} » révoqué`);
    };
    page.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      navigator.clipboard?.writeText($(`#${b.dataset.copy}`).textContent).catch(() => {});
      toast('Copié');
    });
    $('#newToken').onclick = () =>
      dialog(
        `<div class="dialog-body"><h3>Nouveau jeton</h3>
          <label class="label" style="display:block;margin-top:14px">Nom</label><label class="field" style="margin-top:6px"><input id="tn" value="Claude Code · nouveau poste"/></label>
          <label class="label" style="display:block;margin-top:14px">Portée</label><div style="margin-top:6px">${segmented('scope', [['lecture', 'Lecture'], ['écriture', 'Écriture']], 'écriture')}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px"><button class="btn ghost sm" data-close>Annuler</button><button class="btn primary sm" id="mk">Créer</button></div></div>`,
        (d) => {
          let scope = 'écriture';
          onSegment('scope', (v) => (scope = v));
          $('#mk', d).onclick = () => {
            TOKENS.unshift({ name: $('#tn', d).value || 'Sans nom', scope, created: "aujourd'hui", used: 'jamais' });
            render();
            d.innerHTML = `<div class="dialog-body"><h3>Jeton créé</h3><p class="soft" style="margin-top:6px">Il ne sera plus jamais affiché. Dans la vraie console, il apparaîtrait ici une seule fois.</p>
              <pre class="code">pono_exemple_de_maquette</pre><div style="text-align:right;margin-top:16px"><button class="btn primary sm" data-close>J’ai copié</button></div></div>`;
          };
        },
      );
  }

  /* ═════════════ Journal ═════════════ */
  function journal(page) {
    page.innerHTML = `
      ${head('Journal', 'Tout ce qui s’est passé, par qui et par quel canal : la console, un agent par MCP, ou Pono lui-même.', '<button class="btn ghost" data-toast="Export CSV prêt"><i data-icon="download"></i>Exporter</button>')}
      <div class="toolbar"><label class="field"><i data-icon="search"></i><input id="q" placeholder="Projet, action, personne…"/></label>
        ${segmented('channel', [['all', 'Tout'], ['Console', 'Console'], ['MCP', 'MCP'], ['Agent', 'Agent'], ['Système', 'Système']], 'all')}</div>
      <div id="days"></div>`;
    let channel = 'all';
    const render = () => {
      const q = $('#q').value.trim().toLowerCase();
      const list = EVENTS.filter((e) => (channel === 'all' || e.channel === channel) && `${e.project} ${e.what} ${e.actor} ${e.detail}`.toLowerCase().includes(q));
      const days = [...new Set(list.map((e) => e.day))];
      $('#days').innerHTML = days.length
        ? days
            .map((d) => `<div class="label" style="margin:16px 0 8px">${d}</div><article class="card" style="padding:4px 18px"><ul class="timeline">${list
              .filter((e) => e.day === d)
              .map((e) => `<li><span class="mono mute">${e.time}</span><span class="dot" style="--dot:var(--${e.state})"></span><span class="what"><b>${e.actor}</b> ${e.what} · <span class="mono">${e.project}</span><p>${e.detail}</p></span><span class="tag">${e.channel}</span></li>`)
              .join('')}</ul></article>`)
            .join('')
        : '<div class="card empty">Rien dans le journal pour ce filtre.</div>';
    };
    render();
    $('#q').oninput = render;
    onSegment('channel', (v) => {
      channel = v;
      render();
    });
  }

  /* ═════════════ Démarrage ═════════════ */
  shell();
  const page = $('#page');
  ({ overview, projects, project, servers, releases, connections, catalog, agents, journal })[current](page);
  paint(page);
  grow();
})();
