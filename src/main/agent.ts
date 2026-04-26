import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { OllamaEmbeddings } from "@langchain/ollama";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createAgent, tool } from "langchain";
import { LibSQLVectorStore } from "@langchain/community/vectorstores/libsql";
import { createClient } from "@libsql/client";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import z from "zod";
import { getDefaultApiKey } from "./keyManager";
import {
    hashPdfData,
    getDocumentByHash,
    registerDocument,
    touchDocument,
    getAllDocuments,
    getDocumentsByPath,
    deleteDocument,
    updateDocumentPath
} from "./documentRegistry";
import { db } from './db';
import { app, dialog } from 'electron';
import { join, dirname } from 'path';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs';
import log from 'electron-log';


async function getModel() {
    const { key, model, baseUrl, provider } = await getDefaultApiKey();
    if (!model || !key) throw new Error('Model or API key is missing');

    const isLocal = provider === 'local';

    if (isLocal) {
        return new ChatOllama({
            model,
            baseUrl,
            temperature: 0.1,
        })
    }

    const isDeepSeek = provider === 'deepseek';
    const defaultBaseUrl = isDeepSeek ? "https://api.deepseek.com/v1" : "https://openrouter.ai/api/v1";

    return new ChatOpenAI({
        model,
        apiKey: key,
        configuration: {
            baseURL: baseUrl || defaultBaseUrl,
        },
    });
}

const userDataPath = app.getPath('userData');
const vectorDbPath = join(userDataPath, 'vectors.db');

export { db };
export const saver = new SqliteSaver(db);

// all-minilm produces 384-dimensional embeddings
const EMBEDDING_DIM = 384;
const TABLE_NAME = "pdf_vectors";
const COLUMN_NAME = "embedding";

// Create libsql client for vector store
const libsqlClient = createClient({
    url: `file:${vectorDbPath}`,
});

// Initialize vector store table
async function initVectorStore() {
    await libsqlClient.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            metadata TEXT,
            ${COLUMN_NAME} F32_BLOB(${EMBEDDING_DIM})
        )
    `);

    await libsqlClient.execute(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_${COLUMN_NAME} 
        ON ${TABLE_NAME}(libsql_vector_idx(${COLUMN_NAME}))
    `);
}

// Initialize on module load
initVectorStore().catch(err => log.error('Failed to init vector store:', err));

const embeddings = new OllamaEmbeddings({
    model: "all-minilm:latest",
    baseUrl: "http://localhost:11434",
});

// LibSQL vector store - persists to disk, no memory issues
export const vectorStore = new LibSQLVectorStore(embeddings, {
    db: libsqlClient,
    table: TABLE_NAME,
    column: COLUMN_NAME,
});

// Text splitter - sized for all-minilm's 256-token context (~500 chars)
// We use 400 as a safe upper bound since some characters map to multiple tokens.
const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 40,
});

// Current document tracking
let currentDocumentId: string | null = null;

export function getCurrentDocumentId(): string | null {
    return currentDocumentId;
}

export function setCurrentDocumentId(hash: string | null): void {
    currentDocumentId = hash;
    log.info(`Current document set to: ${hash ? hash.substring(0, 8) + '...' : 'null'}`);
}

/**
 * Delete all vectors for a specific document
 */
async function deleteVectorsForDocument(documentId: string): Promise<void> {
    // LibSQLVectorStore doesn't have a direct metadata filter delete
    // We'll need to query and delete by IDs
    try {
        // This is a workaround - query to find matching documents
        const results = await vectorStore.similaritySearch("test", 1000);
        const docsToDelete = results
            .filter((doc: Document) => doc.metadata.document_id === documentId)
            .map((doc: Document) => doc.metadata.chunk_id as string)
            .filter(Boolean);

        if (docsToDelete.length > 0) {
            await vectorStore.delete({ ids: docsToDelete });
            log.info(`Deleted ${docsToDelete.length} vectors for document ${documentId.substring(0, 8)}...`);
        }
    } catch (error) {
        log.error('Error deleting vectors:', error);
    }
}

/**
 * Process and embed PDF with hash-based deduplication
 */
export async function processPdfDocument(
    pdfData: Uint8Array,
    filePath: string,
    fileName: string,
    onProgress?: (progress: number) => void
): Promise<{ hash: string; isNew: boolean; chunkCount: number }> {
    const hash = hashPdfData(pdfData);
    const existingDoc = getDocumentByHash(hash);

    // Check if document already exists
    if (existingDoc) {
        log.info(`Document already embedded: ${fileName} (${hash.substring(0, 8)}...)`);
        touchDocument(hash);
        setCurrentDocumentId(hash);
        return { hash, isNew: false, chunkCount: existingDoc.total_chunks };
    }

    // New document - need to embed
    log.info(`Embedding new document: ${fileName} (${hash.substring(0, 8)}...)`);

    // Extract text using PDFLoader
    const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
    const buffer = Buffer.from(pdfData);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    const loader = new PDFLoader(blob, { parsedItemSeparator: "" });
    const docs = await loader.load();
    const pages = docs.map(doc => doc.pageContent);

    // Embed pages
    const chunkCount = await embedPagesForDocument(pages, hash, onProgress);

    // Register in document registry
    registerDocument(hash, filePath, fileName, pdfData.length, chunkCount);
    setCurrentDocumentId(hash);

    return { hash, isNew: true, chunkCount };
}

/**
 * Embed pages for a specific document
 */
async function embedPagesForDocument(pages: string[], documentId: string, onProgress?: (progress: number) => void): Promise<number> {
    const BATCH_SIZE = 10;
    let globalChunkIndex = 0;

    // Step 1: Split all pages into chunks first (CPU-only, fast)
    const allChunks: Document[] = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const pageText = pages[pageIndex];
        if (!pageText || pageText.trim().length === 0) continue;

        const pageChunks = await textSplitter.splitText(pageText);

        for (const chunk of pageChunks) {
            allChunks.push(new Document({
                pageContent: chunk,
                metadata: {
                    document_id: documentId,
                    page_index: pageIndex,
                    chunk_index: globalChunkIndex,
                },
            }));
            globalChunkIndex++;
        }
    }

    log.info(`Split into ${allChunks.length} chunks, embedding in batches of ${BATCH_SIZE}...`);

    // Step 2: Process sequentially in batches
    let completedChunks = 0;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);
        try {
            log.info(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)} (${batch.length} chunks)`);
            await vectorStore.addDocuments(batch);
            completedChunks += batch.length;
            log.info(`Embedded ${completedChunks}/${allChunks.length} chunks`);
        } catch (error) {
            log.error(`Failed to embed batch starting at chunk ${i}. Error:`, error);
            // If a batch fails, try smaller units or log the content length
            for (const doc of batch) {
                log.error(`Chunk length: ${doc.pageContent.length}, content snippet: ${doc.pageContent.substring(0, 50)}...`);
            }
            throw error; // Re-throw to inform the caller
        }

        if (onProgress) {
            const progressPercentage = Math.round((completedChunks / allChunks.length) * 100);
            onProgress(progressPercentage);
        }
    }

    log.info(`Finished embedding: ${allChunks.length} total chunks`);
    return allChunks.length;
}

/**
 * Switch current document without re-embedding
 */
export function switchToDocument(hash: string): boolean {
    const doc = getDocumentByHash(hash);
    if (!doc) {
        log.error(`Document not found: ${hash}`);
        return false;
    }

    touchDocument(hash);
    setCurrentDocumentId(hash);
    return true;
}

/**
 * Get list of all embedded documents
 */
export function getEmbeddedDocuments() {
    return getAllDocuments();
}

/**
 * Delete a document and its vectors
 */
export async function deleteEmbeddedDocument(hash: string): Promise<boolean> {
    try {
        await deleteVectorsForDocument(hash);
        deleteDocument(hash);
        if (currentDocumentId === hash) {
            currentDocumentId = null;
        }
        return true;
    } catch (error) {
        log.error('Error deleting document:', error);
        return false;
    }
}

/**
 * Search current document only
 */
async function searchCurrentDocument(query: string, k: number = 15): Promise<string> {
    if (!currentDocumentId) {
        return "No document is currently open.";
    }

    try {
        // Search all then filter by current document
        const results = await vectorStore.similaritySearch(query, k * 3);
        const filtered = results.filter((doc: Document) =>
            doc.metadata.document_id === currentDocumentId
        ).slice(0, k);

        if (filtered.length === 0) {
            return "No relevant content found in the current document.";
        }

        return filtered.map(doc => doc.pageContent).join('\n\n');
    } catch (error) {
        log.error('Error searching current document:', error);
        return 'Error searching document.';
    }
}

/**
 * Search all documents
 */
async function searchAllDocuments(query: string, k: number = 15): Promise<string> {
    try {
        const results = await vectorStore.similaritySearch(query, k);

        if (results.length === 0) {
            return "No relevant content found in any document.";
        }

        return results.map(doc => {
            const source = doc.metadata.document_id
                ? `[From: ${doc.metadata.document_id.substring(0, 8)}...]\n`
                : '';
            return source + doc.pageContent;
        }).join('\n\n');
    } catch (error) {
        log.error('Error searching all documents:', error);
        return 'Error searching documents.';
    }
}

/**
 * Search documents in the current directory and its subdirectories
 */
async function searchDirectoryDocuments(query: string, currentPath: string, k: number = 15): Promise<string> {
    if (!currentPath) {
        return "No directory path provided. Please use the global search tool if you intended to search all directories.";
    }

    try {
        // Search more broadly to ensure we get enough results after filtering by directory
        const results = await vectorStore.similaritySearch(query, k * 5);

        // Get all documents that fall under the currentPath
        const allDocs = getAllDocuments();
        const validDocIds = new Set(
            allDocs
                .filter(d => d.file_path && d.file_path.startsWith(currentPath))
                .map(d => d.id)
        );

        const filtered = results.filter((doc: Document) =>
            validDocIds.has(doc.metadata.document_id as string)
        ).slice(0, k);

        if (filtered.length === 0) {
            return `No relevant content found in the current directory (${currentPath}) or its subdirectories.`;
        }

        return filtered.map(doc => {
            const docInfo = allDocs.find(d => d.id === doc.metadata.document_id);
            const source = docInfo
                ? `[From: ${docInfo.file_name}]\n`
                : (doc.metadata.document_id ? `[From: ${doc.metadata.document_id.substring(0, 8)}...]\n` : '');
            return source + doc.pageContent;
        }).join('\n\n');
    } catch (error) {
        log.error('Error searching directory documents:', error);
        return 'Error searching directory documents.';
    }
}

// Tool: Search current document
const searchCurrentDocTool = tool(
    async (input: { query: string }) => {
        const context = await searchCurrentDocument(input.query, 15);
        return context;
    },
    {
        name: "search_current",
        description: "Search ONLY the currently open PDF document for relevant information. Use this as the PRIMARY tool when the user asks about the document they're currently viewing.",
        schema: z.object({
            query: z.string().describe("The search query to find relevant content in the current document"),
        }),
    },
);

// Tool: Search all documents
const searchAllDocsTool = tool(
    async (input: { query: string, request_permission: boolean }) => {
        if (!input.request_permission) {
            return "ACCESS DENIED: You must request permission from the user before searching outside their current folder. Stop and ask the user if they want to search all folders.";
        }
        const context = await searchAllDocuments(input.query, 15);
        return context;
    },
    {
        name: "search_all",
        description: "Search ALL embedded PDF documents in the library globally. CRITICAL: You MUST ask the user for permission before using this tool. Only set request_permission to true IF the user explicitly said yes to searching all folders.",
        schema: z.object({
            query: z.string().describe("The search query to find relevant content across all documents"),
            request_permission: z.boolean().describe("Must be true only if the user explicitly granted permission to search globally.")
        }),
    },
);

export async function invokeAgent(messages: Array<{ role: string; content: string }>, config: { configurable?: { thread_id?: string } }, currentPath?: string, onChunk?: (chunk: string) => void, onToolCall?: (toolCall: any) => void) {
    const model = await getModel();

    // Tool: Search directory documents (instantiated here so it can capture currentPath)
    const searchDirTool = tool(
        async (input: { query: string }) => {
            const context = await searchDirectoryDocuments(input.query, currentPath || "", 15);
            return context;
        },
        {
            name: "search_directory",
            description: "Search ONLY the documents in the user's current folder and its subfolders. Use this as your default and primary search mechanism for any general questions unless otherwise specified.",
            schema: z.object({
                query: z.string().describe("The search query"),
            }),
        },
    );

    // Tool: List embedded files (instantiated here so it can capture currentPath)
    const listFilesTool = tool(
        async (input: { currentPath?: string }) => {
            const searchPath = input.currentPath || currentPath || "";
            const docs = getDocumentsByPath(searchPath);
            
            if (docs.length === 0) {
                return searchPath 
                    ? `No documents embedded in directory: ${searchPath}`
                    : "No documents embedded yet.";
            }

            return docs.map(doc => {
                const sizeKB = Math.round(doc.file_size / 1024);
                const sizeStr = sizeKB > 1024 
                    ? `${(sizeKB / 1024).toFixed(1)} MB` 
                    : `${sizeKB} KB`;
                const date = doc.created_at.split(' ')[0];
                return `📄 ${doc.file_name} (${sizeStr}, ${doc.total_chunks} chunks, embedded ${date})`;
            }).join('\n');
        },
        {
            name: "list_directory_files",
            description: "List all PDF documents embedded in a specific directory and its subdirectories.",
            schema: z.object({
                currentPath: z.string().optional().describe("Optional directory path to filter documents"),
            }),
        },
    );

    const listAllFilesTool = tool(
        async (input: { folders: string[] }) => {
            const results: string[] = [];

            for (const dirPath of input.folders) {
                if (!existsSync(dirPath)) {
                    results.push(`Not found: ${dirPath}`);
                    continue;
                }

                const entries = readdirSync(dirPath, { withFileTypes: true });
                if (entries.length === 0) {
                    results.push(`Empty: ${dirPath}`);
                    continue;
                }

                const lines = entries.map(entry => {
                    const fullPath = join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        return `📁 ${entry.name}/`;
                    }
                    const stats = statSync(fullPath);
                    const sizeKB = Math.round(stats.size / 1024);
                    return `📄 ${entry.name} (${sizeKB}KB)`;
                });

                results.push(`${dirPath}:\n${lines.join("\n")}`);
            }

            return results.join("\n\n");
        },
        {
            name: "list_all_files",
            description: "List ALL files and folders (including non-PDFs) in specific folders. ALWAYS ask the user which folder(s) they want to list before calling this tool — do not assume.",
            schema: z.object({
                folders: z.array(z.string()).describe("Full paths of the folders to list (one level deep, no recursion)"),
            }),
        },
    );

    const organizeFolderTool = tool(
        async (input: { action: string; targetPath: string; strategy?: string; includeSubfolders?: boolean; flatten?: boolean; customGroups?: { folder: string; files: string[]; filePaths: string[] }[] }) => {
            const { targetPath, strategy = 'type', includeSubfolders = true, flatten = false } = input;

            function getAllFiles(dirPath: string): string[] {
                const allFiles: string[] = [];
                try {
                    const entries = readdirSync(dirPath, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = join(dirPath, entry.name);
                        if (entry.isDirectory()) {
                            if (includeSubfolders) allFiles.push(...getAllFiles(fullPath));
                        } else {
                            allFiles.push(fullPath);
                        }
                    }
                } catch (e) {
                    log.error('Error scanning directory:', e);
                }
                return allFiles;
            }

            // Semantic: return file list + PDF content snippets for LLM to propose groupings
            if (input.action === "semantic_analyze") {
                const allFiles = getAllFiles(targetPath);
                const allDocs = getAllDocuments();
                const fileData = await Promise.all(allFiles.map(async (filePath) => {
                    const fileName = filePath.split(/[\\/]/).pop() || '';
                    const ext = fileName.split('.').pop()?.toLowerCase() || '';
                    let snippet = '';
                    if (ext === 'pdf') {
                        const docInfo = allDocs.find(d => d.file_path === filePath);
                        if (docInfo) {
                            try {
                                const results = await vectorStore.similaritySearch(fileName.replace(/\.pdf$/i, ''), 5);
                                const filtered = results.filter((d: Document) => d.metadata.document_id === docInfo.id);
                                snippet = filtered.slice(0, 2).map((d: Document) => d.pageContent.substring(0, 150)).join(' ... ');
                            } catch (e) {}
                        }
                    }
                    const stats = statSync(filePath);
                    return { path: filePath, name: fileName, ext, snippet, sizeKB: Math.round(stats.size / 1024) };
                }));
                return JSON.stringify({
                    type: "semantic_data",
                    targetPath,
                    files: fileData,
                    instruction: "Analyze these files and their content snippets. Propose semantic folder groupings. Then call organize_folder with action='analyze' and customGroups=[{folder:'FolderName', files:['file.pdf'], filePaths:['/full/path/file.pdf']}]"
                });
            }

            // Analyze with custom groups (after semantic propose)
            if (input.action === "analyze" && input.customGroups) {
                const totalFiles = input.customGroups.reduce((sum, g) => sum + g.files.length, 0);
                return JSON.stringify({
                    type: "organize_plan",
                    targetPath,
                    strategy: "semantic",
                    flatten: false,
                    groups: input.customGroups,
                    totalFiles
                });
            }

            // Standard analyze
            if (input.action === "analyze") {
                const allFiles = getAllFiles(targetPath);
                const groups: Record<string, { files: string[]; filePaths: string[] }> = {};

                for (const filePath of allFiles) {
                    const fileName = filePath.split(/[\\/]/).pop() || '';
                    let groupKey: string;
                    if (flatten) {
                        groupKey = "Root";
                    } else if (strategy === 'type') {
                        const ext = fileName.split('.').pop()?.toLowerCase() || 'unknown';
                        groupKey = ext === 'pdf' ? 'PDFs' : ext.toUpperCase() + 's';
                    } else if (strategy === 'date') {
                        const stats = statSync(filePath);
                        groupKey = stats.mtime.getFullYear().toString();
                    } else {
                        const nameParts = fileName.split(/[\s_-]/);
                        groupKey = nameParts[0] || 'Other';
                    }
                    if (!groups[groupKey]) groups[groupKey] = { files: [], filePaths: [] };
                    groups[groupKey].files.push(fileName);
                    groups[groupKey].filePaths.push(filePath);
                }

                const subfolders = includeSubfolders ? readdirSync(targetPath, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [];
                return JSON.stringify({
                    type: "organize_plan",
                    targetPath,
                    strategy,
                    flatten,
                    groups: Object.entries(groups).map(([group, data]) => ({
                        folder: group,
                        files: data.files,
                        filePaths: data.filePaths
                    })),
                    subfoldersScanned: subfolders,
                    totalFiles: allFiles.length
                });
            }

            return "Use action 'analyze' for standard grouping preview, or 'semantic_analyze' to get content data for AI-proposed groupings. Execution happens via the UI confirmation.";
        },
        {
            name: "organize_folder",
            description: "Analyze or reorganize files in a folder. Use 'analyze' for standard strategies (type/date/name/flatten), 'semantic_analyze' to get file content data so you can propose smart semantic groupings.",
            schema: z.object({
                action: z.enum(["analyze", "semantic_analyze"]).describe("'analyze' for standard grouping preview (or custom with customGroups), 'semantic_analyze' to fetch content data for semantic grouping"),
                targetPath: z.string().describe("The folder path to organize"),
                strategy: z.enum(["type", "date", "name"]).optional().describe("How to group: 'type' (by extension), 'date' (by year), 'name' (by first word)"),
                includeSubfolders: z.boolean().optional().describe("Include files from subfolders (default: true)"),
                flatten: z.boolean().optional().describe("Move all files to root, removing subfolders (default: false)"),
                customGroups: z.array(z.object({
                    folder: z.string().describe("Subfolder name to create"),
                    files: z.array(z.string()).describe("File display names for UI"),
                    filePaths: z.array(z.string()).describe("Full file paths for execution")
                })).optional().describe("Custom file-to-folder mapping (use with action='analyze' after semantic_analyze)")
            }),
        },
    );

    const convertDocumentTool = tool(
        async (input: { action: string; files: { filePath: string; outputPath?: string }[] }) => {
            const { action, files } = input;
            const { existsSync, statSync, readFileSync, writeFileSync } = await import('fs');
            
            if (action === "analyze") {
                const validFiles: { filePath: string; outputPath: string; fileName: string; fileSize: number }[] = [];
                const errors: string[] = [];
                
                for (const f of files) {
                    const filePath = f.filePath;
                    const ext = filePath.toLowerCase().split('.').pop();
                    
                    if (ext !== 'pptx' && ext !== 'ppt') {
                        errors.push(`${filePath}: Not a PowerPoint file`);
                        continue;
                    }
                    if (!existsSync(filePath)) {
                        errors.push(`${filePath}: File not found`);
                        continue;
                    }
                    
                    const stats = statSync(filePath);
                    const fileName = filePath.split(/[\\/]/).pop() || 'unknown.pptx';
                    const outputPath = f.outputPath || filePath.replace(/\.[^.]+$/, '.pdf');
                    
                    validFiles.push({
                        filePath,
                        outputPath,
                        fileName,
                        fileSize: stats.size
                    });
                }
                
                const totalSize = validFiles.reduce((sum, f) => sum + f.fileSize, 0);
                
                return JSON.stringify({
                    type: "convert_plan",
                    files: validFiles,
                    totalFiles: validFiles.length,
                    totalSize,
                    errors: errors.length > 0 ? errors : undefined
                });
            } else if (action === "convert") {
                const { dirname } = await import('path');
                const results: { fileName: string; success: boolean; outputPath?: string; error?: string }[] = [];
                let successCount = 0;
                
                for (const f of files) {
                    const filePath = f.filePath;
                    const outputPath = f.outputPath || filePath.replace(/\.[^.]+$/, '.pdf');
                    const fileName = filePath.split(/[\\/]/).pop() || 'unknown.pptx';
                    
                    try {
                        const outputDir = dirname(outputPath);
                        if (!existsSync(outputDir)) {
                            mkdirSync(outputDir, { recursive: true });
                        }
                        
                        const { convert } = await import('pptx-to-pdf');
                        const pptxBuffer = readFileSync(filePath);
                        const pdfBuffer = await convert(pptxBuffer);
                        writeFileSync(outputPath, pdfBuffer);
                        results.push({ fileName, success: true, outputPath });
                        successCount++;
                    } catch (error) {
                        results.push({ fileName, success: false, outputPath, error: String(error) });
                    }
                }
                
                const failedCount = results.filter(r => !r.success).length;
                return `Successfully converted ${successCount}/${files.length} files. Failed: ${failedCount}`;
            }
            return "Invalid action. Use 'analyze' or 'convert'.";
        },
        {
            name: "convert_document",
            description: "Convert PowerPoint (PPTX) files to PDF format. Use 'analyze' to preview the conversion, 'convert' to execute after user confirms.",
            schema: z.object({
                action: z.enum(["analyze", "convert"]).describe("Action: 'analyze' to preview conversion, 'convert' to execute (only after user confirms)"),
                files: z.array(z.object({
                    filePath: z.string().describe("Path to the PowerPoint file (.pptx or .ppt)"),
                    outputPath: z.string().optional().describe("Output PDF path (default: same directory with .pdf extension)")
                })).describe("Array of files to convert")
            }),
        },
    );

    const moveFilesTool = tool(
        async (input: { moves: { from: string; to: string }[] }) => {
            const validMoves: { from: string; to: string; fileName: string }[] = [];
            const errors: string[] = [];
            for (const move of input.moves) {
                if (!existsSync(move.from)) {
                    errors.push(`${move.from}: File not found`);
                    continue;
                }
                const fileName = move.from.split(/[\\/]/).pop() || '';
                validMoves.push({ from: move.from, to: move.to, fileName });
            }
            return JSON.stringify({
                type: "move_plan",
                moves: validMoves,
                errors: errors.length > 0 ? errors : undefined
            });
        },
        {
            name: "move_files",
            description: "Move specific files to new locations. Returns a move plan for user confirmation. Use when user explicitly wants to move specific files.",
            schema: z.object({
                moves: z.array(z.object({
                    from: z.string().describe("Source file path (full path)"),
                    to: z.string().describe("Destination file path (full path including filename)")
                })).describe("List of file moves to perform")
            })
        }
    );

    const renameFileTool = tool(
        async (input: { oldPath: string; newName: string }) => {
            if (!existsSync(input.oldPath)) {
                return JSON.stringify({ type: "rename_plan", error: `File not found: ${input.oldPath}` });
            }
            const dir = dirname(input.oldPath);
            const newPath = join(dir, input.newName);
            const oldName = input.oldPath.split(/[\\/]/).pop() || '';
            return JSON.stringify({
                type: "rename_plan",
                oldPath: input.oldPath,
                newPath,
                oldName,
                newName: input.newName
            });
        },
        {
            name: "rename_file",
            description: "Rename a file or folder. Returns a rename plan for user confirmation.",
            schema: z.object({
                oldPath: z.string().describe("Full path of the file/folder to rename"),
                newName: z.string().describe("New name (filename only, not the full path)")
            })
        }
    );

    const deleteFilesTool = tool(
        async (input: { files: string[] }) => {
            const validFiles: { path: string; name: string; isDirectory: boolean; size?: number }[] = [];
            const errors: string[] = [];
            for (const filePath of input.files) {
                if (!existsSync(filePath)) {
                    errors.push(`${filePath}: Not found`);
                    continue;
                }
                const stats = statSync(filePath);
                validFiles.push({
                    path: filePath,
                    name: filePath.split(/[\\/]/).pop() || '',
                    isDirectory: stats.isDirectory(),
                    size: stats.isDirectory() ? undefined : stats.size
                });
            }
            return JSON.stringify({
                type: "delete_plan",
                files: validFiles,
                errors: errors.length > 0 ? errors : undefined
            });
        },
        {
            name: "delete_files",
            description: "Delete files or folders. ONLY use when user EXPLICITLY says to delete/remove something. Returns a delete plan requiring user confirmation — nothing is deleted until confirmed.",
            schema: z.object({
                files: z.array(z.string()).describe("Full paths of files/folders to delete")
            })
        }
    );

    const createFolderTool = tool(
        async (input: { path: string }) => {
            if (existsSync(input.path)) {
                return `Folder already exists: ${input.path}`;
            }
            mkdirSync(input.path, { recursive: true });
            return `Created folder: ${input.path}`;
        },
        {
            name: "create_folder",
            description: "Create a new folder at the specified path. Executes immediately (safe, non-destructive).",
            schema: z.object({
                path: z.string().describe("Full path of the folder to create")
            })
        }
    );

    const recommendDocumentsTool = tool(
        async (input: { query: string }) => {
            const searchQuery = input.query;
            const allDocs = getAllDocuments();

            if (allDocs.length === 0) {
                return JSON.stringify({ type: "document_recommendations", documents: [] });
            }

            try {
                const results = await vectorStore.similaritySearch(searchQuery, 50);

                let filtered = results;
                if (currentPath) {
                    const validDocIds = new Set(
                        allDocs
                            .filter(d => d.file_path && d.file_path.startsWith(currentPath))
                            .map(d => d.id)
                    );
                    filtered = results.filter((doc: Document) =>
                        validDocIds.has(doc.metadata.document_id as string)
                    );
                }

                const chunkCounts: Record<string, { count: number; doc: Document }> = {};
                for (const doc of filtered) {
                    const docId = doc.metadata.document_id as string;
                    if (!docId) continue;
                    if (!chunkCounts[docId]) {
                        chunkCounts[docId] = { count: 0, doc };
                    }
                    chunkCounts[docId].count++;
                }

                const sortedIds = Object.entries(chunkCounts)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5)
                    .filter(([_, data]) => data.count > 0);

                const documents = sortedIds.map(([docId, data]) => {
                    const metadata = allDocs.find(d => d.id === docId);
                    const snippet = data.doc.pageContent.substring(0, 150);
                    return {
                        id: docId,
                        file_name: metadata?.file_name || 'unknown',
                        file_path: metadata?.file_path || '',
                        snippet
                    };
                });

                return JSON.stringify({ type: "document_recommendations", documents });
            } catch (error) {
                log.error('Error in recommend_documents:', error);
                return JSON.stringify({ type: "document_recommendations", documents: [] });
            }
        },
        {
            name: "recommend_documents",
            description: "Find and surface relevant documents for a query. USE THIS when the user asks for study material, lecture notes, lecture material, relevant documents, references, or 'what should I read about X'. Returns clickable document cards in the UI. Do NOT use search_directory instead of this tool for these requests.",
            schema: z.object({
                query: z.string().describe("The topic or question to find relevant documents for")
            })
        }
    );

    const currentDocId = getCurrentDocumentId();
    const currentDoc = currentDocId ? getDocumentByHash(currentDocId) : null;
    const currentDocName = currentDoc ? currentDoc.file_name : null;

    const agent = createAgent({
        model,
        tools: [searchCurrentDocTool, searchDirTool, searchAllDocsTool, listFilesTool, listAllFilesTool, organizeFolderTool, convertDocumentTool, moveFilesTool, renameFileTool, deleteFilesTool, createFolderTool, recommendDocumentsTool],
        systemPrompt: `You are a helpful AI assistant with access to the user's PDF document library.

Current active folder: ${currentPath || "none"}
Currently open document: ${currentDocName || "none"}

When the user navigates to a new folder, your active folder changes. Always use the current active folder shown above as your working context — do not assume you are still in a previous folder.

CRITICAL RULE — READ FIRST:
When the user asks for documents to read, study material, lecture notes, references, related files, or says anything like "give me material", "what should I read", "find me notes", "lecture material", "study material", "relevant documents" — you MUST call 'recommend_documents' FIRST, before any other tool. Do NOT use search_directory or list_directory_files for these requests. 'recommend_documents' returns clickable document cards directly in the UI.

You have twelve tools. Use them according to these STRICT rules:
1. When the user asks about "this document" or "the current document", use 'search_current' to search only the currently open PDF.
2. Use 'list_directory_files' to list only embedded PDFs in a directory.
3. Use 'list_all_files' to see ALL files (including non-PDFs) in specific folders. ALWAYS ask the user which folder(s) to list first — never assume.
4. By DEFAULT, for ANY general question about their files, use 'search_directory'. This restricts your search to the user's active folder context.
5. If you cannot find what you're looking for, or if the user explicitly asks to search "all my files" or "everywhere", you MUST ASK FOR PERMISSION FIRST before using 'search_all'. Once they say "yes", use 'search_all' with request_permission: true.
6. FOLDER ORGANIZATION - Only use when user EXPLICITLY asks to "organize" or "reorganize":
   - Use 'organize_folder' with action "analyze" and a strategy (type/date/name/flatten) to see the proposed structure.
   - For SEMANTIC organization (by topic/content): first call 'organize_folder' with action='semantic_analyze' to get file data and content snippets, then propose groupings yourself, then call 'organize_folder' with action='analyze' and customGroups=[{folder:'Name', files:['file.pdf'], filePaths:['/full/path/file.pdf']}].
   - The UI will show a confirmation dialog. DO NOT suggest organization unless explicitly asked.
7. DOCUMENT CONVERSION - Only use when user EXPLICITLY asks to "convert" or "export" a PowerPoint to PDF:
   - Use 'convert_document' with action "analyze" to preview. UI shows confirmation. DO NOT suggest unless explicitly asked.
8. MOVE FILES - Only use 'move_files' when user explicitly asks to move specific files:
   - Returns a move plan for UI confirmation. Nothing moves until user confirms.
9. RENAME FILE - Only use 'rename_file' when user explicitly asks to rename:
   - Returns a rename plan for UI confirmation.
10. DELETE FILES - ONLY use 'delete_files' when user EXPLICITLY says "delete" or "remove":
    - NEVER suggest deleting. Returns a delete plan requiring confirmation. Nothing is deleted until user confirms.
11. CREATE FOLDER - Use 'create_folder' to create folders immediately. Safe, no confirmation needed.
12. RECOMMEND DOCUMENTS — Use 'recommend_documents' when the user asks for relevant documents, study material, lecture notes, references, or "what should I read about X". This is MANDATORY — never substitute search_directory or list_directory_files for this. Returns clickable document cards in the UI.

The search results will include document identifiers. Use these to reference which file information came from.`,
        checkpointer: saver,
    });

    if (!onChunk && !onToolCall) {
        return (agent as { invoke: (params: unknown, config: unknown) => Promise<unknown> }).invoke({ messages }, config);
    }

    const stream = await (agent as { streamEvents: (params: unknown, config: unknown, options: unknown) => AsyncGenerator<any, void, unknown> }).streamEvents({ messages }, config, { version: "v2" });

    let finalResponse = { messages: [] as any[] };

    for await (const event of stream) {
        if (event.event === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content && typeof content === "string") {
                onChunk?.(content);
            }
        } else if (event.event === "on_tool_start") {
            onToolCall?.({
                type: "start",
                name: event.name,
                input: event.data?.input
            });
        } else if (event.event === "on_tool_end") {
            onToolCall?.({
                type: "end",
                name: event.name,
                output: event.data?.output
            });
        } else if (event.event === "on_chain_end") {
            // Keep track of final message state
            if (event.data?.output?.messages) {
                finalResponse.messages = event.data.output.messages;
            } else if (event.data?.output && Array.isArray(event.data.output) && event.data.output.length > 0 && event.data.output[0].role) {
                finalResponse.messages = event.data.output;
            }
        }
    }

    if (!finalResponse.messages || finalResponse.messages.length === 0) {
        try {
            const state = await (agent as any).getState(config);
            if (state?.values?.messages) {
                finalResponse.messages = state.values.messages;
            }
        } catch (e) {
            console.error("Could not get state from checkpointer", e);
        }
    }

    return finalResponse;
}
