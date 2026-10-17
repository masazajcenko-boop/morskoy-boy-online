const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SIZE = 10;
const SHIP_LENGTHS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function validateFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== SIZE) return false;
  const cells = new Set();
  for (let y = 0; y < SIZE; y++) {
    if (!Array.isArray(fleet[y]) || fleet[y].length !== SIZE) return false;
    for (let x = 0; x < SIZE; x++) {
      if (fleet[y][x] !== 0 && fleet[y][x] !== 1) return false;
      if (fleet[y][x] === 1) cells.add(x + "," + y);
    }
  }
  if (cells.size !== 20) return false;

  const unseen = new Set(cells);
  const lengths = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    const [sx, sy] = first.split(",").map(Number);
    const stack = [[sx, sy]];
    unseen.delete(first);
    let count = 0;
    while (stack.length) {
      const [x, y] = stack.pop();
      count++;
      for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
        const key = nx + "," + ny;
        if (unseen.has(key)) {
          unseen.delete(key);
          stack.push([nx, ny]);
        }
      }
    }
    lengths.push(count);
  }
  lengths.sort((a,b) => a-b);
  return JSON.stringify(lengths) === JSON.stringify([...SHIP_LENGTHS].sort((a,b) => a-b));
}

function stateFor(room, player) {
  const opponent = room.players.find(p => p.id !== player.id);
  const hitsOnOwnFleet = opponent && player.fleet
    ? opponent.shots.filter(s => player.fleet[s.y][s.x] === 1).map(s => s.x + "," + s.y)
    : [];
  return {
    code: room.code,
    playerCount: room.players.length,
    readyCount: room.players.filter(p => p.fleet).length,
    started: room.started,
    over: room.over,
    yourTurn: room.turn === player.id && room.started && !room.over,
    winner: room.winner,
    opponentName: opponent ? opponent.name : "",
    shots: player.shots,
    hitsOnOwnFleet
  };
}

function broadcast(room) {
  for (const player of room.players) {
    io.to(player.id).emit("state", stateFor(room, player));
  }
}

io.on("connection", socket => {
  socket.on("createRoom", (data = {}, reply = () => {}) => {
    let code;
    do { code = roomCode(); } while (rooms.has(code));
    const player = {
      id: socket.id,
      name: String(data.name || "Капитан").slice(0, 20),
      fleet: null,
      shots: []
    };
    const room = { code, players: [player], turn: null, started: false, over: false, winner: null };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    reply({ ok: true, code });
    broadcast(room);
  });

  socket.on("joinRoom", (data = {}, reply = () => {}) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: "Комната не найдена. Проверь код." });
    if (room.players.length >= 2) return reply({ ok: false, error: "В комнате уже два игрока." });
    const player = {
      id: socket.id,
      name: String(data.name || "Игрок 2").slice(0, 20),
      fleet: null,
      shots: []
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    reply({ ok: true, code });
    broadcast(room);
  });

  socket.on("setFleet", (data = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && room.players.find(p => p.id === socket.id);
    if (!room || !player || room.over) return reply({ ok: false, error: "Игра недоступна." });
    if (!validateFleet(data.fleet)) return reply({ ok: false, error: "Расстановка кораблей неверна. Нажми «Новая расстановка»." });
    player.fleet = data.fleet;
    if (room.players.length === 2 && room.players.every(p => p.fleet)) {
      room.started = true;
      if (!room.turn) room.turn = room.players[0].id;
    }
    reply({ ok: true });
    broadcast(room);
  });

  socket.on("shoot", (data = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.over) return reply({ ok: false, error: "Игра ещё не началась." });
    const player = room.players.find(p => p.id === socket.id);
    const enemy = room.players.find(p => p.id !== socket.id);
    if (!player || !enemy || room.turn !== socket.id) return reply({ ok: false, error: "Сейчас ход соперника." });
    const { x, y } = data;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
      return reply({ ok: false, error: "Неверная клетка." });
    }
    if (player.shots.some(s => s.x === x && s.y === y)) return reply({ ok: false, error: "Ты уже стрелял сюда." });
    const hit = enemy.fleet[y][x] === 1;
    player.shots.push({ x, y, hit });
    if (player.shots.filter(s => s.hit).length >= 20) {
      room.over = true;
      room.winner = player.id;
    } else if (!hit) {
      room.turn = enemy.id;
    }
    reply({ ok: true, hit });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) {
      rooms.delete(code);
      return;
    }
    room.started = false;
    room.over = true;
    room.winner = room.players[0].id;
    broadcast(room);
    setTimeout(() => {
      if (rooms.get(code) === room) rooms.delete(code);
    }, 60000);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Морской бой онлайн запущен на порту " + PORT);
});
