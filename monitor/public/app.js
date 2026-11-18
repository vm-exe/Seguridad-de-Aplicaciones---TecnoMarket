// Interfaz del panel. Regla de seguridad: todo lo que viene del servidor (salida de herramientas,
// resúmenes) se inserta con textContent, nunca como HTML.
"use strict";

const $ = (id) => document.getElementById(id);
const estado = { catalogo: null, ejecucion: null, fuente: null, reloj: null, inicio: 0, autoScroll: true };
const NOMBRES_RESULTADO = { aprobada: "aprobada", fallida: "fallida", error: "error", cancelada: "cancelada", "en-curso": "en curso" };

function el(etiqueta, props = {}, ...hijos) {
  const n = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (k === "clase") n.className = v;
    else if (k === "texto") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h) n.append(h);
  return n;
}

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { ...opciones, headers: { "X-Monitor": "1", ...(opciones.headers || {}) } });
  if (r.status === 401) {
    document.body.replaceChildren(el("p", { clase: "vacio", texto: "Sesión no válida: abra el enlace con token que aparece en la terminal donde ejecutó «npm run laboratorio»." }));
    throw new Error("401");
  }
  return r;
}

const duracion = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};
const fecha = (iso) => new Date(iso).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "medium" });
const pill = (resultado) => el("span", { clase: `pill pill-${resultado}`, texto: NOMBRES_RESULTADO[resultado] || resultado });

// ---------------------------------------------------------------------------- catálogo
async function cargarCatalogo() {
  estado.catalogo = await (await api("/api/catalogo")).json();
  pintarCatalogo();
  if (estado.catalogo.enCurso && !estado.ejecucion) {
    const p = estado.catalogo.pruebas.find((x) => x.id === estado.catalogo.enCurso.prueba);
    seguirEjecucion(estado.catalogo.enCurso.id, p);
  }
}

function pintarCatalogo() {
  const { categorias, pruebas } = estado.catalogo;
  const ocupado = !!estado.ejecucion;
  const cuenta = { aprobada: 0, fallida: 0, pendiente: 0 };
  for (const p of pruebas) {
    const r = p.ultimo?.resultado;
    if (r === "aprobada") cuenta.aprobada++;
    else if (r === "fallida" || r === "error") cuenta.fallida++;
    else cuenta.pendiente++;
  }
  $("resumen").replaceChildren(
    el("span", { clase: "chip" }, el("span", { clase: "punto ok" }), `${cuenta.aprobada} aprobadas`),
    el("span", { clase: "chip" }, el("span", { clase: "punto mal" }), `${cuenta.fallida} con fallas`),
    el("span", { clase: "chip" }, el("span", { clase: "punto" }), `${cuenta.pendiente} sin ejecutar`),
  );

  $("categorias").replaceChildren(
    ...categorias.map((c) =>
      el("div", { clase: "categoria" },
        el("div", { clase: "categoria-cabecera" }, el("h2", { texto: c.nombre }), el("span", { clase: "fase", texto: c.fase })),
        pruebas.filter((p) => p.categoria === c.id).map((p) => tarjeta(p, ocupado)),
      ),
    ),
  );
}

function tarjeta(p, ocupado) {
  const activa = estado.ejecucion?.prueba === p.id;
  const ultimo = p.ultimo
    ? el("span", { clase: "meta" }, pill(p.ultimo.resultado), ` ${fecha(p.ultimo.fin)}`)
    : el("span", { clase: "meta", texto: "Sin ejecutar" });
  return el("article", { clase: `tarjeta${activa ? " activa" : ""}` },
    el("div", { clase: "tarjeta-fila" },
      el("div", {},
        el("h3", { texto: p.nombre }),
        el("div", { clase: "meta", texto: `${p.herramienta} · ${p.responsable} · ~${p.duracion}` }),
      ),
      p.requiereLaboratorio ? el("span", { clase: "etiqueta-lab", texto: "requiere laboratorio" }) : null,
    ),
    el("p", { clase: "descripcion", texto: p.descripcion }),
    el("p", { clase: "esperado" }, el("strong", { texto: "Esperado: " }), p.esperado),
    el("div", { clase: "acciones" },
      el("button", { clase: "btn", texto: activa ? "Ejecutando…" : "Ejecutar", disabled: ocupado, onclick: () => ejecutar(p) }),
      p.enlace ? el("a", { clase: "enlace-sec", href: p.enlace.url, target: "_blank", rel: "noopener noreferrer", texto: p.enlace.nombre }) : null,
      ...p.reportes.filter((r) => r.existe).map((r, i) => el("a", { clase: "enlace-sec", href: `/reportes/${p.id}/${p.reportes.indexOf(r)}`, target: "_blank", rel: "noopener", texto: r.nombre, "data-i": i })),
      ultimo,
    ),
  );
}

// ---------------------------------------------------------------------------- ejecución en vivo
async function ejecutar(p) {
  const r = await api(`/api/pruebas/${p.id}/ejecutar`, { method: "POST" });
  const datos = await r.json();
  if (!r.ok) {
    alert(datos.error || "No se pudo iniciar la prueba");
    return;
  }
  seguirEjecucion(datos.id, p);
}

function claseLinea(l) {
  if (/^(▶|■|==)/.test(l)) return "l-titulo";
  if (/^(OK\b|✓|✔)|\b(\d+ passed|No issues found|found 0 vulnerabilities|0 findings|Failed checks: 0|PASS: \d+)/i.test(l)) return "l-ok";
  if (/^(FALLA|ERR|Error)|\b(FAIL-NEW: [1-9]|failed|FAILED|CRITICAL: [1-9]|HIGH: [1-9]|leaks found: [1-9])/.test(l)) return "l-mal";
  if (/^\s*$|^\s{2}Esperado:/.test(l)) return "l-tenue";
  return "";
}

function agregarLinea(l) {
  const salida = $("salida");
  const nodo = document.createElement("span");
  const c = claseLinea(l);
  if (c) nodo.className = c;
  // Solo se convierten en enlace las URL del propio laboratorio (Jaeger y la tienda).
  const partes = l.split(/(http:\/\/localhost:(?:16686|8080)\/[\w\-./?=&%]*)/);
  for (const [i, parte] of partes.entries()) {
    if (i % 2 === 1) nodo.append(el("a", { href: parte, target: "_blank", rel: "noopener noreferrer", texto: parte, clase: "l-enlace" }));
    else if (parte) nodo.append(parte);
  }
  nodo.append("\n");
  salida.append(nodo);
  while (salida.childNodes.length > 6000) salida.firstChild.remove();
  if (estado.autoScroll) salida.scrollTop = salida.scrollHeight;
}

function seguirEjecucion(id, p) {
  estado.fuente?.close();
  clearInterval(estado.reloj);
  estado.ejecucion = { id, prueba: p.id };
  estado.inicio = Date.now();
  $("salida").replaceChildren();
  $("veredicto").hidden = true;
  $("consola-titulo").textContent = `${p.nombre} · ${p.herramienta}`;
  $("consola-esperado").textContent = `Esperado: ${p.esperado}`;
  $("consola-estado").replaceWith(Object.assign(pill("en-curso"), { id: "consola-estado" }));
  $("btn-cancelar").hidden = false;
  estado.reloj = setInterval(() => ($("consola-reloj").textContent = duracion(Date.now() - estado.inicio)), 500);
  pintarCatalogo();
  // En pantallas angostas la consola queda debajo del catálogo: se lleva a la vista.
  if (window.matchMedia("(max-width: 1000px)").matches) document.querySelector(".consola").scrollIntoView({ behavior: "smooth" });

  const fuente = new EventSource(`/api/ejecuciones/${id}/eventos`);
  estado.fuente = fuente;
  fuente.addEventListener("linea", (e) => agregarLinea(JSON.parse(e.data)));
  fuente.addEventListener("fin", (e) => {
    fuente.close();
    terminar(JSON.parse(e.data), p);
  });
  fuente.onerror = () => {
    if (fuente.readyState === EventSource.CLOSED) return;
  };
}

function terminar(registro, p) {
  clearInterval(estado.reloj);
  if (registro.duracionMs) $("consola-reloj").textContent = duracion(registro.duracionMs);
  $("consola-estado").replaceWith(Object.assign(pill(registro.resultado), { id: "consola-estado" }));
  $("btn-cancelar").hidden = true;
  const v = $("veredicto");
  v.className = `veredicto ${registro.resultado}`;
  const prueba = estado.catalogo.pruebas.find((x) => x.id === p.id) || p;
  v.replaceChildren(
    el("strong", { texto: `${(NOMBRES_RESULTADO[registro.resultado] || registro.resultado).toUpperCase()}: ${registro.resumen}` }),
    el("div", { clase: "acciones" },
      registro.id ? el("a", { clase: "enlace-sec", href: `/api/ejecuciones/${registro.id}/log`, target: "_blank", rel: "noopener", texto: "Salida completa" }) : null,
      ...(prueba.reportes || []).map((r, i) => el("a", { clase: "enlace-sec", href: `/reportes/${prueba.id}/${i}`, target: "_blank", rel: "noopener", texto: r.nombre })),
      prueba.enlace ? el("a", { clase: "enlace-sec", href: prueba.enlace.url, target: "_blank", rel: "noopener noreferrer", texto: prueba.enlace.nombre }) : null,
    ),
  );
  v.hidden = false;
  estado.ejecucion = null;
  cargarCatalogo();
  cargarHistorial();
}

// ---------------------------------------------------------------------------- historial y laboratorio
async function cargarHistorial() {
  const filas = await (await api("/api/historial")).json();
  $("historial").replaceChildren(
    ...(filas.length
      ? filas.map((h) =>
          el("tr", {},
            el("td", { clase: "num", texto: fecha(h.inicio) }),
            el("td", {}, el("strong", { texto: h.nombre }), el("div", { clase: "meta", texto: h.herramienta })),
            el("td", {}, pill(h.resultado)),
            el("td", { texto: h.resumen }),
            el("td", { clase: "num", texto: duracion(h.duracionMs) }),
            el("td", { clase: "meta", texto: h.ejecutadaPor }),
            el("td", {}, el("a", { clase: "enlace-sec", href: `/api/ejecuciones/${h.id}/log`, target: "_blank", rel: "noopener", texto: "Ver salida" })),
          ),
        )
      : [el("tr", {}, el("td", { clase: "vacio", colspan: "7", texto: "Todavía no se ha ejecutado ninguna prueba." }))]),
  );
}

async function cargarLaboratorio() {
  try {
    const lab = await (await api("/api/laboratorio")).json();
    const cont = $("servicios");
    if (!lab.docker) {
      cont.replaceChildren(el("span", { clase: "chip" }, el("span", { clase: "punto mal" }), "Docker no responde"));
      return;
    }
    if (!lab.servicios.length) {
      cont.replaceChildren(el("span", { clase: "chip" }, el("span", { clase: "punto mal" }), "Laboratorio apagado · ejecute «npm run laboratorio»"));
      return;
    }
    cont.replaceChildren(
      ...lab.servicios.map((s) => {
        const arriba = s.estado === "running";
        const punto = !arriba ? "mal" : s.salud && s.salud !== "healthy" ? "aviso" : "ok";
        return el("span", { clase: "chip", title: `${s.estado}${s.salud ? ` · ${s.salud}` : ""}` }, el("span", { clase: `punto ${punto}` }), s.servicio);
      }),
    );
  } catch {
    /* se reintenta en el siguiente ciclo */
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-cancelar").addEventListener("click", async () => {
    if (estado.ejecucion) await api(`/api/ejecuciones/${estado.ejecucion.id}/cancelar`, { method: "POST" });
  });
  $("salida").addEventListener("scroll", (e) => {
    const s = e.target;
    estado.autoScroll = s.scrollHeight - s.scrollTop - s.clientHeight < 40;
  });
  cargarCatalogo();
  cargarHistorial();
  cargarLaboratorio();
  setInterval(cargarLaboratorio, 10_000);
});
