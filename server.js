const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ======== Estado del simulador ========
const TOTAL_RAM_MB = 1024; // 1 GB
let availableRAM = TOTAL_RAM_MB;
let nextPid = 1;

// Cola FIFO de procesos en espera
const queue = [];

// Procesos en ejecución: pid  objeto proceso extendido
const running = new Map();

function now() {
  return new Date().toISOString();
}

function createProcess({ name, memoryMB, durationSec }) {
  const pid = nextPid++;
  const proc = {
    pid,
    name: name && name.trim() ? name.trim() : `Proceso-${pid}`,
    memoryMB: Math.max(1, Math.floor(Number(memoryMB) || 1)),
    durationSec: Math.max(1, Math.floor(Number(durationSec) || 1)),
    createdAt: now()
  };
  queue.push(proc);
  broadcastState();
  trySchedule();
  return proc;
}

function trySchedule() {
  let scheduledAny = false;
  while (queue.length > 0 && availableRAM >= queue[0].memoryMB) {
    const proc = queue.shift();
    startProcess(proc);
    scheduledAny = true;
  }
  if (scheduledAny) broadcastState();
}

function startProcess(proc) {
  availableRAM -= proc.memoryMB;
  const startedAt = now();
  const extended = {
    ...proc,
    startedAt,
    remainingSec: proc.durationSec,
    tickInterval: null
  };

  // Temporizador de 1 segundo por proceso para simular ejecución concurrente
  extended.tickInterval = setInterval(() => {
    extended.remainingSec -= 1;
    if (extended.remainingSec <= 0) {
      finishProcess(extended.pid);
    } else {
      broadcastState();
    }
  }, 1000);

  running.set(proc.pid, extended);
}

function finishProcess(pid) {
  const proc = running.get(pid);
  if (!proc) return;
  clearInterval(proc.tickInterval);
  running.delete(pid);
  availableRAM += proc.memoryMB;

  io.emit('process:finished', { pid, name: proc.name, finishedAt: now() });
  broadcastState();
  // Intentar planificar nuevamente por si hay procesos en cola
  trySchedule();
}

function cancelProcess(pid) {
  // Intentar quitar de cola primero
  const idx = queue.findIndex(p => p.pid === pid);
  if (idx !== -1) {
    queue.splice(idx, 1);
    broadcastState();
    return true;
  }
  // O detener uno en ejecución
  const proc = running.get(pid);
  if (proc) {
    clearInterval(proc.tickInterval);
    running.delete(pid);
    availableRAM += proc.memoryMB;
    io.emit('process:cancelled', { pid, name: proc.name, cancelledAt: now() });
    broadcastState();
    trySchedule();
    return true;
  }
  return false;
}

function snapshot() {
  return {
    totalRAM: TOTAL_RAM_MB,
    availableRAM,
    usedRAM: TOTAL_RAM_MB - availableRAM,
    running: Array.from(running.values()).map(r => ({
      pid: r.pid,
      name: r.name,
      memoryMB: r.memoryMB,
      durationSec: r.durationSec,
      remainingSec: r.remainingSec,
      startedAt: r.startedAt
    })),
    queue: queue.map(q => ({
      pid: q.pid,
      name: q.name,
      memoryMB: q.memoryMB,
      durationSec: q.durationSec,
      createdAt: q.createdAt
    }))
  };
}

function broadcastState() {
  io.emit('state', snapshot());
}

io.on('connection', (socket) => {
  // Enviar estado inicial
  socket.emit('state', snapshot());

  socket.on('process:create', (payload) => {
    // payload puede ser un proceso o un arreglo de procesos
    const list = Array.isArray(payload) ? payload : [payload];
    const created = list.map(p => createProcess(p));
    socket.emit('process:created', created);
  });

  socket.on('process:cancel', ({ pid }) => {
    const ok = cancelProcess(Number(pid));
    socket.emit('process:cancel:ack', { pid, ok });
  });

  socket.on('sim:reset', () => {
    // Detener todo
    for (const r of running.values()) clearInterval(r.tickInterval);
    running.clear();
    queue.length = 0;
    availableRAM = TOTAL_RAM_MB;
    nextPid = 1;
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});