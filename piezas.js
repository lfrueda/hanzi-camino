/* ============================================================================================================
   piezas.js — el motor de piezas 3D de 汉字 · Camino

   Qué hace: dibuja encima de la pantalla (en un <canvas> transparente) los objetos 3D de la lección y los mueve.
   Cada objeto es una PIEZA: un archivo .glb de la carpeta modelos/ más sus números en modelos/piezas.json.
   Cambiar una pieza = reemplazar su .glb. Aquí no hay ningún modelo escrito en código (solo un «sustituto»,
   una caja lisa, por si el archivo falta o está dañado: la app nunca se rompe por un modelo).

   Cómo se usa (index.html lo carga solo al entrar a una lección, con import()):
       const motor = await creaMotor(lienzo);      // truena si el teléfono no puede con 3D → la app usa el sello plano
       await motor.carga();
       const k = motor.elige('sello');             // qué cara del bloque toca
       img.src = motor.huella('sello', k);         // la imagen de la huella de esa cara
       await motor.sella({ rect, cara: k, alGolpe });

   Medidas: la cámara ve el lienzo de frente y 1 unidad = 1 píxel de pantalla. Las medidas de piezas.json están
   en píxeles de una carta de 300 de ancho; todo se multiplica por (ancho real de la carta / 300).
   ============================================================================================================ */
import * as THREE from './tres/three.module.min.js';
import { GLTFLoader } from './tres/GLTFLoader.js';
import { RoomEnvironment } from './tres/RoomEnvironment.js';

const DIST = 1400;                                  // a qué distancia está la cámara (la misma perspectiva de las maquetas)
const rad = g => g * Math.PI / 180;
const sale = t => 1 - Math.pow(1 - t, 3), entra = t => t * t * t, parejo = t => t,
      ambos = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* Un movimiento es una lista de momentos (t de 0 a 1); entre uno y otro los valores se van mezclando con la curva «e»
   del momento de salida. Devuelve los valores mezclados para el instante u. */
function mezcla(P, u) {
  let i = 0; while (i < P.length - 2 && u > P[i + 1].t) i++;
  const a = P[i], b = P[i + 1], q = a.e(Math.min(Math.max((u - a.t) / (b.t - a.t), 0), 1)), m = {};
  for (const c in a) if (c !== 't' && c !== 'e') m[c] = a[c] + (b[c] - a[c]) * q;
  return m;
}

/* Duración y momento del golpe de cada movimiento (el golpe es cuando la pieza toca el papel: ahí aparece la huella) */
export const TIEMPOS = {
  rueda:      { dur: 1250, golpe: .57 },   // barra: llega flotando, rueda sobre su eje, cae
  punta:      { dur: 1250, golpe: .57 },   // sello parado: igual, pero gira como trompo y llega más acostado para verse de lado
  caricatura: { dur: 1500, golpe: .52 },   // sello chico: llega girando, toma vuelo, cae de golpe, se aplasta y rebota
};

/* base = carpeta de los modelos · reloj y foto son solo para las herramientas: «reloj» mueve con un reloj normal en vez de los cuadros del
   navegador (sin ventana esos no avanzan) y «foto» deja copiar lo dibujado (lienzo.toDataURL) */
export async function creaMotor(lienzo, { base = 'modelos/', reloj = false, foto = false, ligero = false } = {}) {
  /* ---------- la escena ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true, preserveDrawingBuffer: foto });   // sin WebGL esto truena: quien llama cae al sello plano
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ligero ? 1.5 : 2));   // ligero (?3d=ligero): ~44 % menos píxeles que dibujar en el iPhone
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(30, 1, 200, 5000); camara.position.set(0, 0, DIST);
  // luz: un cuarto suave alrededor (da los reflejos del pulido) + un foco arriba a la izquierda que hace la sombra
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; pmrem.dispose();
  const foco = new THREE.DirectionalLight(0xffffff, 1.3); foco.position.set(-320, 520, 900); foco.castShadow = true;
  foco.shadow.mapSize.set(1024, 1024); foco.shadow.radius = 6; foco.shadow.bias = -.0005;
  Object.assign(foco.shadow.camera, { left: -700, right: 700, top: 900, bottom: -900, near: 100, far: 3000 });
  escena.add(foco);
  // el «piso»: un rectángulo invisible del tamaño de la carta que solo recibe la sombra de la pieza
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: .38 }));
  piso.receiveShadow = true; piso.visible = false; escena.add(piso);

  let W = 0, H = 0;
  function mide() {                                  // el lienzo puede cambiar de tamaño (girar el teléfono): la cámara se reajusta sola
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w; H = h; renderer.setSize(w, h, false);
    camara.aspect = w / h; camara.fov = 2 * Math.atan(h / 2 / DIST) * 180 / Math.PI; camara.updateProjectionMatrix();
  }
  /* Dibuja la escena. Si no queda nada a la vista, esconde el lienzo: ocupa toda la pantalla y, aunque esté vacío, el iPhone lo tenía que
     combinar con la carta en cada cuadro de su deslizamiento. Con visibility (no display) sigue midiendo lo mismo y se puede dibujar escondido. */
  function dibuja() {
    renderer.render(escena, camara);
    const algo = escena.children.some(o => o.visible && !o.isLight);
    if (lienzo.style && (lienzo.style.visibility === 'hidden') === algo) lienzo.style.visibility = algo ? '' : 'hidden';
  }
  const ponPiso = r => { piso.visible = true; piso.scale.set(r.w, r.h, 1); piso.position.set(r.x + r.w / 2 - W / 2, H / 2 - r.y - r.h / 2, 0); };

  /* ---------- las piezas ----------
     Cada pieza son tres niveles, uno dentro de otro:
       pivote  → dónde está, su ángulo y su inclinación
       trompo  → el giro sobre su propio eje
       orienta → cómo viene el modelo: giros de 90° (piezas.json «gira»), escala para medir «tam» y centrado */
  const motor = { conf: null, avisos: [], roto: false, TIEMPOS };
  const piezas = {};
  const cargador = new GLTFLoader();
  const lee = buf => new Promise((ok, mal) => cargador.parse(buf, '', g => ok(g.scene), mal));
  function sustituto(c) {                            // caja lisa con las medidas de la pieza provisional
    const s = c.sustituto || {}, [w, h, d] = s.medidas || [80, 80, 80];
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: s.color || '#444', roughness: .6 }));
  }
  function encaja(p) {
    const { pivote, trompo, orienta } = p, c = p.conf;
    pivote.position.set(0, 0, 0); pivote.rotation.set(0, 0, 0); pivote.scale.setScalar(1); trompo.rotation.set(0, 0, 0); trompo.scale.setScalar(1);
    orienta.position.set(0, 0, 0); orienta.scale.setScalar(1); orienta.quaternion.identity();
    const [gx, gy, gz] = c.gira || [0, 0, 0];
    orienta.rotation.set(rad(gx), rad(gy), rad(gz));
    escena.updateMatrixWorld(true);
    let caja = new THREE.Box3().setFromObject(orienta), t = caja.getSize(new THREE.Vector3());
    orienta.scale.setScalar((c.tam || 100) / Math.max(t.x, t.y, t.z, 1e-6)); escena.updateMatrixWorld(true);
    caja = new THREE.Box3().setFromObject(orienta); t = caja.getSize(new THREE.Vector3());
    orienta.position.sub(caja.getCenter(new THREE.Vector3()));
    p.dim = { w: t.x, h: t.y, d: t.z };              // ancho, alto y fondo (hacia la carta) ya acomodada
  }
  function monta(nombre, c, obj, esSustituto) {
    let p = piezas[nombre];
    if (!p) {
      p = piezas[nombre] = { pivote: new THREE.Group(), trompo: new THREE.Group(), orienta: new THREE.Group() };
      p.pivote.rotation.order = 'ZXY'; p.pivote.add(p.trompo); p.trompo.add(p.orienta); p.pivote.visible = false; escena.add(p.pivote);
    }
    if (p.modelo) p.orienta.remove(p.modelo);
    p.conf = c; p.modelo = obj; p.esSustituto = !!esSustituto; p.orienta.add(obj);
    let tri = 0; obj.traverse(o => { if (o.isMesh) { o.castShadow = true; const g = o.geometry; tri += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    p.triangulos = Math.round(tri);
    encaja(p);
    return p;
  }
  /* Baja piezas.json y todos los modelos. Si un modelo falla, pone su sustituto y lo anota en motor.avisos */
  motor.carga = async () => {
    const conf = motor.conf = await (await fetch(base + 'piezas.json')).json();
    await Promise.all(Object.entries(conf.piezas).map(async ([n, c]) => {
      try {
        const r = await fetch(base + c.archivo); if (!r.ok) throw new Error('no está el archivo (' + r.status + ')');
        monta(n, c, await lee(await r.arrayBuffer()), false);
      } catch (e) { motor.avisos.push(`${n}: no se pudo cargar ${c.archivo} — ${e && e.message || e}. Se usa una caja lisa.`); monta(n, c, sustituto(c), true); }
    }));
    // calentar: se dibuja una vez con todas las piezas a la vista (así el teléfono prepara de una vez cómo pintarlas) y enseguida otra vez vacío;
    // las dos van en el mismo instante, así que en pantalla no se alcanza a ver nada
    mide(); const ps = Object.values(piezas);
    ps.forEach(p => { p.pivote.visible = true; }); piso.visible = true; dibuja();      // el piso también: su sombra usa otro programa que si no se
    ps.forEach(p => { p.pivote.visible = false; }); piso.visible = false; dibuja();   // preparaba hasta el primer sello (el retraso al acertar)
    return motor;
  };
  /* Para el probador: cambia el modelo de una pieza por un .glb que el usuario soltó, o sus números */
  motor.cambia = async (nombre, buf) => monta(nombre, piezas[nombre].conf, await lee(buf), false);
  motor.ajusta = (nombre, cambios) => { const p = piezas[nombre]; Object.assign(p.conf, cambios); encaja(p); return p; };
  motor.pieza = nombre => piezas[nombre];

  /* ---------- correr un movimiento: dibuja solo mientras algo se mueve (no gasta batería en reposo) ---------- */
  const tic = reloj ? f => setTimeout(() => f(performance.now()), 16) : f => requestAnimationFrame(f);   // «reloj»: para capturas sin ventana
  // Solo corre UN movimiento a la vez. Antes, si empezaba otro mientras el bloque todavía se iba (tocar «Continuar» justo después del golpe),
  // los dos se pisaban: el primero, al acabar, escondía la pieza del segundo y se comía el «motor.prisa» que era para el otro.
  // acaba() lleva de una vez a su último cuadro lo que esté corriendo; lo llaman sella() y montaSobre() antes de empezar.
  const enCurso = new Set();
  function acaba() { for (const cierra of [...enCurso]) cierra(); }
  function corre(dur, cuadro) {
    return new Promise(fin => {
      let viva = true;
      const cierra = () => { if (!viva) return; viva = false; enCurso.delete(cierra); mide(); cuadro(1); dibuja(); fin(); };
      enCurso.add(cierra);
      // El primer cuadro (u = 0) se dibuja antes de echar a andar el reloj: en ese cuadro el teléfono sube las texturas y prepara el dibujo, y puede
      // tardar. Si el reloj ya corriera, al volver la animación habría avanzado sola y la pieza aparecería de golpe a medio camino.
      mide(); cuadro(0); dibuja();
      let va = 0, ultimo = null;      // va = cuánto lleva la animación, en su propio reloj (así se puede frenar o pausar sin que brinque)
      tic(function paso(ahora) {
        if (!viva) return;            // ya la terminó acaba()
        if (ultimo !== null) va += (ahora - ultimo) * (motor.velocidad ?? 1);      // motor.velocidad: 1 normal · .25 cámara lenta · 0 pausa (solo la usa repite.html)
        ultimo = ahora; const u = motor.prisa ? 1 : Math.min(Math.max(va / dur, 0), 1);      // motor.prisa: saltarse lo que falta (tocar la pantalla)
        mide(); cuadro(u); dibuja();
        if (u >= 1) { viva = false; enCurso.delete(cierra); motor.prisa = false; fin(); } else tic(paso);
      });
    });
  }

  /* ---------- el bloque de sellos ---------- */
  motor.elige = nombre => { const n = (piezas[nombre].conf.caras || [0]).length; return Math.floor(Math.random() * n); };
  motor.huella = (nombre, k = 0) => { const c = piezas[nombre].conf, cara = (c.caras || [])[k]; return cara && cara.huella ? base + cara.huella : null; };
  /* Dónde va la huella dentro de la carta, en píxeles de ESA carta (anchoCarta = su ancho real): para colocar la imagen en el HTML */
  motor.dondeHuella = (nombre, anchoCarta) => {
    const c = piezas[nombre].conf, e = anchoCarta / 300, h = c.huella, d = c.donde;
    return { left: (d.x - h.ancho / 2) * e, top: (d.y - h.alto / 2) * e, width: h.ancho * e, height: h.alto * e, angulo: d.angulo };
  };
  /* rect = la carta en píxeles del lienzo {x, y, w, h} · cara = cuál cara cae hacia el papel · alGolpe() = se llama cuando toca la carta */
  motor.sella = async ({ rect, cara = 0, alGolpe } = {}) => {
    const p = piezas.sello, c = p.conf, mov = c.movimiento === 'punta' ? 'punta' : 'rueda', { dur, golpe } = TIEMPOS[mov];
    acaba(); mide(); ponPiso(rect); motor.prisa = false;
    const e = rect.w / 300, cx = rect.x + c.donde.x * e, cy = rect.y + c.donde.y * e, ang = c.donde.angulo || 0;
    const V = 260 * e, suelo = p.dim.d / 2 * e, fuera = H * .6 + p.dim.h * e;      // V: a qué altura flota antes de caer · fuera: lo que sube para salirse de la pantalla
    const g1 = ((c.caras || [])[cara] || { giro: 720 }).giro, inclina = mov === 'rueda' ? -16 : -62, eje = mov === 'rueda' ? 'y' : 'z';
    const P = [ { t: 0,     x: -40 * e, y: fuera, z: V,          rz: 8,   rx: -30,     giro: -40, e: sale },
                { t: .12,   x: 0,       y: 0,     z: V,          rz: 0,   rx: inclina, giro: -10, e: ambos },   // llega flotando
                { t: .46,   x: 0,       y: 0,     z: V,          rz: 0,   rx: 0,       giro: g1,  e: entra },   // gira y se frena derecho
                { t: golpe, x: 0,       y: 0,     z: suelo,      rz: 0,   rx: 0,       giro: g1,  e: parejo },  // cae: golpe
                { t: .7,    x: 0,       y: 0,     z: suelo,      rz: 0,   rx: 0,       giro: g1,  e: entra },   // aprieta
                { t: .82,   x: 10 * e,  y: 30 * e, z: V,         rz: -3,  rx: -6,      giro: g1,  e: entra },   // se levanta
                { t: 1,     x: 60 * e,  y: fuera, z: V + 60 * e, rz: -10, rx: -20,     giro: g1,  e: parejo } ];// y se va por arriba
    let hecho = false; p.pivote.visible = true; p.pivote.scale.setScalar(e);
    await corre(dur, u => {
      const m = mezcla(P, u);
      p.pivote.position.set(cx - W / 2 + m.x, H / 2 - cy + m.y, m.z);
      p.pivote.rotation.set(rad(m.rx), 0, rad(-ang + m.rz));
      p.trompo.rotation.set(0, 0, 0); p.trompo.rotation[eje] = rad(m.giro);
      if (!hecho && u >= golpe) { hecho = true; if (alGolpe) alGolpe(); }
      if (u >= 1) { p.pivote.visible = false; piso.visible = false; }
    });
  };

  /* ---------- el sello chico (final de la lección) ----------
     x, y = el punto del lienzo donde cae · escala = 1 es su tamaño de piezas.json · rect (opcional) = el papel que recibe la sombra */
  motor.sellaChico = async ({ x, y, escala = 1, rect, z = 0, alGolpe } = {}) => {      // z = a qué altura está lo que se sella (0 = la carta)
    const p = piezas.selloChico, { dur, golpe } = TIEMPOS.caricatura, e = escala;
    mide(); ponPiso(rect || { x: 0, y: 0, w: W, h: H }); piso.position.z = z + .5;
    const suelo = p.dim.d / 2 * e;
    // x, y = corrimiento en pantalla · z = altura · rx = qué tan acostado va · rz = ladeo · giro = vueltas sobre su eje · ap = aplastado (1 = normal)
    const K = [ { t: 0,     x: 230,  y: -330, z: 220, rx: -78, rz: -34, giro: -260, ap: 1,    e: sale },
                { t: .22,   x: 22,   y: -34,  z: 150, rx: -60, rz: -8,  giro: 0,    ap: 1,    e: ambos },
                { t: .40,   x: 30,   y: -52,  z: 196, rx: -70, rz: -14, giro: 24,   ap: 1,    e: entra },
                { t: golpe, x: 0,    y: 0,    z: 0,   rx: 0,   rz: 0,   giro: 360,  ap: 1,    e: sale },
                { t: .57,   x: 0,    y: 0,    z: 0,   rx: 0,   rz: 0,   giro: 360,  ap: .76,  e: ambos },
                { t: .65,   x: 0,    y: 0,    z: 0,   rx: 0,   rz: 0,   giro: 360,  ap: 1.09, e: ambos },
                { t: .71,   x: 0,    y: 0,    z: 0,   rx: 0,   rz: 0,   giro: 360,  ap: 1,    e: sale },
                { t: .84,   x: -12,  y: -46,  z: 176, rx: -34, rz: 16,  giro: 540,  ap: 1,    e: entra },
                { t: 1,     x: -270, y: -440, z: 270, rx: -82, rz: 64,  giro: 1180, ap: 1,    e: parejo } ];
    let hecho = false; p.pivote.visible = true; p.pivote.scale.setScalar(e);
    await corre(dur, u => {
      const m = mezcla(K, u), an = 1 / Math.sqrt(m.ap);
      p.pivote.position.set(x - W / 2 + m.x * e, H / 2 - y - m.y * e, z + m.z * e + suelo * m.ap);   // la base queda sobre el papel aunque se aplaste
      p.pivote.rotation.set(rad(m.rx), 0, rad(m.rz));
      p.trompo.rotation.set(0, 0, rad(m.giro)); p.trompo.scale.set(an, an, m.ap);
      if (!hecho && u >= golpe) { hecho = true; if (alGolpe) alGolpe(); }
      if (u >= 1) { p.pivote.visible = false; piso.visible = false; piso.position.z = 0; }
    });
  };

  /* ---------- el sobre: entra, se desenreda el cordón, gira la solapa, sale el mazo, el sobre se cae y el mazo crece hasta ser la carta ----------
     El .glb del sobre debe traer una parte llamada «solapa» cuyo origen (pivote) esté en el doblez: el motor la gira sobre su eje X.
     Opcionales: «cordon» (se va desenredando) y «rotulo» (un rectángulo donde la app pinta la lección).
     El mazo NO es parte del modelo: lo pone el motor (una caja de papel con la foto de la primera carta encima) entre la hoja de atrás y el frente.
       rect    = dónde queda la carta de verdad al final, en píxeles del lienzo
       textura = <canvas> con la foto de la primera carta (la toma la app) · rotulo = <canvas> con el letrero del sobre
     Al terminar deja el mazo dibujado exactamente sobre la carta: la app enseña la carta de verdad y llama a guardaSobre(). */
  let gSobre = null, mazo = null, gota = null;
  const SOBRE_MS = 5000, GUION = 7050;      // SOBRE_MS: lo que dura de verdad · GUION: la línea de tiempo en que están escritos los momentos de abajo
  /* Arma el sobre para una función (abrir o cerrar): pone el letrero, hace el mazo con la foto de la carta y calcula las medidas que usan los dos. */
  function montaSobre({ rect, textura, rotulo }) {
    const p = piezas.sobre; if (!p) return null;
    const c = p.conf, cm = c.mazo || {}, e = rect.w / 300;
    acaba(); mide(); motor.prisa = false;
    if (!gSobre) { gSobre = new THREE.Group(); gSobre.rotation.order = 'XYZ'; escena.add(gSobre); gSobre.add(p.pivote); }
    if (mazo) { gSobre.remove(mazo); mazo.geometry.dispose(); mazo.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
    // el mazo, en medidas del sobre: su ancho es fijo y su alto sigue la forma de la carta de verdad
    const aM = cm.ancho || 168, hM = aM * rect.h / rect.w, grueso = cm.grueso || 4, yM = p.dim.h / 2 - (cm.arriba || 14) - hM / 2, sube = cm.sube || 120;
    // a qué fondo va el mazo: a la mitad entre las partes «atras» y «frente» del modelo (o el número «z» de piezas.json, medido desde el centro del modelo)
    gSobre.position.set(0, 0, 0); gSobre.rotation.set(0, 0, 0); gSobre.scale.setScalar(1); p.pivote.position.set(0, 0, 0); p.pivote.rotation.set(0, 0, 0); p.pivote.scale.setScalar(1); gSobre.updateMatrixWorld(true);
    const fondoDe = n => { const o = p.modelo.getObjectByName(n); return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z : null; };
    const zA = fondoDe('atras'), zF = fondoDe('frente'), zM = cm.z !== undefined ? cm.z : zA !== null && zF !== null ? (zA + zF) / 2 : 0;
    const papel = new THREE.MeshBasicMaterial({ color: '#d9d6cd', toneMapped: false }), mapa = textura ? new THREE.CanvasTexture(textura) : null;
    if (mapa) { mapa.colorSpace = THREE.SRGBColorSpace; mapa.anisotropy = 4; }
    const cima = new THREE.MeshBasicMaterial({ map: mapa, color: mapa ? '#ffffff' : '#f6f5f1', toneMapped: false });   // sin luces: sus colores son los de la carta de verdad
    mazo = new THREE.Mesh(new THREE.BoxGeometry(aM, hM, grueso), [papel, papel, papel, papel, cima, papel]);
    gSobre.add(mazo);
    const solapa = p.modelo.getObjectByName('solapa'), cordon = p.modelo.getObjectByName('cordon'), letrero = p.modelo.getObjectByName('rotulo');
    if (letrero && letrero.isMesh && rotulo) { const t = new THREE.CanvasTexture(rotulo); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;   // flipY=false: así vienen las texturas de un .glb
      if (letrero.material.map) letrero.material.map.dispose(); letrero.material.map = t; letrero.material.transparent = true; letrero.material.opacity = 1; letrero.material.needsUpdate = true; }
    if (letrero) letrero.visible = !!rotulo;
    const nCordon = cordon && cordon.isMesh ? (cordon.geometry.index ? cordon.geometry.index.count : cordon.geometry.attributes.position.count) : 0;
    const abre = rad((c.solapa && c.solapa.abre) || -180), s1 = 1.2 * e, s2 = rect.w / aM;
    // cuánto tiene que bajar el sobre para soltar el mazo: lo que queda del mazo adentro + el largo de la solapa (abierta, queda parada detrás del mazo).
    // Hasta entonces cae derecho; si se inclinara antes, la solapa atravesaría el mazo y se vería encima de la carta.
    const lSolapa = solapa ? new THREE.Box3().setFromObject(solapa).getSize(new THREE.Vector3()).y : 0, libre = hM - sube + (cm.arriba || 14) + lSolapa;
    const cx = rect.x + rect.w / 2 - W / 2, cy = H / 2 - rect.y - rect.h / 2;                    // el centro de la carta de verdad
    p.pivote.visible = true; p.pivote.scale.setScalar(1); p.pivote.rotation.set(0, 0, 0); p.trompo.rotation.set(0, 0, 0); p.trompo.scale.setScalar(1);
    gSobre.visible = true; piso.visible = false;
    // la gota de sudor (un dibujo plano, no es parte del modelo): le sale al sobre cuando aterriza del salto
    if (!gota) { const f = new THREE.Shape(); f.moveTo(0, 11); f.bezierCurveTo(1.5, 6, 7, 1, 7, -4); f.absarc(0, -4, 7, 0, Math.PI, true); f.bezierCurveTo(-7, 1, -1.5, 6, 0, 11);
      gota = new THREE.Mesh(new THREE.ShapeGeometry(f, 16), new THREE.MeshBasicMaterial({ color: '#d7eef8', transparent: true, toneMapped: false, depthTest: false })); gota.renderOrder = 5; gSobre.add(gota); }
    gota.visible = false;
    const tr = (t, a, b, curva) => curva(Math.min(Math.max((t - a) / (b - a), 0), 1)), lerp = (a, b, k) => a + (b - a) * k;
    return { p, c, cm, e, aM, hM, grueso, yM, sube, zM, solapa, cordon, nCordon, abre, s1, s2, libre, cx, cy, tr, lerp };
  }
  motor.abreSobre = async (datos = {}) => {
    const M = montaSobre(datos); if (!M) return;
    const { p, grueso, yM, sube, zM, solapa, cordon, nCordon, abre, s1, s2, libre, cx, cy, tr, lerp } = M;
    await corre(SOBRE_MS, u => {
      const t = u * GUION;
      const q = tr(t, 0, 1000, parejo), k1 = sale(q), k5 = tr(t, 5900, 7050, ambos);
      // 1) EL SALTO: sale chiquito de arriba, al fondo, y brinca hacia el frente dando una vuelta; va creciendo conforme se acerca
      // 1b) ATERRIZA: se aplasta tantito y se recupera · 1c) EL SUSPIRO: se dobla hacia delante, cansado, y le escurre una gota de sudor
      const aplasta = .14 * tr(t, 1000, 1110, sale) * (1 - tr(t, 1110, 1400, ambos));
      const suspiro = tr(t, 1400, 1700, ambos) * (1 - tr(t, 1950, 2250, ambos));
      // 5) al final se pone de frente y crece hasta ser la carta
      gSobre.rotation.set(rad(lerp(lerp(-380, -9, k1) + 15 * suspiro, 0, k5)), rad(lerp(lerp(0, -13, k1), 0, k5)), rad(lerp(lerp(40, 0, k1), 0, k5)));
      const s = lerp(s1 * lerp(.03, 1, q * q), s2, k5), sy = 1 - aplasta - .05 * suspiro, sx = 1 + aplasta * .6;
      gSobre.scale.set(s * sx, s * sy, s);
      const ySalto = lerp(H * .18, 0, q) + H * .22 * Math.sin(Math.PI * q) - (1 - sy) * p.dim.h / 2 * s;      // el último término: al aplastarse, los pies no se despegan del piso
      gSobre.position.set(lerp(0, cx, k5), lerp(ySalto, cy - yM * s, k5), -(zM + grueso / 2) * s);   // la cara de arriba del mazo va en z = 0: ahí 1 unidad = 1 píxel exacto (relevo con la carta de verdad)
      const kg = tr(t, 1450, 2250, parejo);
      gota.visible = kg > 0 && kg < 1;
      if (gota.visible) { gota.position.set(p.dim.w / 2 - 26, p.dim.h / 2 - 34 - 46 * entra(kg), p.dim.d / 2 + 4); gota.scale.setScalar(Math.min(kg * 5, 1) * 1.6); gota.material.opacity = Math.min(1, (1 - kg) * 4); }
      // 2) el cordón se desenreda y luego gira la solapa
      if (nCordon) cordon.geometry.setDrawRange(0, Math.round(nCordon * (1 - tr(t, 2300, 3050, ambos)) / 3) * 3);
      if (solapa) solapa.rotation.x = abre * tr(t, 3100, 4000, ambos);
      // 3) sale el mazo · 5) vuelve a su sitio dentro del grupo mientras crece
      mazo.position.set(0, yM + sube * tr(t, 4200, 5150, sale) * (1 - k5), zM);
      // 4) el sobre se cae
      const k4 = tr(t, 5250, 6050, entra);
      const total = H / s + p.dim.h, caida = total * k4;
      p.pivote.position.set(0, -caida, 0); p.pivote.rotation.x = rad(35 * Math.min(Math.max((caida - libre) / Math.max(total - libre, 1), 0), 1)); p.pivote.visible = k4 < 1;
    });
    if (solapa) solapa.rotation.x = 0; if (nCordon) cordon.geometry.setDrawRange(0, Infinity);      // el modelo queda como llegó, para la próxima
  };
  /* ---------- el cierre de la lección: las cartas se guardan en el sobre, se cierra, le cuelga una etiqueta, cae el sello chico y el sobre se va ----------
     Es la apertura al revés, con las mismas piezas (el sobre .glb y el mazo con la foto de la última carta), más:
       la etiqueta    → una hoja plana que pone el motor colgada del botón del sobre (su dibujo lo manda la app: etiqueta = sin sellar, etiquetaSellada = con la huella)
       el sello chico → la pieza «selloChico», que cae en la casilla de la etiqueta
       la salida      → 'plato' (sale aventado hacia el fondo girando como plato, y estalla donde cae) o 'prisa' (se ladea y sale disparado de lado, con rayas de viento)
     apura() = la app avisa si el usuario tocó la pantalla (entonces cada tramo se salta) · alGolpe() = cuando el sello chico toca la etiqueta */
  let tarjeta = null, pum = null, viento = null;
  motor.cierraSobre = async ({ rect, textura, rotulo, etiqueta, etiquetaSellada, salida = 'plato', apura, alGolpe } = {}) => {
    const M = montaSobre({ rect, textura, rotulo }); if (!M) return;
    const { p, e, hM, grueso, yM, zM, solapa, cordon, nCordon, abre, s1, s2, cx, cy, tr, lerp } = M;
    const prisa = () => { if (apura && apura()) motor.prisa = true; };
    // la etiqueta, en medidas del sobre: 97 × 140, colgada de un punto 45 abajo de la orilla de arriba (donde está el botón del cordón)
    const aT = 97, hT = 140, yCuelga = p.dim.h / 2 - 45, cuelgue = 7;
    if (!tarjeta) { tarjeta = new THREE.Group(); tarjeta.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ alphaTest: .5, toneMapped: false }))); gSobre.add(tarjeta); }      // alphaTest: las esquinas cortadas del dibujo no se pintan; lo demás es una hoja sólida, con su profundidad
    const hoja = tarjeta.children[0]; hoja.scale.set(aT, hT, 1); hoja.position.set(0, -cuelgue - hT / 2, 0);
    const pinta = lienzo => { if (!lienzo) return; const t = new THREE.CanvasTexture(lienzo); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      if (hoja.material.map) hoja.material.map.dispose(); hoja.material.map = t; hoja.material.needsUpdate = true; };
    pinta(etiqueta); tarjeta.position.set(0, yCuelga, p.dim.d / 2 + 3); tarjeta.rotation.set(0, 0, 0); tarjeta.visible = false;
    if (solapa) solapa.rotation.x = abre; if (nCordon) cordon.geometry.setDrawRange(0, 0);      // empieza abierto y con el cordón suelto
    p.pivote.position.set(0, 0, 0); p.pivote.rotation.set(0, 0, 0); p.pivote.visible = true;

    /* --- tramo 1: guardar las cartas, cerrar y colgar la etiqueta --- */
    const yFuera = p.dim.h / 2 + hM / 2 + 4, bajo = -H * .38;      // yFuera: el mazo completo afuera, justo encima de la boca · bajo: dónde espera el sobre
    const PENDULO = [ { t: 0, a: -55, e: ambos }, { t: .35, a: 16, e: ambos }, { t: .58, a: -9, e: ambos }, { t: .78, a: 4, e: ambos }, { t: 1, a: 0, e: ambos } ];
    prisa();
    await corre(3300, u => {
      const t = u * 4250;
      // A) el mazo (que empieza exactamente encima de la carta de verdad) se achica y sube; el sobre, abierto, aparece por abajo con la boca pegada al mazo
      // B) las cartas bajan por la boca mientras el sobre sube al centro · C) baja la solapa · D) se enreda el cordón · E) cae la etiqueta, columpiándose
      const kA = tr(t, 0, 900, ambos), kB = tr(t, 950, 1850, ambos), kC = tr(t, 1900, 2500, ambos), kD = tr(t, 2500, 3100, ambos), kE = tr(t, 3150, 4250, parejo);
      const s = lerp(s2, s1, kA), ladeo = kA * (1 - kC);                          // ladeo: un poco girado mientras recibe las cartas (se nota el volumen); de frente para la etiqueta
      gSobre.scale.setScalar(s); gSobre.rotation.set(rad(-9 * ladeo), rad(-13 * ladeo), 0);
      gSobre.position.set(lerp(cx, 0, kA), lerp(lerp(cy - yFuera * s2, bajo, kA), 0, kB), -(zM + grueso / 2) * s);
      mazo.position.set(0, lerp(yFuera, yM, kB), zM);
      if (solapa) solapa.rotation.x = abre * (1 - kC);
      if (nCordon) cordon.geometry.setDrawRange(0, Math.round(nCordon * kD / 3) * 3);
      tarjeta.visible = kE > 0; if (tarjeta.visible) tarjeta.rotation.z = rad(mezcla(PENDULO, kE).a);
    });

    /* --- tramo 2: el sello chico cae en la casilla de la etiqueta (la casilla está 29 arriba de la orilla de abajo) --- */
    const yCasilla = yCuelga - cuelgue - hT + 29, px = W / 2, py = H / 2 - yCasilla * s1;
    prisa();
    const zEtiqueta = gSobre.position.z + (p.dim.d / 2 + 3) * s1;      // la etiqueta está delante del sobre: el sello cae a esa altura, no a la del fondo
    if (piezas.selloChico) await motor.sellaChico({ x: px, y: py, escala: e, z: zEtiqueta, rect: { x: px - aT * s1 / 2, y: H / 2 - (yCuelga - cuelgue) * s1, w: aT * s1, h: hT * s1 },
      alGolpe: () => { pinta(etiquetaSellada); if (alGolpe) alGolpe(); } });
    else { pinta(etiquetaSellada); if (alGolpe) alGolpe(); }

    /* --- tramo 3: la salida --- */
    prisa();
    if (salida === 'prisa') {
      // rayas de viento: unas tiras blancas detrás del sobre que pasan de izquierda a derecha
      if (!viento) { viento = new THREE.Group(); const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false });      // con profundidad: quedan DETRÁS del sobre
        for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); r.position.y = (i - 3.5) * 27; r.scale.set(190 + (i * 53) % 90, 2, 1); viento.add(r); } escena.add(viento); }
      viento.scale.setScalar(e); viento.visible = true;
      await corre(680, u => {
        const k1 = tr(u, 0, .24, sale), k2 = tr(u, .24, 1, entra), kv = tr(u, .2, .95, parejo);      // k1: se ladea para tomar vuelo · k2: sale disparado
        gSobre.position.set(-36 * e * k1 * (1 - k2) + (W / 2 + p.dim.h * s1) * k2, -12 * e * k1 * (1 - k2) + 150 * e * k2, gSobre.position.z);
        gSobre.rotation.set(0, 0, rad(17 * k1 * (1 - k2) - 600 * k2));
        viento.position.set(lerp(-90, 130, kv) * e, 0, -90); viento.children[0].material.opacity = .8 * Math.sin(Math.PI * kv);
      });
      viento.visible = false;
    } else {
      const xF = W * .2, yF = H * .27, zF = -3300, f = DIST / (DIST - zF);                        // dónde se pierde en la pantalla (arriba a la derecha) y qué tan lejos; f = cuánto achica la distancia
      await corre(820, u => {
        const k1 = tr(u, 0, .16, sale), k2 = tr(u, .16, 1, t => 1 - (1 - t) * (1 - t));          // k1: toma tantito vuelo hacia ti · k2: sale aventado hacia el fondo
        gSobre.position.set(xF / f * k2, -22 * e * k1 * (1 - k2) + yF / f * k2, 130 * e * k1 * (1 - k2) + zF * k2);
        gSobre.rotation.set(rad(-10 * k1 * (1 - k2) + 48 * k2), 0, rad(-800 * k2));               // gira como plato: acostado y dando vueltas
      });
      gSobre.visible = false;
      // el estallido donde cae
      if (!pum) { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, '#fff'); g.addColorStop(.3, '#fff'); g.addColorStop(.32, '#ffd36b'); g.addColorStop(.63, '#ffd36b'); g.addColorStop(.65, '#e8482f'); g.addColorStop(.96, '#e8482f'); g.addColorStop(1, 'rgba(232,72,47,0)');
        x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        pum = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthTest: false })); escena.add(pum); }
      pum.position.set(xF, yF, 0); pum.visible = true; prisa();
      await corre(450, u => { pum.scale.setScalar(42 * e * lerp(.15, 1.8, sale(u))); pum.material.opacity = u < .55 ? 1 : 1 - (u - .55) / .45; });
      pum.visible = false;
    }
    // todo queda como llegó, para la próxima lección
    gSobre.visible = false; tarjeta.visible = false; gSobre.rotation.set(0, 0, 0);
    if (solapa) solapa.rotation.x = 0; if (nCordon) cordon.geometry.setDrawRange(0, Infinity);
    mide(); dibuja();
  };
  motor.guardaSobre = () => { if (gSobre) { gSobre.visible = false; mide(); dibuja(); } motor.prisa = false; };
  motor.SOBRE_MS = SOBRE_MS;

  /* ---------- solo para el probador: dejar una pieza girando a la vista ---------- */
  let girando = null;
  motor.muestra = (nombre, { x, y, escala = 1 } = {}) => {
    motor.oculta(); const p = piezas[nombre]; if (!p) return; const ficha = girando = { p };
    p.pivote.visible = true; p.pivote.scale.setScalar(escala);
    (function paso(ahora) {
      if (girando !== ficha) return;
      mide(); p.pivote.position.set(x - W / 2, H / 2 - y, 200); p.pivote.rotation.set(rad(-24), 0, 0);
      p.trompo.rotation.set(0, 0, 0); p.trompo.scale.setScalar(1); p.trompo.rotation.y = rad((ahora / 25) % 360);
      dibuja(); tic(paso);
    })(performance.now());
  };
  motor.oculta = () => { if (girando) { girando.p.pivote.visible = false; girando = null; mide(); dibuja(); } };

  /* si el teléfono le quita el 3D a la página (pasa al dejarla mucho rato en segundo plano), la app lo ve en motor.roto y usa el sello plano */
  lienzo.addEventListener('webglcontextlost', ev => { ev.preventDefault(); motor.roto = true; });
  lienzo.addEventListener('webglcontextrestored', () => { motor.roto = false; });
  motor.libera = () => { motor.oculta(); renderer.dispose(); };
  return motor;
}
