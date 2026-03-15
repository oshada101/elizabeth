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
import { existsSync, readdirSync, statSync, mkdirSync, renameSync } from 'fs';
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
        async (input: { directoryPath?: string }) => {
            const dirPath = input.directoryPath || currentPath || "";
            if (!dirPath) {
                return "No directory path provided.";
            }
            
            interface TreeEntry {
                name: string;
                path: string;
                isDirectory: boolean;
                children?: TreeEntry[];
                size?: number;
            }
            
            function scanDir(path: string): TreeEntry[] {
                const entries = readdirSync(path, { withFileTypes: true });
                return entries.map(entry => {
                    const fullPath = join(path, entry.name);
                    const stats = statSync(fullPath);
                    if (entry.isDirectory()) {
                        return {
                            name: entry.name,
                            path: fullPath,
                            isDirectory: true,
                            children: scanDir(fullPath)
                        };
                    }
                    return {
                        name: entry.name,
                        path: fullPath,
                        isDirectory: false,
                        size: stats.size
                    };
                });
            }
            
            const tree = scanDir(dirPath);
            if (tree.length === 0) {
                return `Directory is empty: ${dirPath}`;
            }
            
            function formatTree(entries: TreeEntry[], prefix = ""): string {
                return entries.map(entry => {
                    const icon = entry.isDirectory ? "📁" : "📄";
                    const size = entry.size ? ` (${Math.round(entry.size / 1024)}KB)` : "";
                    const line = `${prefix}${icon} ${entry.name}${size}`;
                    if (entry.children && entry.children.length > 0) {
                        return line + "\n" + formatTree(entry.children, prefix + "  ");
                    }
                    return line;
                }).join("\n");
            }
            
            return `Files in ${dirPath}:\n${formatTree(tree)}`;
        },
        {
            name: "list_all_files",
            description: "List ALL files and folders in a directory (including non-PDF files). Use this to see everything in a folder.",
            schema: z.object({
                directoryPath: z.string().optional().describe("The directory path to list. Uses current path if not specified."),
            }),
        },
    );

    const organizeFolderTool = tool(
        async (input: { action: string; targetPath: string; strategy?: string }) => {
            const { targetPath, strategy = 'type' } = input;
            
            if (input.action === "analyze") {
                const entries = readdirSync(targetPath, { withFileTypes: true });
                const files = entries.filter(e => !e.isDirectory());
                const groups: Record<string, string[]> = {};
                
                for (const file of files) {
                    const filePath = join(targetPath, file.name);
                    let groupKey: string;
                    
                    if (strategy === 'type') {
                        const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
                        groupKey = ext === 'pdf' ? 'PDFs' : ext.toUpperCase() + 's';
                    } else if (strategy === 'date') {
                        const stats = statSync(filePath);
                        groupKey = stats.mtime.getFullYear().toString();
                    } else {
                        const nameParts = file.name.split(/[\s_-]/);
                        groupKey = nameParts[0] || 'Other';
                    }
                    
                    if (!groups[groupKey]) groups[groupKey] = [];
                    groups[groupKey].push(file.name);
                }
                
                let analysis = `📁 Organization plan for: ${targetPath}\nStrategy: ${strategy}\n\n`;
                for (const [group, files] of Object.entries(groups)) {
                    analysis += `📂 ${group}/ (${files.length} files)\n`;
                    files.forEach(f => analysis += `   - ${f}\n`);
                }
                analysis += `\nSay "organize" or "go ahead" to confirm and move the files.`;
                return analysis;
            }
            
            const { response } = await dialog.showMessageBox({
                type: 'question',
                buttons: ['Cancel', 'Organize'],
                defaultId: 0,
                title: 'Confirm Folder Reorganization',
                message: `Organize files in "${targetPath}"?`,
                detail: 'This will move files to new locations.'
            });
            
            if (response === 0) return "Operation was cancelled by the user.";
            
            const entries = readdirSync(targetPath, { withFileTypes: true });
            const files = entries.filter(e => !e.isDirectory());
            const groups: Record<string, string[]> = {};
            
            for (const file of files) {
                const filePath = join(targetPath, file.name);
                let groupKey: string;
                
                if (strategy === 'type') {
                    const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
                    groupKey = ext === 'pdf' ? 'PDFs' : ext.toUpperCase() + 's';
                } else if (strategy === 'date') {
                    const stats = statSync(filePath);
                    groupKey = stats.mtime.getFullYear().toString();
                } else {
                    const nameParts = file.name.split(/[\s_-]/);
                    groupKey = nameParts[0] || 'Other';
                }
                
                if (!groups[groupKey]) groups[groupKey] = [];
                groups[groupKey].push(filePath);
            }
            
            const results: { oldPath: string; newPath: string }[] = [];
            
            for (const [group, paths] of Object.entries(groups)) {
                const groupDir = join(targetPath, group);
                if (!existsSync(groupDir)) {
                    mkdirSync(groupDir, { recursive: true });
                }
                
                for (const oldPath of paths) {
                    const fileName = oldPath.split(/[\\/]/).pop() || '';
                    const newPath = join(groupDir, fileName);
                    renameSync(oldPath, newPath);
                    if (oldPath.toLowerCase().endsWith('.pdf')) {
                        updateDocumentPath(oldPath, newPath);
                    }
                    results.push({ oldPath, newPath });
                }
            }
            
            return `Successfully organized ${results.length} files using ${strategy} strategy.`;
        },
        {
            name: "organize_folder",
            description: "Analyze or reorganize files in a folder by type, date, or name. Use 'analyze' action to see suggestions, or 'organize' to actually move files.",
            schema: z.object({
                action: z.enum(["analyze", "organize"]).describe("The action to perform: 'analyze' to scan and show suggestions, 'organize' to move files to organized folders"),
                targetPath: z.string().describe("The folder path to organize"),
                strategy: z.enum(["type", "date", "name"]).optional().describe("How to group files: 'type' (by extension), 'date' (by year), 'name' (by first word)")
            }),
        },
    );

    const agent = createAgent({
        model,
        tools: [searchCurrentDocTool, searchDirTool, searchAllDocsTool, listFilesTool, listAllFilesTool, organizeFolderTool],
        systemPrompt: `You are a helpful AI assistant with access to the user's PDF document library.

You have six tools, use them according to these STRICT rules:
1. When the user asks about "this document" or "the current document", use the 'search_current' tool to search only the currently open PDF.
2. Use the 'list_directory_files' tool to list only embedded PDFs in a directory.
3. Use 'list_all_files' to see ALL files (including non-PDFs) in a directory, or to explore folder structure.
4. By DEFAULT, for ANY general question about their files, use the 'search_directory' tool. This restricts your search to the user's active folder context.
5. If you cannot find what you're looking for, or if the user explicitly asks to search "all my files" or " everywhere", you MUST ASK FOR PERMISSION FIRST before using the 'search_all' tool. Once they say "yes" or give explicit consent, use 'search_all' with request_permission: true.
6. If the user asks to "organize" or "reorganize" a folder, use the 'organize_folder' tool with action "analyze" first to show suggestions, then ask for confirmation before using action "organize". The tool supports three strategies: 'type' (by file extension), 'date' (by year), or 'name' (by first word).

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
