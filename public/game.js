const socket = io();
const $ = id => document.getElementById(id);

let roomCode = "";
let fleet = null;
let gameState = null;
let fleetSubmitted = false;

function setStatus(message) {
  $("status").textContent = message;
}

function generateFleet() {
  const grid = Array.from({ length: 10 }, () => Array(10).fill(0));
  const lengths = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

  for (const length of lengths) {
    let placed = false;
    for (let attempt = 0; attempt < 3000 && !placed; attempt++) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * 10);
      const y = Math.floor(Math.random() * 10);
      const cells = [];
      for (let i = 0; i < length; i++) {
        cells.push([x + (horizontal ? i : 0), y + (horizontal ? 0 : i)]);
      }
      if (cells.some(([cx, cy]) => cx >= 10 || cy >= 10)) continue;

      let allowed = true;
      for (const [cx, cy] of cells) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (grid[cy + dy]?.[cx + dx]) allowed = false;
          }
        }
      }
      if (allowed) {
        for (const [cx, cy] of cells) grid[cy][cx] = 1;
        placed = true;
      }
    }
    if (!placed) return generateFleet();
  }
  return grid;
}

function drawBoards() {
  if (!fleet) return;
  const ownBoard = $("ownBoard");
  const enemyBoard = $("enemyBoard");
  ownBoard.replaceChildren();
  enemyBoard.replaceChildren();

  const hitsOnOwn = new Set(gameState?.hitsOnOwnFleet || []);
  const shots = new Map((gameState?.shots || []).map(s => [s.x + "," + s.y, s]));

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const key = x + "," + y;
      const ownCell = document.createElement("div");
      ownCell.className = "cell";
      if (fleet[y][x]) ownCell.classList.add("ship");
      if (hitsOnOwn.has(key)) {
        ownCell.classList.add("hit");
        ownCell.textContent = "✹";
      } else if (fleet[y][x]) {
        ownCell.textContent = "■";
      }
      ownBoard.appendChild(ownCell);

      const target = document.createElement("button");
      target.className = "cell target";
      const shot = shots.get(key);
      if (shot) {
        target.classList.add(shot.hit ? "hit" : "miss");
        target.textContent = shot.hit ? "✹" : "·";
      }
      target.disabled = !gameState?.yourTurn || !gameState?.started || gameState?.over || !fleetSubmitted || Boolean(shot);
      target.setAttribute("aria-label", "Клетка " + (x + 1) + ", " + (y + 1));
      target.addEventListener("click", () => {
        socket.emit("shoot", { x, y }, result => {
          if (!result?.ok) setStatus(result?.error || "Не удалось выстрелить.");
          else setStatus(result.hit ? "Попадание! По правилам игры ход остаётся за тобой." : "Мимо. Теперь ход соперника.");
        });
      });
      enemyBoard.appendChild(target);
    }
  }
}

function updateState(state) {
  gameState = state;
  $("copyCode").disabled = !roomCode;
  $("newFleet").disabled = !roomCode || fleetSubmitted || state.over;
  $("ready").disabled = !roomCode || fleetSubmitted || state.over;

  if (state.over) {
    setStatus(state.winner === socket.id ? "Победа! Ты потопил весь флот соперника." : "Игра завершена. Можно создать новую комнату.");
  } else if (state.playerCount < 2) {
    setStatus("Комната " + state.code + ". Отправь код другу и жди подключения.");
  } else if (state.readyCount < 2) {
    setStatus("Соперник подключён. Оба игрока должны расставить флот и нажать «Готов к бою!».");
  } else if (!state.started) {
    setStatus("Ожидаем готовность игроков.");
  } else {
    setStatus(state.yourTurn ? "Твой ход! Выбирай клетку соперника." : "Ход соперника. Ждём выстрел.");
  }
  drawBoards();
}

function prepareFleet() {
  fleet = generateFleet();
  drawBoards();
}

$("createRoom").addEventListener("click", () => {
  socket.emit("createRoom", { name: $("playerName").value }, result => {
    if (!result?.ok) return setStatus(result?.error || "Не удалось создать комнату.");
    roomCode = result.code;
    $("roomCode").value = roomCode;
    fleetSubmitted = false;
    prepareFleet();
    setStatus("Комната создана. Отправь другу код " + roomCode + ".");
  });
});

$("joinRoom").addEventListener("click", () => {
  socket.emit("joinRoom", { code: $("roomCode").value, name: $("playerName").value }, result => {
    if (!result?.ok) return setStatus(result?.error || "Не удалось войти в комнату.");
    roomCode = result.code;
    fleetSubmitted = false;
    prepareFleet();
    setStatus("Ты в комнате " + roomCode + ". Подготовь флот и нажми «Готов к бою!».");
  });
});

$("newFleet").addEventListener("click", () => {
  if (fleetSubmitted) return;
  prepareFleet();
});

$("ready").addEventListener("click", () => {
  if (!fleet) return;
  socket.emit("setFleet", { fleet }, result => {
    if (!result?.ok) return setStatus(result?.error || "Не удалось подтвердить флот.");
    fleetSubmitted = true;
    $("ready").disabled = true;
    $("newFleet").disabled = true;
    setStatus("Флот готов. Ждём соперника...");
    drawBoards();
  });
});

$("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    setStatus("Код комнаты скопирован: " + roomCode);
  } catch {
    setStatus("Отправь другу код комнаты: " + roomCode);
  }
});

socket.on("state", updateState);
socket.on("connect", () => setStatus("Подключено к серверу. Создай комнату или введи код друга."));
socket.on("disconnect", () => setStatus("Соединение потеряно. Попробуй обновить страницу."));

prepareFleet();
