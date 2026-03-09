import { createHash } from 'crypto';
import log from 'electron-log';
import { db as appDb } from './db';

// Document metadata interface
export interface DocumentMetadata {
    id: string;                    // hash of raw PDF bytes
    file_path: string;
    file_name: string;
    file_size: number;
    total_chunks: number;
    created_at: string;
    last_accessed: string;
}

// Initialize document registry table
export function initDocumentRegistry(): void {
    appDb.exec(`
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            total_chunks INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    appDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_documents_last_accessed 
        ON documents(last_accessed)
    `);
}

/**
 * Compute SHA-256 hash of raw PDF bytes
 */
export function hashPdfData(pdfData: Uint8Array): string {
    return createHash('sha256').update(pdfData).digest('hex');
}

/**
 * Check if document already exists by hash
 */
export function getDocumentByHash(hash: string): DocumentMetadata | null {
    const stmt = appDb.prepare('SELECT * FROM documents WHERE id = ?');
    return stmt.get(hash) as DocumentMetadata | null;
}

/**
 * Register new document or update existing
 */
export function registerDocument(
    hash: string, 
    filePath: string, 
    fileName: string, 
    fileSize: number,
    totalChunks: number
): void {
    try {
        log.info(`Registering document to DB: ${fileName}, hash: ${hash.substring(0, 8)}...`);
        const stmt = appDb.prepare(`
            INSERT INTO documents (id, file_path, file_name, file_size, total_chunks, last_accessed)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                file_path = excluded.file_path,
                file_name = excluded.file_name,
                last_accessed = CURRENT_TIMESTAMP
        `);
        const result = stmt.run(hash, filePath, fileName, fileSize, totalChunks);
        log.info(`Registered document: ${fileName}, changes: ${result.changes}`);
    } catch (error) {
        log.error('Error registering document:', error);
        throw error;
    }
}

/**
 * Update last_accessed timestamp
 */
export function touchDocument(hash: string): void {
    const stmt = appDb.prepare(`
        UPDATE documents SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(hash);
}

/**
 * Get all registered documents (for UI listing)
 */
export function getAllDocuments(): DocumentMetadata[] {
    try {
        const stmt = appDb.prepare(`
            SELECT * FROM documents ORDER BY last_accessed DESC
        `);
        const docs = stmt.all() as DocumentMetadata[];
        log.info(`getAllDocuments returned ${docs.length} documents`);
        return docs;
    } catch (error) {
        log.error('Error in getAllDocuments:', error);
        return [];
    }
}

/**
 * Delete document from registry (and optionally its vectors)
 */
export function deleteDocument(hash: string): void {
    const stmt = appDb.prepare('DELETE FROM documents WHERE id = ?');
    stmt.run(hash);
}

/**
 * Get documents filtered by directory path
 */
export function getDocumentsByPath(currentPath: string): DocumentMetadata[] {
    try {
        if (!currentPath) {
            return getAllDocuments();
        }
        const stmt = appDb.prepare(`
            SELECT * FROM documents 
            WHERE file_path LIKE ? 
            ORDER BY last_accessed DESC
        `);
        const docs = stmt.all(`${currentPath}%`) as DocumentMetadata[];
        return docs;
    } catch (error) {
        log.error('Error in getDocumentsByPath:', error);
        return [];
    }
}

/**
 * Get document count
 */
export function getDocumentCount(): number {
    const stmt = appDb.prepare('SELECT COUNT(*) as count FROM documents');
    const result = stmt.get() as { count: number };
    return result.count;
}

// Initialize on module load
initDocumentRegistry();
