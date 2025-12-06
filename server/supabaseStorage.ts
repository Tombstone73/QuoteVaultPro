/**
 * Supabase Storage Service
 * 
 * Handles file uploads and downloads using Supabase Storage.
 * This replaces the Replit-specific ObjectStorageService when running locally
 * or when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// Lazy-initialized Supabase client
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.'
      );
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseClient;
}

export class SupabaseStorageService {
  private bucket: string;

  constructor(bucket?: string) {
    this.bucket = bucket || SUPABASE_BUCKET;
  }

  /**
   * Generate a signed upload URL for client-side uploads
   * @param options Upload options
   * @returns Signed URL and path information
   */
  async getSignedUploadUrl(options?: {
    folder?: string;
    filename?: string;
    expiresIn?: number; // seconds, default 900 (15 min)
  }): Promise<{
    url: string;
    path: string;
    token: string;
  }> {
    const client = getSupabaseClient();
    const folder = options?.folder || 'uploads';
    const filename = options?.filename || randomUUID();
    const expiresIn = options?.expiresIn || 900;

    const objectPath = `${folder}/${filename}`;

    const { data, error } = await client.storage
      .from(this.bucket)
      .createSignedUploadUrl(objectPath);

    if (error) {
      console.error('Supabase signed URL error:', error);
      throw new Error(`Failed to create signed upload URL: ${error.message}`);
    }

    return {
      url: data.signedUrl,
      path: objectPath,
      token: data.token,
    };
  }

  /**
   * Get a signed download URL for a file
   * @param path File path in the bucket
   * @param expiresIn Expiry time in seconds (default 3600 = 1 hour)
   */
  async getSignedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
    const client = getSupabaseClient();

    const { data, error } = await client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      throw new Error(`Failed to create signed download URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  /**
   * Upload a file directly from the server
   * @param path File path in the bucket
   * @param buffer File buffer
   * @param contentType MIME type
   */
  async uploadFile(
    path: string,
    buffer: Buffer,
    contentType: string
  ): Promise<{
    path: string;
    publicUrl: string | null;
  }> {
    const client = getSupabaseClient();

    const { data, error } = await client.storage
      .from(this.bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    // Get public URL if bucket is public
    const { data: urlData } = client.storage
      .from(this.bucket)
      .getPublicUrl(data.path);

    return {
      path: data.path,
      publicUrl: urlData?.publicUrl || null,
    };
  }

  /**
   * Delete a file from storage
   * @param path File path in the bucket
   */
  async deleteFile(path: string): Promise<boolean> {
    const client = getSupabaseClient();

    const { error } = await client.storage
      .from(this.bucket)
      .remove([path]);

    if (error) {
      console.error('Failed to delete file:', error);
      return false;
    }

    return true;
  }

  /**
   * List files in a folder
   * @param folder Folder path
   */
  async listFiles(folder: string): Promise<Array<{
    name: string;
    id: string;
    createdAt: string;
    metadata: Record<string, any>;
  }>> {
    const client = getSupabaseClient();

    const { data, error } = await client.storage
      .from(this.bucket)
      .list(folder);

    if (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }

    return data.map((file) => ({
      name: file.name,
      id: file.id,
      createdAt: file.created_at,
      metadata: file.metadata || {},
    }));
  }

  /**
   * Check if a file exists
   * @param path File path in the bucket
   */
  async fileExists(path: string): Promise<boolean> {
    const client = getSupabaseClient();
    
    // Extract folder and filename
    const parts = path.split('/');
    const filename = parts.pop() || '';
    const folder = parts.join('/');

    const { data, error } = await client.storage
      .from(this.bucket)
      .list(folder, {
        search: filename,
        limit: 1,
      });

    if (error) {
      return false;
    }

    return data.some((file) => file.name === filename);
  }

  /**
   * Get public URL for a file (only works if bucket is public)
   * @param path File path in the bucket
   */
  getPublicUrl(path: string): string {
    const client = getSupabaseClient();
    const { data } = client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
