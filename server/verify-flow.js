/**
 * ทดสอบ flow พื้นฐานบน server (รัน: node server/verify-flow.js)
 * ต้องมี server รันที่พอร์ต 3000 ก่อน หรือสคริปต์จะสตาร์ทชั่วคราวเอง
 */
const http = require('http');
const { io } = require('socket.io-client');

const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:3000';

function getHealth() {
  return new Promise((resolve, reject) => {
    http
      .get(`${BASE}/api/health`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function runSocketTest() {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], timeout: 5000 });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket timeout'));
    }, 8000);

    socket.on('connect', () => {
      socket.emit('room:create', { pin: '!Yeswecan' });
    });

    socket.on('room:joined', (state) => {
      if (!state.isHost || !state.code) {
        clearTimeout(timer);
        socket.close();
        reject(new Error('room:create failed'));
        return;
      }
      socket.emit('game:go', {}, (ack) => {
        clearTimeout(timer);
        socket.close();
        if (ack?.ok && ack.phase === 'voting') resolve(ack);
        else reject(new Error(`game:go failed: ${JSON.stringify(ack)}`));
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(err.message || 'socket error'));
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

(async () => {
  try {
    const health = await getHealth();
    if (!health.ok || !health.gameGo) throw new Error(`health bad: ${JSON.stringify(health)}`);
    console.log('OK  /api/health', health);

    const ack = await runSocketTest();
    console.log('OK  game:go ack', { code: ack.code, phase: ack.phase, round: ack.round });
    console.log('\nAll verify checks passed.');
    process.exit(0);
  } catch (e) {
    console.error('FAIL', e.message);
    console.error('\nรัน 2-เปิดเกม.bat ก่อน แล้วลอง node server/verify-flow.js อีกครั้ง');
    process.exit(1);
  }
})();
