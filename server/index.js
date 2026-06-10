const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ROOT = path.join(__dirname, '..');


app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gameGo: true });
});

app.use(
  express.static(ROOT, {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

const HOST_PIN = process.env.HOST_PIN || '!yeswecan';
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function clearVotes(room) {
  room.hostHasVoted = false;
  room.hostVote = null;
  room.players.forEach((p) => {
    p.hasVoted = false;
    p.vote = null;
  });
}

function countVotes(room) {
  let n = [...room.players.values()].filter((p) => p.hasVoted).length;
  if (room.hostHasVoted) n += 1;
  return n;
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    currentFloor: room.currentFloor,
    coneStep: room.coneStep,
    playerCount: room.players.size,
    votedCount: countVotes(room),
    liftSpeedMult: room.liftSpeedMult === 2 ? 2 : 1,
  };
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

// =============================================================================
// LIFT LOGIC (เดิมอยู่ที่ server/liftLogic.js)
// คำนวณลิฟท์จากแต้มโหวตรวม (0 + 5 + 10 ของทุกคนที่กด SUMMIT แล้ว)
// เรียกจาก round:process → ส่ง path ไปให้ script.js เล่นแอนิเมชัน
// =============================================================================

/** ชั้นลิฟท์จาก G ถึง 40 (ทีละ 5) — ลำดับใน array = ดัชนีชั้น */
const FLOORS = ['G', '5', '10', '15', '20', '25', '30', '35', '40'];

/**
 * หาทิศทางเริ่มเดิน: 1 = ขึ้น, -1 = ลง
 * @param {number} idx          ดัชนีชั้นปัจจุบันใน FLOORS
 * @param {number} maxIdx       ดัชนีชั้นสูงสุด (40)
 * @param {number|null} startDirection  ทิศจากรอบก่อน (room.liftDirection) หรือ null = เดาจากชั้น
 */
function resolveDirection(idx, maxIdx, startDirection) {
  // ถ้ารอบก่อนบันทึกทิศไว้แล้ว ใช้ต่อ
  if (startDirection === 1 || startDirection === -1) return startDirection;
  // ชั้น G → ต้องขึ้น
  if (idx <= 0) return 1;
  // ชั้น 40 → ต้องลง
  if (idx >= maxIdx) return -1;
  // ชั้นกลาง ๆ ค่าเริ่มต้นขึ้น
  return 1;
}

/**
 * คำนวณเส้นทางลิฟท์จากแต้มรวม vote
 * - เดินต่อในทิศทางเดิม (ขึ้น/ลง) ทีละ 5 แต้ม = หนึ่งชั้น
 * - ชน G หรือ 40 แล้วยังเหลือแต้ม → กลับทิศ (bounce) จนแต้มหมด
 *
 * @param {string} startFloor       ชั้นที่ลิฟท์ค้างอยู่ (เช่น 'G', '25')
 * @param {number} totalPoints      ผลรวมโหวตรอบนี้ (0, 5, 10, 15, ...)
 * @param {number|null} startDirection  1 = ขึ้น, -1 = ลง, null = ตามชั้นค้าง
 * @returns {{ path: string[], endFloor: string, endDirection: number }}
 *   path         รายการชั้นที่วิ่งผ่าน (ใช้แอนิเมชัน)
 *   endFloor     ชั้นที่หยุดสุดท้าย
 *   endDirection ทิศที่จะใช้รอบถัดไป (เก็บใน room.liftDirection)
 */
function computeLiftPath(startFloor, totalPoints, startDirection = null) {
  const start = String(startFloor);
  // แปลงชื่อชั้นเป็นดัชนีใน FLOORS
  let idx = FLOORS.indexOf(start);
  if (idx === -1) idx = 0; // ชั้นแปลก ๆ → ถือว่า G

  // เส้นทางเริ่มที่ชั้นปัจจุบัน
  const path = [FLOORS[idx]];
  // แต้มที่ยังเดินได้ (ไม่ให้ติดลบ)
  let remaining = Math.max(0, Number(totalPoints) || 0);
  const maxIdx = FLOORS.length - 1;

  // ไม่มีแต้ม → ยืนอยู่ชั้นเดิม
  if (remaining === 0) {
    const endDirection = resolveDirection(idx, maxIdx, startDirection);
    return { path, endFloor: FLOORS[idx], endDirection };
  }

  // ทิศเริ่มรอบนี้
  let direction = resolveDirection(idx, maxIdx, startDirection);

  while (remaining > 0) {
    if (direction === 1) {
      // ขึ้น: ถ้าอยู่ 40 แล้ว → กลับทิศลง (ยังไม่ลบแต้ม)
      if (idx >= maxIdx) {
        direction = -1;
        continue;
      }
      idx += 1;           // ขึ้นหนึ่งชั้น
      remaining -= 5;     // ใช้แต้ม 5
      path.push(FLOORS[idx]);
    } else {
      // ลง: ถ้าอยู่ G แล้ว → กลับทิศขึ้น (ยังไม่ลบแต้ม)
      if (idx <= 0) {
        direction = 1;
        continue;
      }
      idx -= 1;           // ลงหนึ่งชั้น
      remaining -= 5;
      path.push(FLOORS[idx]);
    }
  }

  return {
    path,
    endFloor: path[path.length - 1],
    endDirection: direction,
  };
}

// =============================================================================
// SOCKET.IO — ห้อง, โหวต, Host NEXT / NEXT ROUTE / EXIT
// =============================================================================

const ERR = {
  badPin: 'PIN ไม่ถูกต้อง',
  noRoom: 'ไม่พบห้องลองใหม่น้าา',
  roomEnded: 'เกมจบแล้วทุกคน',
  notHost: 'ไม่ใช่ Host',
  goOnce: 'กด Go ได้ครั้งเดียว',
  voteClosed: 'ยังไม่เปิดโหวต',
  badVote: 'เลือก 0, 5 หรือ 10',
  voted: 'โหวตแล้ว',
  useNextRoute: 'กด NEXT ROUTE ก่อน',
  useNext: 'กด NEXT ก่อน',
  ended: 'จบเกมแล้ว',
  notVoting: 'ยังไม่ถึงการโหวต',
};

function emitErr(socket, code) {
  socket.emit('error', { code, message: ERR[code] || code });
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ pin }) => {
    if (String(pin) !== HOST_PIN) {
      emitErr(socket, 'badPin');
      return;
    }
    const prevCode = socket.data.roomCode;
    if (prevCode) {
      const prev = rooms.get(prevCode);
      if (prev && prev.hostId === socket.id) rooms.delete(prevCode);
      socket.leave(prevCode);
    }
    const code = generateCode();
    const room = {
      code,
      hostId: socket.id,
      phase: 'lobby',
      round: 0,
      currentFloor: 'G',
      liftDirection: 1,
      coneStep: 0,
      hostVote: null,
      hostHasVoted: false,
      liftSpeedMult: 1,
      players: new Map(),
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = true;
    socket.emit('room:joined', { ...publicRoom(room), isHost: true });
  });

  socket.on('room:join', ({ code }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) {
      emitErr(socket, 'noRoom');
      return;
    }
    if (room.phase === 'game_over') {
      emitErr(socket, 'roomEnded');
      return;
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isHost = false;
    room.players.set(socket.id, { hasVoted: false, vote: null });
    socket.emit('room:joined', { ...publicRoom(room), isHost: false });
    io.to(room.code).emit('room:update', publicRoom(room));
  });

  socket.on('game:go', (_payload, ack) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) {
      if (typeof ack === 'function') ack({ ok: false, code: 'notHost', message: ERR.notHost });
      return;
    }
    if (room.phase !== 'lobby') {
      if (typeof ack === 'function') ack({ ok: false, code: 'goOnce', message: ERR.goOnce });
      return;
    }

    room.round = 1;
    room.currentFloor = 'G';
    room.liftDirection = 1;
    room.coneStep = 0;
    room.phase = 'voting';
    clearVotes(room);

    const state = publicRoom(room);
    io.to(room.code).emit('game:go', state);
    socket.emit('action:ok', { action: 'go' });
    if (typeof ack === 'function') ack({ ok: true, ...state });
  });

  socket.on('vote:submit', ({ vote }) => {
    const room = getRoom(socket);
    if (!room) return;
    if (room.phase !== 'voting') {
      emitErr(socket, 'voteClosed');
      return;
    }
    const v = Number(vote);
    if (![0, 5, 10].includes(v)) {
      emitErr(socket, 'badVote');
      return;
    }

    if (socket.data.isHost && room.hostId === socket.id) {
      if (room.hostHasVoted) {
        emitErr(socket, 'voted');
        return;
      }
      room.hostHasVoted = true;
      room.hostVote = v;
      socket.emit('vote:locked', { vote: v });
      io.to(room.code).emit('room:update', publicRoom(room));
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) return;
    if (player.hasVoted) {
      emitErr(socket, 'voted');
      return;
    }
    player.hasVoted = true;
    player.vote = v;
    socket.emit('vote:locked', { vote: v });
    io.to(room.code).emit('room:update', publicRoom(room));
  });

  socket.on('round:process', () => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) {
      emitErr(socket, 'notHost');
      return;
    }
    if (room.phase === 'round_end') {
      emitErr(socket, 'useNextRoute');
      return;
    }
    if (room.phase === 'game_over') {
      emitErr(socket, 'ended');
      return;
    }
    if (room.phase !== 'voting') {
      emitErr(socket, 'notVoting');
      return;
    }

    let total = 0;
    if (room.hostHasVoted && room.hostVote != null) total += room.hostVote;
    for (const p of room.players.values()) {
      if (p.hasVoted && p.vote != null) total += p.vote;
    }

    room.phase = 'round_end';

    const { path, endFloor, endDirection } = computeLiftPath(
      room.currentFloor,
      total,
      room.liftDirection ?? 1
    );
    room.currentFloor = endFloor;
    room.liftDirection = endDirection;

    io.to(room.code).emit('round:animate', {
      path,
      endFloor,
      roundTotal: total,
      round: room.round,
      coneStep: room.coneStep,
      startFloor: path[0],
      liftSpeedMult: room.liftSpeedMult === 2 ? 2 : 1,
    });
    io.to(room.code).emit('room:update', publicRoom(room));
    socket.emit('action:ok', { action: 'process', endFloor, roundTotal: total });
  });

  socket.on('lift:speed', ({ mult }) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) {
      emitErr(socket, 'notHost');
      return;
    }
    if (room.phase === 'game_over') {
      emitErr(socket, 'ended');
      return;
    }
    room.liftSpeedMult = Number(mult) === 2 ? 2 : 1;
    io.to(room.code).emit('lift:speed', { mult: room.liftSpeedMult });
    io.to(room.code).emit('room:update', publicRoom(room));
    socket.emit('action:ok', { action: 'liftSpeed', mult: room.liftSpeedMult });
  });

  socket.on('round:next', () => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) {
      emitErr(socket, 'notHost');
      return;
    }
    if (room.phase !== 'round_end') {
      emitErr(socket, 'useNext');
      return;
    }

    clearVotes(room);

    if (room.round >= 9) {
      room.phase = 'game_over';
      io.to(room.code).emit('game:over', publicRoom(room));
      socket.emit('action:ok', { action: 'end' });
      return;
    }

    room.round += 1;
    room.coneStep = Math.min(room.round - 1, 8);
    room.phase = 'voting';

    io.to(room.code).emit('round:ready', publicRoom(room));
    socket.emit('action:ok', { action: 'next', round: room.round });
  });

  socket.on('game:end', () => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) {
      emitErr(socket, 'notHost');
      return;
    }
    clearVotes(room);
    room.phase = 'game_over';
    io.to(room.code).emit('game:over', publicRoom(room));
    socket.emit('action:ok', { action: 'end' });
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket);
    if (!room) return;

    if (socket.id === room.hostId) {
      io.to(room.code).emit('room:closed', { message: 'Host ออกจากห้องแล้ว' });
      rooms.delete(room.code);
      return;
    }

    room.players.delete(socket.id);
    io.to(room.code).emit('room:update', publicRoom(room));
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Lift game listening on ${HOST}:${PORT}`);
});
