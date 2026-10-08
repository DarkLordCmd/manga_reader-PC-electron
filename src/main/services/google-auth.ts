import { BrowserWindow, session, safeStorage } from 'electron';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { denyAllPermissions } from '../security';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_SCOPE,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
} from './google-config';

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function buildCodeVerifier(): string {
  return base64url(randomBytes(48));
}
export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}
export function buildAuthUrl(clientId: string, redirectUri: string, challenge: string): string {
  const u = new URL(GOOGLE_AUTH_ENDPOINT);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPE);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}
export function parseLoopbackQuery(url: string): { code: string | null; error: string | null } {
  try {
    const u = new URL(url);
    return { code: u.searchParams.get('code'), error: u.searchParams.get('error') };
  } catch {
    return { code: null, error: 'bad_redirect' };
  }
}

interface StoredTokens {
  refresh_token: string;
  access_token: string;
  expires_at: number;
  email: string;
}

export class GoogleAuth {
  private path: string;
  private tokens: StoredTokens | null;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'google-auth.bin');
    this.tokens = this.read();
  }

  private read(): StoredTokens | null {
    if (!existsSync(this.path)) return null;
    try {
      const raw = readFileSync(this.path);
      if (!safeStorage.isEncryptionAvailable()) return null;
      const text = safeStorage.decryptString(raw);
      return JSON.parse(text) as StoredTokens;
    } catch {
      return null;
    }
  }

  private write(t: StoredTokens | null): void {
    this.tokens = t;
    if (!t) {
      try {
        rmSync(this.path);
      } catch {
        /* ignore */
      }
      return;
    }
    mkdirSync(join(this.path, '..'), { recursive: true });
    const text = JSON.stringify(t);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование ОС недоступно — вход через Google невозможен');
    writeFileSync(this.path, safeStorage.encryptString(text));
  }

  status(): { authed: boolean; email: string | null; configured: boolean } {
    return { authed: !!this.tokens?.refresh_token, email: this.tokens?.email ?? null, configured: !!GOOGLE_CLIENT_SECRET };
  }

  private captureCode(challenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let win: BrowserWindow | null = null;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const server = createServer((req, res) => {
        const parsed = parseLoopbackQuery(`http://127.0.0.1${req.url ?? '/'}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif">Можно закрыть окно и вернуться в приложение.</body></html>');
        try {
          server.close();
        } catch {
          /* ignore */
        }
        if (parsed.code) done(() => resolve({ code: parsed.code!, redirectUri }));
        else
          done(() =>
            reject(
              new Error(
                parsed.error === 'access_denied' ? 'Доступ отклонён пользователем' : `Ошибка авторизации: ${parsed.error ?? 'unknown'}`,
              ),
            ),
          );
        if (win && !win.isDestroyed()) win.close();
      });
      server.on('error', (e) => done(() => reject(e)));
      let redirectUri = '';
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          done(() => reject(new Error('Не удалось запустить loopback-сервер')));
          return;
        }
        redirectUri = `http://127.0.0.1:${addr.port}`;
        denyAllPermissions(session.fromPartition('persist:google-oauth'));
        win = new BrowserWindow({
          width: 520,
          height: 720,
          title: 'Вход через Google',
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:google-oauth',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event, url) => {
          let ok = false;
          try {
            const u = new URL(url);
            ok = u.hostname === 'accounts.google.com' || u.hostname === '127.0.0.1' || u.hostname === 'localhost';
          } catch {
            ok = false;
          }
          if (!ok) event.preventDefault();
        });
        win.on('closed', () => {
          try {
            server.close();
          } catch {
            /* ignore */
          }
          done(() => reject(new Error('Окно входа закрыто')));
        });
        void win.loadURL(buildAuthUrl(GOOGLE_CLIENT_ID, redirectUri, challenge));
      });
    });
  }

  async login(): Promise<{ email: string }> {
    if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET не задан при сборке — вход через Google недоступен');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование ОС недоступно — вход через Google невозможен');
    const verifier = buildCodeVerifier();
    const challenge = codeChallenge(verifier);
    const { code, redirectUri } = await this.captureCode(challenge);

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!res.ok) throw new Error(`Обмен кода не удался (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    if (!tok.refresh_token) throw new Error('Google не выдал refresh-token (нужен prompt=consent)');
    let email = '';
    try {
      const ui = await fetch(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (ui.ok) email = ((await ui.json()) as { email?: string }).email ?? '';
    } catch {
      /* email необязателен */
    }
    this.write({ refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000, email });
    return { email };
  }

  async getAccessToken(force = false): Promise<string> {
    if (!GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET не задан при сборке — обновление токена Google недоступно');
    const t = this.tokens;
    if (!t) throw new Error('Не выполнен вход в Google');
    if (!force && t.access_token && Date.now() < t.expires_at - 60_000) return t.access_token;
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: t.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) throw new Error(`Обновление токена не удалось (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    const tok = (await res.json()) as { access_token: string; expires_in: number };
    this.write({ ...t, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 });
    return tok.access_token;
  }

  async logout(): Promise<void> {
    const t = this.tokens;
    if (t?.refresh_token) {
      try {
        await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' });
      } catch {
        /* ignore */
      }
    }
    this.write(null);
  }
}
