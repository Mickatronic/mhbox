// Génère une image de carte abstraite, 100% déterministe à partir d'un ID.
// Host et joueurs génèrent chacun le même visuel localement à partir du même ID :
// on n'échange jamais d'image sur le réseau, juste un nombre.
(function (global) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PALETTES = [
    ['#ff2d78', '#ffd23f', '#3a0ca3'],
    ['#3a86ff', '#06d6a0', '#1b0f3f'],
    ['#ff9f1c', '#2ec4b6', '#011627'],
    ['#e63946', '#f1faee', '#457b9d'],
    ['#7209b7', '#f72585', '#4361ee'],
    ['#ffbe0b', '#fb5607', '#8338ec']
  ];

  function cardSVG(id, size) {
    size = size || 220;
    const rnd = mulberry32(id * 2654435761 % 2147483647);
    const palette = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const bg = palette[2];
    let shapes = '';

    // Fond dégradé
    const gid = 'g' + id;
    shapes += `<defs><radialGradient id="${gid}" cx="${30 + rnd()*40}%" cy="${20 + rnd()*40}%" r="80%">
      <stop offset="0%" stop-color="${palette[0]}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="1"/>
    </radialGradient></defs>`;
    shapes += `<rect width="${size}" height="${size}" fill="${bg}"/>`;
    shapes += `<rect width="${size}" height="${size}" fill="url(#${gid})"/>`;

    // Formes flottantes (blobs / cercles / triangles)
    const shapeCount = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < shapeCount; i++) {
      const cx = rnd() * size, cy = rnd() * size;
      const r = 14 + rnd() * (size * 0.22);
      const color = palette[Math.floor(rnd() * palette.length)];
      const opacity = (0.35 + rnd() * 0.5).toFixed(2);
      const kind = rnd();
      if (kind < 0.4) {
        shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="${opacity}"/>`;
      } else if (kind < 0.75) {
        const w = r * 1.6, h = r * 1.1;
        const rot = Math.floor(rnd() * 360);
        shapes += `<rect x="${(cx - w/2).toFixed(1)}" y="${(cy - h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(r*0.4).toFixed(1)}" fill="${color}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
      } else {
        const pts = [];
        for (let k = 0; k < 3; k++) {
          const a = rnd() * Math.PI * 2;
          pts.push(`${(cx + Math.cos(a)*r).toFixed(1)},${(cy + Math.sin(a)*r).toFixed(1)}`);
        }
        shapes += `<polygon points="${pts.join(' ')}" fill="${color}" opacity="${opacity}"/>`;
      }
    }

    // Un "soleil/lune" central pour rendre la lecture évocatrice
    if (rnd() > 0.5) {
      const cx = size * (0.3 + rnd() * 0.4), cy = size * (0.25 + rnd() * 0.3);
      shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(size*0.09).toFixed(1)}" fill="${palette[1]}" opacity="0.85"/>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="border-radius:14px;display:block">${shapes}</svg>`;
  }

  global.PartyCards = { cardSVG };
})(window);
