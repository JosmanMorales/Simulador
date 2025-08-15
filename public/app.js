
// ===== Socket y elementos =====
const socket = io();

const elTotal = document.getElementById('totalRam');
const elAvail = document.getElementById('availableRam');
const elUsed = document.getElementById('usedRam');
const barUsed = document.getElementById('ramUsedBar');

const tblRunning = document.getElementById('tblRunning');
const tblQueue = document.getElementById('tblQueue');

const formCreate = document.getElementById('formCreate');
const formBatch = document.getElementById('formBatch');
const btnReset = document.getElementById('btnReset');
const btnTheme = document.getElementById('btnTheme');

const orderBy = document.getElementById('orderBy');
const orderDir = document.getElementById('orderDir');
const filterText = document.getElementById('filterText');

// ===== Estado UI =====
let lastState = null;
let stats = { created: 0, finished: 0, cancelled: 0 };

// ===== Tema =====
btnTheme.addEventListener('click', () => {
  const b = document.body;
  b.classList.toggle('theme-light');
  b.classList.toggle('theme-dark');
});

// ===== Toasts =====
const toasts = document.getElementById('toasts');
function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(()=> el.remove(), 3500);
}

// ===== Gráfico simple de RAM (Canvas) =====
const chart = document.getElementById('ramChart');
const ctx = chart.getContext('2d');
const history = []; // pares [timestamp, usedMB]
const MAX_POINTS = 120; // ~2 minutos si recibimos 1/s
function drawChart(){
  const W = chart.width, H = chart.height;
  ctx.clearRect(0,0,W,H);
  // Ejes
  ctx.globalAlpha = .3;
  ctx.beginPath();
  for(let i=0;i<=4;i++){
    const y = (H-20) * (i/4) + 10;
    ctx.moveTo(40,y); ctx.lineTo(W-10,y);
  }
  ctx.strokeStyle = '#888'; ctx.stroke();
  ctx.globalAlpha = 1;

  if(history.length < 2) return;
  const minX = history[0][0];
  const maxX = history[history.length-1][0];
  const span = Math.max(1, maxX - minX);
  const maxMB = Number(elTotal.textContent)||1024;

  // Línea RAM usada
  ctx.beginPath();
  history.forEach(([t, used], idx) => {
    const x = 40 + (W-50) * ((t - minX)/span);
    const y = 10 + (H-20) * (1 - used/maxMB);
    if(idx===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent');
  ctx.stroke();
}

// Redibujar al cambiar tema (color de línea)
const ro = new ResizeObserver(drawChart); ro.observe(chart);

// ===== Utilidades =====
const pct = (num, den) => Math.max(0, Math.min(100, den === 0 ? 0 : (num / den) * 100));
const by = (k, dir='asc') => (a,b)=>{
  const av=a[k]??0, bv=b[k]??0; return dir==='asc'? (av-bv) : (bv-av);
};
const matches = (name, q)=> !q || name.toLowerCase().includes(q.toLowerCase());

// ===== Render =====
function renderState(state){
  // Barra y totales
  elTotal.textContent = state.totalRAM;
  elAvail.textContent = state.availableRAM;
  elUsed.textContent = state.usedRAM;
  barUsed.style.width = pct(state.usedRAM, state.totalRAM) + '%';
  if (state.availableRAM < state.totalRAM * 0.1){ barUsed.style.filter='saturate(1.2)'; }
  else { barUsed.style.filter=''; }

  // Historial para gráfico
  history.push([Date.now(), state.usedRAM]);
  if(history.length > MAX_POINTS) history.shift();
  drawChart();

  // Orden y filtro
  const dir = orderDir.value; const key = orderBy.value; const q = filterText.value.trim();

  // Running
  const running = [...state.running].sort(by(key==='remainingSec'? 'remainingSec' : key, dir))
                                  .filter(r=> matches(r.name, q));
  tblRunning.innerHTML = running.map(r => `
    <tr class="enter">
      <td>${r.pid}</td>
      <td>${highlightName(r.name, 'run')}</td>
      <td>${r.memoryMB}</td>
      <td><span class="tag badge-run">${r.remainingSec}s</span></td>
      <td><button data-cancel="${r.pid}">Cancelar</button></td>
    </tr>
  `).join('');

  // Queue
  const queue = [...state.queue].sort(by(key==='remainingSec'? 'durationSec' : key, dir))
                               .filter(r=> matches(r.name, q));
  tblQueue.innerHTML = queue.map(q => `
    <tr class="enter">
      <td>${q.pid}</td>
      <td>${highlightName(q.name, 'queue')}</td>
      <td>${q.memoryMB}</td>
      <td>${q.durationSec}</td>
      <td><button data-cancel="${q.pid}">Quitar</button></td>
    </tr>
  `).join('');

  document.getElementById('statRunning').textContent = state.running.length;

  lastState = state;
}

function highlightName(name, kind){
  const cls = kind==='run' ? 'badge-run' : 'badge-queue';
  return `${name} <span class="tag ${cls}">${kind==='run'?'Ejecución':'Cola'}</span>`;
}

socket.on('state', renderState);

// ===== Eventos del servidor para KPIs y toasts =====
socket.on('process:created', (list)=>{
  const n = Array.isArray(list) ? list.length : 1;
  stats.created += n;
  document.getElementById('statCreated').textContent = stats.created;
  toast(`Se creó ${n===1?'1 proceso':n+' procesos'}.`);
});

socket.on('process:finished', ({ pid, name }) => {
  stats.finished += 1;
  document.getElementById('statFinished').textContent = stats.finished;
  toast(`✔ Proceso ${pid} (${name}) finalizó`);
});

socket.on('process:cancelled', ({ pid, name }) => {
  stats.cancelled += 1;
  document.getElementById('statCancelled').textContent = stats.cancelled;
  toast(`✖ Proceso ${pid} (${name}) cancelado`);
});

// ===== Formularios =====
formCreate.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const memoryMB = Number(document.getElementById('memory').value);
  const durationSec = Number(document.getElementById('duration').value);
  socket.emit('process:create', { name, memoryMB, durationSec });
  formCreate.reset();
});

formBatch.addEventListener('submit', (e) => {
  e.preventDefault();
  const count = Number(document.getElementById('batchCount').value) || 1;
  const memMin = Number(document.getElementById('batchMemMin').value) || 1;
  const memMax = Number(document.getElementById('batchMemMax').value) || memMin;
  const durMin = Number(document.getElementById('batchDurMin').value) || 1;
  const durMax = Number(document.getElementById('batchDurMax').value) || durMin;

  const list = Array.from({ length: count }).map((_, i) => ({
    name: `Auto-${Date.now()}-${i+1}`,
    memoryMB: rand(memMin, memMax),
    durationSec: rand(durMin, durMax),
  }));

  socket.emit('process:create', list);
});

function rand(a,b){ return Math.floor(Math.random() * (b - a + 1)) + a; }

// Cancelar desde las tablas
;[ tblRunning, tblQueue ].forEach(tbl => {
  tbl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cancel]');
    if (!btn) return;
    const pid = Number(btn.getAttribute('data-cancel'));
    socket.emit('process:cancel', { pid });
  });
});

btnReset.addEventListener('click', () => {
  stats = { created:0, finished:0, cancelled:0 };
  document.getElementById('statCreated').textContent = 0;
  document.getElementById('statFinished').textContent = 0;
  document.getElementById('statCancelled').textContent = 0;
  document.getElementById('statRunning').textContent = 0;
  history.length = 0;
  drawChart();
  socket.emit('sim:reset');
  toast('Simulación reseteada');
});