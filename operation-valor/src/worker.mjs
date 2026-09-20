import { DurableObject } from 'cloudflare:workers';
import { AppError, initialState, publicParticipant, register, recordPing, changeExercise, removeParticipant } from './model.mjs';
import { controllerIdentity, requireSameOrigin, readBody, participantToken, newToken, digest, localPreview } from './auth.mjs';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self' https://tile.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
function decorate(response) {
  if (response.status === 101) return response;
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
  return result;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/api/health') return json({ ok: true, app: 'Operation Valor' });
      const admin = path === '/control' || path === '/control/' || path.startsWith('/api/control/');
      const identity = admin ? await controllerIdentity(request, env) : null;
      if (path.startsWith('/api/')) {
        const stub = env.EXERCISE.get(env.EXERCISE.idFromName('operation-valor'));
        const internal = new Headers();
        if (identity) {
          internal.set('X-Controller-Expires', String(identity.exp));
          internal.set('X-Controller', 'verified');
        }
        let token = participantToken(request);
        // Chrome permits Secure localhost cookies; this fallback is limited to local preview.
        if (localPreview(request, env)) token ||= request.headers.get('Cookie')?.match(/(?:^|;\s*)valor-dev=([a-f0-9]{64})(?:;|$)/)?.[1];
        let body;
        if (request.method === 'POST') {
          requireSameOrigin(request, env);
          body = await readBody(request);
          if (path === '/api/join') token ||= newToken();
          internal.set('Content-Type', 'application/json');
        } else if (request.method !== 'GET') throw new AppError('Method not allowed.', 405);
        if (token) internal.set('X-Participant-Hash', await digest(token));
        if (path === '/api/control/live' || path === '/api/team/live') {
          const expected = localPreview(request, env) ? url.origin : env.APP_ORIGIN;
          if (request.headers.get('Origin') !== expected) throw new AppError('Invalid connection origin.', 403);
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new AppError('WebSocket required.', 426);
          internal.set('Upgrade', 'websocket');
        }
        const response = await stub.fetch(new Request(`https://internal${path}`, { method: request.method, headers: internal, body: body === undefined ? undefined : JSON.stringify(body) }));
        if (path === '/api/join' && response.ok) {
          const result = decorate(response);
          const cookie = localPreview(request, env) ? `valor-dev=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400` : `__Host-valor=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
          result.headers.set('Set-Cookie', cookie);
          return result;
        }
        return decorate(response);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new AppError('Method not allowed.', 405);
      const assetUrl = new URL(request.url);
      if (path === '/') assetUrl.pathname = '/index.html';
      else if (path === '/map' || path === '/map/') assetUrl.pathname = '/map.html';
      else if (path === '/control' || path === '/control/') assetUrl.pathname = '/control.html';
      else if (path === '/control.html') throw new AppError('Use /control to sign in.', 404);
      return decorate(await env.ASSETS.fetch(new Request(assetUrl, request)));
    } catch (error) {
      return json({ error: error instanceof AppError ? error.message : 'Service unavailable. Please try again.' }, error instanceof AppError ? error.status : 503);
    }
  },
};

export class ValorExercise extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    ctx.blockConcurrencyWhile(async () => { this.state = await ctx.storage.get('exercise') || initialState(); });
  }
  snapshot() {
    const { exerciseId, status, startedAt, endedAt, expiresAt } = this.state;
    return { exerciseId, status, startedAt, endedAt, expiresAt, participants: this.state.participants.map(publicParticipant), serverTime: Date.now() };
  }
  async save() { await this.ctx.storage.put('exercise', this.state); }
  socketAllowed(ws) {
    const identity = ws.deserializeAttachment();
    if (!identity || identity.expiresAt <= Date.now()) return false;
    // Existing controller connections have no role field until they reconnect.
    if (!identity.role || identity.role === 'controller') return true;
    return identity.exerciseId === this.state.exerciseId &&
      this.state.participants.some(person => person.tokenHash === identity.tokenHash);
  }
  broadcast() {
    const message = JSON.stringify(this.snapshot());
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (!this.socketAllowed(ws)) ws.close(4001, 'Session ended');
        else ws.send(message);
      } catch { try { ws.close(); } catch {} }
    }
  }
  async alarm() {
    if (this.state.expiresAt && Date.now() >= this.state.expiresAt) {
      this.state = initialState();
      await this.save();
      this.broadcast();
    }
  }
  async fetch(request) {
    try {
      // Serialize exercise changes, including read/modify/write across async storage calls.
      return await this.ctx.blockConcurrencyWhile(async () => {
        try {
        const now = Date.now();
        if (this.state.expiresAt && now >= this.state.expiresAt) await this.alarm();
        const path = new URL(request.url).pathname;
        const hash = request.headers.get('X-Participant-Hash');
        const person = this.state.participants.find(p => p.tokenHash === hash);
        if (path === '/api/session' && request.method === 'GET') {
          return json({ exerciseId: this.state.exerciseId, status: this.state.status, expiresAt: this.state.expiresAt, participant: publicParticipant(person) });
        }
        if (path.startsWith('/api/control/') && request.headers.get('X-Controller') !== 'verified') throw new AppError('Controller sign-in required.', 401);
        const team = path.startsWith('/api/team/');
        if (team && !person) throw new AppError('Join the exercise to view the shared map.', 401);
        if ((path === '/api/control/state' || path === '/api/team/state') && request.method === 'GET') return json(this.snapshot());
        if ((path === '/api/control/live' || path === '/api/team/live') && request.method === 'GET') {
          const connections = this.ctx.getWebSockets();
          const matching = connections.filter(ws => {
            const identity = ws.deserializeAttachment();
            return team ? identity?.tokenHash === hash : identity?.role !== 'participant';
          });
          if (matching.length >= (team ? 3 : 20) || connections.length >= 320) throw new AppError('Too many map connections. Close another map tab and retry.', 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment(team ? {
            role: 'participant', tokenHash: hash, exerciseId: this.state.exerciseId, expiresAt: this.state.expiresAt,
          } : { role: 'controller', expiresAt: Number(request.headers.get('X-Controller-Expires')) * 1000 });
          pair[1].send(JSON.stringify(this.snapshot()));
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        if (request.method !== 'POST') throw new AppError('Not found.', 404);
        const body = await request.json();
        if (path === '/api/join') {
          if (!hash) throw new AppError('Could not create a participant session.', 401);
          const joined = register(this.state, body.name, hash, now, body.group);
          await this.save(); this.broadcast();
          return json({ exerciseId: this.state.exerciseId, status: this.state.status, participant: publicParticipant(joined) });
        }
        if (path === '/api/ping') {
          const updated = recordPing(this.state, hash, body.exerciseId, body, now);
          await this.save(); this.broadcast();
          return json({ exerciseId: this.state.exerciseId, participant: publicParticipant(updated) });
        }
        if (path === '/api/control/remove') {
          if (body.exerciseId !== this.state.exerciseId) throw new AppError('The exercise changed. Refresh before continuing.', 409);
          removeParticipant(this.state, body.number);
          await this.save(); this.broadcast();
          return json(this.snapshot());
        }
        if (path === '/api/control/action') {
          if (body.exerciseId !== this.state.exerciseId) throw new AppError('The exercise changed. Refresh before continuing.', 409);
          changeExercise(this.state, body.action, now);
          await this.save();
          if (this.state.expiresAt) await this.ctx.storage.setAlarm(this.state.expiresAt);
          else await this.ctx.storage.deleteAlarm();
          this.broadcast();
          return json(this.snapshot());
        }
        throw new AppError('Not found.', 404);
        } catch (error) {
          // Expected validation errors must not reset the object or disconnect controllers.
          if (error instanceof AppError) return json({ error: error.message }, error.status);
          throw error;
        }
      });
    } catch (error) {
      return json({ error: error instanceof AppError ? error.message : 'Service unavailable. Please try again.' }, error instanceof AppError ? error.status : 503);
    }
  }
  async webSocketMessage(ws, message) {
    if (!this.socketAllowed(ws)) return ws.close(4001, 'Session ended');
    if (message === 'ping') ws.send('pong');
    else ws.close(1008, 'Unsupported message');
  }
  async webSocketClose(ws, code) { ws.close(code); }
  async webSocketError(ws) { try { ws.close(1011, 'Connection interrupted'); } catch {} }
}
