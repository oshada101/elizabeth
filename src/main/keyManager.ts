import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import log from 'electron-log'
import * as keytar from 'keytar'

const KEYTAR_SERVICE = 'Elizabeth'

export interface ApiKeyMetadata {
    id: string
    account: string
    provider: string
    label: string
    isDefault: boolean
    models: string[]
    maskedKey: string
    baseUrl?: string
}

const userDataPath = app.getPath('userData')
const keysMetadataPath = join(userDataPath, 'api-keys.json')

export function getApiKeysMetadata(): ApiKeyMetadata[] {
    if (existsSync(keysMetadataPath)) {
        try {
            return JSON.parse(readFileSync(keysMetadataPath, 'utf-8'))
        } catch (error) {
            log.error('Error reading API keys metadata:', error)
            return []
        }
    }
    return []
}

export function saveApiKeysMetadata(metadata: ApiKeyMetadata[]): void {
    try {
        writeFileSync(keysMetadataPath, JSON.stringify(metadata, null, 2))
    } catch (error) {
        log.error('Error saving API keys metadata:', error)
    }
}

function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) return apiKey.substring(0, 2) + '****'
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4)
}

export async function saveApiKey(data: { account: string, provider: string, label: string, isDefault: boolean, models: string[], apiKey: string, baseUrl?: string }) {
    const { account, provider, label, isDefault, models, apiKey, baseUrl } = data
    const id = Date.now().toString()
    const maskedKey = maskApiKey(apiKey)

    await keytar.setPassword(KEYTAR_SERVICE, account, apiKey)

    let metadata = getApiKeysMetadata()
    if (isDefault) {
        metadata = metadata.map(k => ({ ...k, isDefault: false }))
    }

    metadata.push({ id, account, provider, label, isDefault, models, maskedKey, baseUrl: baseUrl || undefined })
    saveApiKeysMetadata(metadata)
    return id
}

export async function updateApiKey(id: string, data: { account?: string, provider?: string, label?: string, isDefault?: boolean, models?: string[], apiKey?: string, baseUrl?: string }) {
    let metadata = getApiKeysMetadata()
    const entryIndex = metadata.findIndex(k => k.id === id)
    
    if (entryIndex === -1) {
        log.error('API key not found:', id)
        return
    }

    const entry = metadata[entryIndex]

    // If account changed, delete old key and set new one
    if (data.account && data.account !== entry.account) {
        await keytar.deletePassword(KEYTAR_SERVICE, entry.account)
        if (data.apiKey) {
            await keytar.setPassword(KEYTAR_SERVICE, data.account, data.apiKey)
        }
    } else if (data.apiKey) {
        // Same account, just update the key
        await keytar.setPassword(KEYTAR_SERVICE, entry.account, data.apiKey)
    }

    // Update masked key if apiKey was provided
    const maskedKey = data.apiKey ? maskApiKey(data.apiKey) : entry.maskedKey

    // Handle default
    if (data.isDefault === true) {
        metadata = metadata.map(k => ({ ...k, isDefault: false }))
    }

    metadata[entryIndex] = {
        ...entry,
        account: data.account || entry.account,
        provider: data.provider || entry.provider,
        label: data.label || entry.label,
        isDefault: data.isDefault !== undefined ? data.isDefault : entry.isDefault,
        models: data.models || entry.models,
        maskedKey,
        baseUrl: data.baseUrl !== undefined ? data.baseUrl : entry.baseUrl,
    }
    
    saveApiKeysMetadata(metadata)
}

export async function deleteApiKey(id: string) {
    let metadata = getApiKeysMetadata()
    const entry = metadata.find(k => k.id === id)
    if (entry) {
        await keytar.deletePassword(KEYTAR_SERVICE, entry.account)
        metadata = metadata.filter(k => k.id !== id)
        saveApiKeysMetadata(metadata)
    }
}

export function setDefaultApiKey(id: string) {
    let metadata = getApiKeysMetadata()
    metadata = metadata.map(k => ({ ...k, isDefault: k.id === id }))
    saveApiKeysMetadata(metadata)
}

export async function getDefaultApiKey(): Promise<{ key: string | null, provider: string | null, model: string | null, baseUrl?: string }> {
    const metadata = getApiKeysMetadata()
    const defaultEntry = metadata.find(k => k.isDefault) || metadata[0]

    if (defaultEntry) {
        const key = await keytar.getPassword(KEYTAR_SERVICE, defaultEntry.account)
        return {
            key,
            provider: defaultEntry.provider,
            model: defaultEntry.models[0] || null,
            baseUrl: defaultEntry.baseUrl
        }
    }

    return { key: null, provider: null, model: null }
}
