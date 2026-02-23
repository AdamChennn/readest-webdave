import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { WebDAVSyncSettings } from '@/types/settings';
import { SyncUtilLike } from '../types';
import { SyncTaskQueue } from '../SyncTaskQueue';
import { WebDAVUnavailableError } from '../errors';

const textEncoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const toBasicAuth = (username: string, password: string) => {
  return `Basic ${bytesToBase64(textEncoder.encode(`${username}:${password}`))}`;
};

const normalizeRoot = (url: string) => url.replace(/\/+$/, '');
const normalizeSegment = (seg: string) => seg.replace(/^\/+|\/+$/g, '');

const ensureLeadingSlash = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const joinRemotePath = (...segments: string[]) => {
  const joined = segments
    .filter(Boolean)
    .map(normalizeSegment)
    .filter(Boolean)
    .join('/');
  return ensureLeadingSlash(joined);
};

const toArrayBuffer = async (content: Blob | ArrayBuffer | string): Promise<ArrayBuffer | string> => {
  if (typeof content === 'string') return content;
  if (content instanceof Blob) return await content.arrayBuffer();
  return content;
};

export class WebDAVSyncUtil implements SyncUtilLike {
  private settings: WebDAVSyncSettings;
  private queue: SyncTaskQueue;
  private authHeader: string;
  private rootUrl: string;

  constructor(settings: WebDAVSyncSettings) {
    this.settings = settings;
    this.queue = new SyncTaskQueue(3);
    this.authHeader = toBasicAuth(settings.username, settings.password);
    this.rootUrl = normalizeRoot(settings.url);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const reqInit = {
      ...init,
      headers: {
        Authorization: this.authHeader,
        ...init.headers,
      },
    } as RequestInit;
    return isTauriAppPlatform() ? await tauriFetch(url, reqInit) : await fetch(url, reqInit);
  }

  private urlFor(remotePath: string) {
    return `${this.rootUrl}${remotePath}`;
  }

  private async retryOperation<T>(operation: () => Promise<T>, retries = 3): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (attempts >= retries) {
          this.queue.fail();
          throw new WebDAVUnavailableError(
            error instanceof Error ? error.message : 'WebDAV sync unavailable',
          );
        }
        attempts++;
        const delay = 1000 * Math.pow(2, attempts);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async ensureRemoteDir(type: string) {
    const parts = [this.settings.baseFolder, type].map(normalizeSegment).filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = `${current}/${part}`;
      const url = this.urlFor(current);
      const res = await this.request(url, { method: 'MKCOL' });
      if (res.ok || res.status === 405 || res.status === 409) continue;
      throw new Error(`Failed to ensure WebDAV directory: ${url} (${res.status})`);
    }
  }

  private async listHrefs(type: string): Promise<string[]> {
    await this.ensureRemoteDir(type);
    const remoteDir = joinRemotePath(this.settings.baseFolder, type);
    const url = this.urlFor(remoteDir);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;
    const res = await this.request(url, {
      method: 'PROPFIND',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });
    if (!res.ok && res.status !== 207) {
      throw new Error(`WebDAV PROPFIND failed: ${res.status}`);
    }
    const xml = await res.text();
    if (!xml) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.getElementsByTagNameNS('DAV:', 'href')).map((el) => el.textContent || '');
  }

  async uploadFile(fileName: string, type: string, content: Blob | ArrayBuffer | string) {
    return await this.queue.addTask(async () =>
      this.retryOperation(async () => {
        await this.ensureRemoteDir(type);
        const remotePath = joinRemotePath(this.settings.baseFolder, type, fileName);
        const data = await toArrayBuffer(content);
        const res = await this.request(this.urlFor(remotePath), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: data as BodyInit,
        });
        if (!res.ok) throw new Error(`WebDAV PUT failed: ${res.status}`);
        return true;
      }),
    );
  }

  async downloadFile(fileName: string, type: string) {
    return await this.queue.addTask(async () =>
      this.retryOperation(async () => {
        const remotePath = joinRemotePath(this.settings.baseFolder, type, fileName);
        const res = await this.request(this.urlFor(remotePath), {
          method: 'GET',
        });
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(`WebDAV GET failed: ${res.status}`);
        const buffer = await res.arrayBuffer();
        this.queue.setDownloadedSize(buffer.byteLength);
        return buffer;
      }),
    );
  }

  async listFiles(type: string) {
    return await this.queue.addTask(async () =>
      this.retryOperation(async () => {
        const hrefs = await this.listHrefs(type);
        const prefix = joinRemotePath(this.settings.baseFolder, type);
        const prefixEncoded = `${prefix}/`;
        const names = hrefs
          .map((href) => {
            let path = decodeURIComponent(href);
            if (path.startsWith('http://') || path.startsWith('https://')) {
              try {
                path = new URL(path).pathname;
              } catch {}
            }
            if (!path.startsWith(prefixEncoded)) return '';
            const rest = path.slice(prefixEncoded.length);
            if (!rest || rest.includes('/')) return '';
            return rest;
          })
          .filter(Boolean);
        return Array.from(new Set(names));
      }),
    );
  }

  async deleteFile(fileName: string, type: string) {
    return await this.queue.addTask(async () =>
      this.retryOperation(async () => {
        const remotePath = joinRemotePath(this.settings.baseFolder, type, fileName);
        const res = await this.request(this.urlFor(remotePath), { method: 'DELETE' });
        if (res.ok || res.status === 404) return true;
        throw new Error(`WebDAV DELETE failed: ${res.status}`);
      }),
    );
  }

  async isExist(fileName: string, type: string) {
    return await this.queue.addTask(async () =>
      this.retryOperation(async () => {
        const remotePath = joinRemotePath(this.settings.baseFolder, type, fileName);
        const res = await this.request(this.urlFor(remotePath), { method: 'HEAD' });
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(`WebDAV HEAD failed: ${res.status}`);
        return true;
      }),
    );
  }

  getStats() {
    return this.queue.getStats();
  }

  resetCounters() {
    this.queue.resetCounters();
  }

  getDownloadedSize() {
    return this.queue.getDownloadedSize();
  }

  static getAuthUrl(url: string) {
    return normalizeRoot(url);
  }
}
