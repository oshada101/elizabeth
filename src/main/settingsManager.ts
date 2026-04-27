import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import log from 'electron-log'

export interface EmbeddingSettings {
    model: string
    baseUrl: string
    embeddingDim: number
}

const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
    model: "all-minilm:latest",
    baseUrl: "http://localhost:11434",
    embeddingDim: 384,
}

const userDataPath = app.getPath('userData')
const settingsPath = join(userDataPath, 'embedding-settings.json')

export function getEmbeddingSettings(): EmbeddingSettings {
    if (existsSync(settingsPath)) {
        try {
            const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
            return {
                model: data.model ?? DEFAULT_EMBEDDING_SETTINGS.model,
                baseUrl: data.baseUrl ?? DEFAULT_EMBEDDING_SETTINGS.baseUrl,
                embeddingDim: data.embeddingDim ?? DEFAULT_EMBEDDING_SETTINGS.embeddingDim,
            }
        } catch (error) {
            log.error('Error reading embedding settings:', error)
            return DEFAULT_EMBEDDING_SETTINGS
        }
    }
    return DEFAULT_EMBEDDING_SETTINGS
}

export function saveEmbeddingSettings(settings: EmbeddingSettings): void {
    try {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    } catch (error) {
        log.error('Error saving embedding settings:', error)
    }
}