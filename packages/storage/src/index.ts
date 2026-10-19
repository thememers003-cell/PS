// ============================================================
// XPOS File Storage — MinIO/S3 compatible storage wrapper
// ============================================================

import * as Minio from 'minio';
import { Readable } from 'stream';

export interface StorageConfig {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

export class StorageService {
  private client: Minio.Client;
  private bucket: string;

  constructor(config: StorageConfig) {
    this.client = new Minio.Client({
      endPoint: config.endpoint,
      port: config.port,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      useSSL: config.useSSL,
    });
    this.bucket = config.bucket;
  }

  async initialize(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      console.log(`📦 Created bucket: ${this.bucket}`);
    }
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
      ...metadata,
    });
    return key;
  }

  async uploadStream(
    key: string,
    stream: Readable,
    size: number,
    mimeType: string
  ): Promise<string> {
    await this.client.putObject(this.bucket, key, stream, size, {
      'Content-Type': mimeType,
    });
    return key;
  }

  async getSignedUrl(key: string, expiresInSeconds: number = 300): Promise<string> {
    return await this.client.presignedGetObject(this.bucket, key, expiresInSeconds);
  }

  async downloadFile(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async deleteFiles(keys: string[]): Promise<void> {
    await this.client.removeObjects(this.bucket, keys);
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async getFileInfo(key: string): Promise<{ size: number; lastModified: Date }> {
    const stat = await this.client.statObject(this.bucket, key);
    return {
      size: stat.size,
      lastModified: stat.lastModified,
    };
  }
}

import * as fs from 'fs';
import * as path from 'path';

export interface IStorageService {
  initialize(): Promise<void>;
  uploadFile(key: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>): Promise<string>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  deleteFiles(keys: string[]): Promise<void>;
  fileExists(key: string): Promise<boolean>;
}

export class LocalStorageService implements IStorageService {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), 'uploads');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async uploadFile(key: string, buffer: Buffer): Promise<string> {
    const filePath = path.join(this.baseDir, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, buffer);
    return key;
  }

  resolveExistingPath(key: string): string {
    const candidates = [
      path.join(this.baseDir, key),
      path.resolve(this.baseDir, '..', key),
      path.resolve(process.cwd(), 'uploads', key),
      path.resolve(process.cwd(), key),
      path.resolve('C:\\Users\\ADMIN\\Desktop\\OU  - XPOS\\apps\\api\\uploads', key),
      path.resolve('C:\\Users\\ADMIN\\Desktop\\OU  - XPOS\\uploads', key),
      path.resolve('C:\\Users\\ADMIN\\Desktop\\OU  - XPOS', key),
      path.resolve(__dirname, '../../../../apps/api/uploads', key),
      path.resolve(__dirname, '../../../../uploads', key),
      path.resolve(__dirname, '../../../../', key),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          return c;
        }
      } catch {}
    }
    return path.join(this.baseDir, key);
  }

  async getSignedUrl(key: string): Promise<string> {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    return `${apiUrl}/api/files/download/${encodeURIComponent(key)}`;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const filePath = this.resolveExistingPath(key);
    return await fs.promises.readFile(filePath);
  }

  getLocalFilePath(key: string): string | null {
    const filePath = this.resolveExistingPath(key);
    return fs.existsSync(filePath) ? filePath : null;
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this.resolveExistingPath(key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  async deleteFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.deleteFile(key);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolveExistingPath(key));
  }
}

export function createStorageService(): IStorageService {
  const driver = process.env.STORAGE_DRIVER || 'local';
  if (driver === 'minio' || driver === 's3') {
    try {
      return new StorageService({
        endpoint: process.env.MINIO_ENDPOINT || 'localhost',
        port: parseInt(process.env.MINIO_PORT || '9000'),
        accessKey: process.env.MINIO_ACCESS_KEY || 'xpos_minio',
        secretKey: process.env.MINIO_SECRET_KEY || 'xpos_minio_secret',
        bucket: process.env.MINIO_BUCKET || 'xpos-documents',
        useSSL: process.env.MINIO_USE_SSL === 'true',
      });
    } catch {
      console.warn('⚠️ MinIO unavailable, falling back to local file storage');
      return new LocalStorageService();
    }
  }
  return new LocalStorageService();
}
