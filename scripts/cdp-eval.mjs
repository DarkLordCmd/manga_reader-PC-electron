// Minimal CDP page driver for smoke tests: connect to an Electron page ws,
// run ONE Runtime.evaluate, print JSON result. Node 26 has a global WebSocket.
const [, , WS, EXPR] = process.argv;

const ws = new WebSocket(WS, { maxPayload: 256 * 1024 * 1024 });
let id = 1;
let out = '';

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = id++;
    const handler = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === mid) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener('open', async () => {
  try {
    const r = await send('Runtime.evaluate', {
      expression: EXPR,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    out = r?.result?.value;
    if (r?.result?.subtype === 'error') out = `ERROR: ${JSON.stringify(r.result)}`;
  } catch (e) {
    out = `CDP_ERR: ${e.message}`;
  }
  console.log(JSON.stringify(out));
  ws.close();
  process.exit(0);
});
ws.addEventListener('error', (e) => {
  console.log('WS_ERR');
  process.exit(1);
});
setTimeout(() => {
  console.log('TIMEOUT');
  process.exit(1);
}, 60000);
