import { useState, useEffect, useCallback } from "react";
import React from "react";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsTab = "general" | "apiKeys";

interface ApiKeyEntry {
    id: string;
    account: string;
    provider: string;
    label: string;
    isDefault: boolean;
    models: string[];
    maskedKey: string;
    baseUrl?: string;
}

const settingsTabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    {
        id: "general",
        label: "Embedding",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
        ),
    },
    {
        id: "apiKeys",
        label: "API Key Management",
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
        ),
    },
];

function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>("general");
    const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
    const [embeddingSettings, setEmbeddingSettings] = useState<{ model: string; baseUrl: string; embeddingDim: number } | null>(null);
    const [savedEmbedding, setSavedEmbedding] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
    const [showKeyIds, setShowKeyIds] = useState<Set<string>>(new Set());
    const [newKey, setNewKey] = useState({
        account: "",
        provider: "",
        label: "",
        isDefault: false,
        models: [""],
        apiKey: "",
        baseUrl: "",
    });
    const [editKey, setEditKey] = useState({
        account: "",
        provider: "",
        label: "",
        isDefault: false,
        models: [""],
        apiKey: "",
        baseUrl: "",
    });

    const loadApiKeys = useCallback(async () => {
        try {
            const keys = await window.electronAPI.apiKeys.list();
            setApiKeys(keys);
        } catch (error) {
            console.error("Failed to load API keys:", error);
        }
    }, []);

    useEffect(() => {
        if (isOpen && activeTab === "apiKeys") {
            loadApiKeys();
        }
    }, [isOpen, activeTab, loadApiKeys]);

    useEffect(() => {
        if (isOpen && activeTab === "general" && !embeddingSettings) {
            window.electronAPI.settings.getEmbedding().then(setEmbeddingSettings);
        }
    }, [isOpen, activeTab, embeddingSettings]);

    const toggleShowKey = (id: string) => {
        const newSet = new Set(showKeyIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setShowKeyIds(newSet);
    };

    const handleAddModel = () => {
        setNewKey({ ...newKey, models: [...newKey.models, ""] });
    };

    const handleRemoveModel = (index: number) => {
        const updated = [...newKey.models];
        updated.splice(index, 1);
        setNewKey({ ...newKey, models: updated });
    };

    const handleModelChange = (index: number, value: string) => {
        const updated = [...newKey.models];
        updated[index] = value;
        setNewKey({ ...newKey, models: updated });
    };

    const handleAddKey = async () => {
        if (!newKey.account || !newKey.provider || !newKey.label || !newKey.apiKey) return;

        try {
            await window.electronAPI.apiKeys.save({
                ...newKey,
                baseUrl: newKey.baseUrl || undefined,
                models: newKey.models.filter((m) => m.trim())
            });
            setNewKey({ account: "", provider: "", label: "", isDefault: false, models: [""], apiKey: "", baseUrl: "" });
            setShowAddForm(false);
            loadApiKeys();
        } catch (error) {
            console.error("Failed to add API key:", error);
        }
    };

    const handleDeleteKey = async (id: string) => {
        try {
            await window.electronAPI.apiKeys.delete(id);
            loadApiKeys();
        } catch (error) {
            console.error("Failed to delete API key:", error);
        }
    };

    const handleSetDefault = async (id: string) => {
        try {
            await window.electronAPI.apiKeys.setDefault(id);
            loadApiKeys();
        } catch (error) {
            console.error("Failed to set default API key:", error);
        }
    };

    const startEditing = (key: ApiKeyEntry) => {
        setShowAddForm(false);
        setEditingKeyId(key.id);
        setEditKey({
            account: key.account,
            provider: key.provider,
            label: key.label,
            isDefault: key.isDefault,
            models: key.models.length > 0 ? [...key.models] : [""],
            apiKey: "",
            baseUrl: key.baseUrl || "",
        });
    };

    const cancelEditing = () => {
        setEditingKeyId(null);
        setEditKey({ account: "", provider: "", label: "", isDefault: false, models: [""], apiKey: "", baseUrl: "" });
    };

    const handleEditModel = () => {
        setEditKey({ ...editKey, models: [...editKey.models, ""] });
    };

    const handleEditRemoveModel = (index: number) => {
        const updated = [...editKey.models];
        updated.splice(index, 1);
        setEditKey({ ...editKey, models: updated });
    };

    const handleEditModelChange = (index: number, value: string) => {
        const updated = [...editKey.models];
        updated[index] = value;
        setEditKey({ ...editKey, models: updated });
    };

    const saveEdit = async () => {
        if (!editKey.account || !editKey.provider || !editKey.label) return;

        try {
            await window.electronAPI.apiKeys.update(editingKeyId!, {
                account: editKey.account,
                provider: editKey.provider,
                label: editKey.label,
                isDefault: editKey.isDefault,
                models: editKey.models.filter((m) => m.trim()),
                apiKey: editKey.apiKey || undefined,
                baseUrl: editKey.baseUrl || undefined,
            });
            cancelEditing();
            loadApiKeys();
        } catch (error) {
            console.error("Failed to update API key:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-primary-950/80 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-[900px] h-[600px] bg-gradient-to-br from-primary-800/95 to-primary-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-scale-in">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 rounded-xl text-primary-400 hover:text-white hover:bg-white/10 transition-all duration-200 z-10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>

                <div className="flex h-full">
                    {/* Left Sidebar */}
                    <div className="w-56 border-r border-white/10 flex flex-col">
                        <div className="p-5 border-b border-white/10">
                            <h2 className="text-lg font-semibold text-white">Settings</h2>
                            <p className="text-xs text-primary-400/60 mt-1">Configure your preferences</p>
                        </div>
                        <div className="flex-1 p-3 space-y-1">
                            {settingsTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                                        activeTab === tab.id
                                            ? "bg-purple-500/20 text-purple-200 border border-purple-500/30"
                                            : "text-primary-300 hover:bg-white/5 hover:text-white border border-transparent"
                                    }`}
                                >
                                    <span className={activeTab === tab.id ? "text-purple-300" : "text-primary-400"}>
                                        {tab.icon}
                                    </span>
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="animate-fade-in">
                            {activeTab === "general" && (
                                <div>
                                    <h3 className="text-lg font-semibold text-white mb-4">Embedding Settings</h3>
                                    
                                    {embeddingSettings ? (
                                        <div className="space-y-4">
                                            <div className="p-4 bg-primary-900/30 rounded-xl border border-white/10">
                                                <h4 className="text-sm font-medium text-purple-200 mb-4 flex items-center gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                        <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a1 1 0 11-.788 1.638l-3.165-1.534a1 1 0 00-.745.336l-2.253 2.274a1 1 0 01-1.33 0l-2.274-2.253a1 1 0 00-.745-.336l-3.165 1.534a1 1 0 11-.788-1.638L1 11.186v3.957a9.026 9.026 0 002.638 6.361z" />
                                                    </svg>
                                                    Embedding Configuration
                                                </h4>
                                                
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="text-xs text-primary-400/60 mb-1.5 block">Embedding Model</label>
                                                        <input
                                                            type="text"
                                                            value={embeddingSettings.model}
                                                            onChange={(e) => setEmbeddingSettings({ ...embeddingSettings, model: e.target.value })}
                                                            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50 transition-all duration-200"
                                                            placeholder="all-minilm:latest"
                                                        />
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="text-xs text-primary-400/60 mb-1.5 block">Ollama Base URL</label>
                                                        <input
                                                            type="text"
                                                            value={embeddingSettings.baseUrl}
                                                            onChange={(e) => setEmbeddingSettings({ ...embeddingSettings, baseUrl: e.target.value })}
                                                            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50 transition-all duration-200"
                                                            placeholder="http://localhost:11434"
                                                        />
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="text-xs text-primary-400/60 mb-1.5 block">Embedding Dimension</label>
                                                        <input
                                                            type="number"
                                                            value={embeddingSettings.embeddingDim}
                                                            onChange={(e) => setEmbeddingSettings({ ...embeddingSettings, embeddingDim: parseInt(e.target.value) || 384 })}
                                                            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50 transition-all duration-200"
                                                            placeholder="384"
                                                        />
                                                    </div>
                                                </div>
                                                
                                                <div className="mt-4 pt-4 border-t border-white/10">
                                                    <p className="text-xs text-primary-400/60 mb-3">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 inline mr-1" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                                        </svg>
                                                        Changes take effect after restarting the app.
                                                    </p>
                                                    <button
                                                        onClick={async () => {
                                                            await window.electronAPI.settings.saveEmbedding(embeddingSettings);
                                                            setSavedEmbedding(true);
                                                            setTimeout(() => setSavedEmbedding(false), 2000);
                                                        }}
                                                        className={`px-4 py-2 text-sm rounded-lg border transition-all duration-300 ${
                                                            savedEmbedding
                                                                ? "bg-green-500/20 border-green-500/30 text-green-300"
                                                                : "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/30 text-purple-200"
                                                        }`}
                                                    >
                                                        {savedEmbedding ? "Saved!" : "Save"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center py-8">
                                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400"></div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {activeTab === "apiKeys" && (
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-semibold text-white">API Key Management</h3>
                                        {!showAddForm && editingKeyId === null && (
                                            <button
                                                onClick={() => setShowAddForm(true)}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-sm rounded-lg border border-purple-500/30 transition-all duration-200"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                                </svg>
                                                Add Key
                                            </button>
                                        )}
                                    </div>

                                    {showAddForm && (
                                        <div className="mb-4 p-4 bg-primary-900/50 rounded-xl border border-white/10">
                                            <div className="grid grid-cols-2 gap-3 mb-3">
                                                <input
                                                    type="text"
                                                    placeholder="Account (e.g., openai:Work)"
                                                    value={newKey.account}
                                                    onChange={(e) => setNewKey({ ...newKey, account: e.target.value })}
                                                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Provider (e.g., openai)"
                                                    value={newKey.provider}
                                                    onChange={(e) => setNewKey({ ...newKey, provider: e.target.value })}
                                                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Label (e.g., Work)"
                                                    value={newKey.label}
                                                    onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                                                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                />
                                                <input
                                                    type="password"
                                                    placeholder="API Key (sk-...)"
                                                    value={newKey.apiKey}
                                                    onChange={(e) => setNewKey({ ...newKey, apiKey: e.target.value })}
                                                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Base URL (optional, e.g., https://api.openai.com/v1)"
                                                    value={newKey.baseUrl}
                                                    onChange={(e) => setNewKey({ ...newKey, baseUrl: e.target.value })}
                                                    className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50 col-span-2"
                                                />
                                            </div>

                                            <div className="mb-3">
                                                <label className="text-xs text-primary-400/60 mb-2 block">Models</label>
                                                {newKey.models.map((model, index) => (
                                                    <div key={index} className="flex gap-2 mb-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Model name (e.g., gpt-4o)"
                                                            value={model}
                                                            onChange={(e) => handleModelChange(index, e.target.value)}
                                                            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                        />
                                                        {newKey.models.length > 1 && (
                                                            <button
                                                                onClick={() => handleRemoveModel(index)}
                                                                className="p-2 text-primary-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={handleAddModel}
                                                    className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                                    </svg>
                                                    Add Model
                                                </button>
                                            </div>

                                            <div className="flex items-center gap-2 mb-3">
                                                <input
                                                    type="checkbox"
                                                    id="isDefault"
                                                    checked={newKey.isDefault}
                                                    onChange={(e) => setNewKey({ ...newKey, isDefault: e.target.checked })}
                                                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/50"
                                                />
                                                <label htmlFor="isDefault" className="text-sm text-primary-300">Set as default</label>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleAddKey}
                                                    className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-sm rounded-lg border border-purple-500/30 transition-all duration-200"
                                                >
                                                    Add
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setShowAddForm(false);
                                                        setNewKey({ account: "", provider: "", label: "", isDefault: false, models: [""], apiKey: "", baseUrl: "" });
                                                    }}
                                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-primary-300 text-sm rounded-lg border border-white/10 transition-all duration-200"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        {apiKeys.map((key) => (
                                            <div
                                                key={key.id}
                                                className="p-4 bg-primary-900/30 rounded-xl border border-white/10 hover:border-white/20 transition-all duration-200"
                                            >
                                                {editingKeyId === key.id ? (
                                                    <div>
                                                        <div className="grid grid-cols-2 gap-3 mb-3">
                                                            <input
                                                                type="text"
                                                                placeholder="Account"
                                                                value={editKey.account}
                                                                onChange={(e) => setEditKey({ ...editKey, account: e.target.value })}
                                                                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                            />
                                                            <input
                                                                type="text"
                                                                placeholder="Provider"
                                                                value={editKey.provider}
                                                                onChange={(e) => setEditKey({ ...editKey, provider: e.target.value })}
                                                                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                            />
                                                            <input
                                                                type="text"
                                                                placeholder="Label"
                                                                value={editKey.label}
                                                                onChange={(e) => setEditKey({ ...editKey, label: e.target.value })}
                                                                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                            />
                                                            <input
                                                                type="password"
                                                                placeholder="New API Key (leave empty to keep current)"
                                                                value={editKey.apiKey}
                                                                onChange={(e) => setEditKey({ ...editKey, apiKey: e.target.value })}
                                                                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                            />
                                                            <input
                                                                type="text"
                                                                placeholder="Base URL (optional)"
                                                                value={editKey.baseUrl}
                                                                onChange={(e) => setEditKey({ ...editKey, baseUrl: e.target.value })}
                                                                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50 col-span-2"
                                                            />
                                                        </div>
                                                        <div className="mb-3">
                                                            <label className="text-xs text-primary-400/60 mb-2 block">Models</label>
                                                            {editKey.models.map((model, index) => (
                                                                <div key={index} className="flex gap-2 mb-2">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Model name"
                                                                        value={model}
                                                                        onChange={(e) => handleEditModelChange(index, e.target.value)}
                                                                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-primary-400/50 focus:outline-none focus:border-purple-500/50"
                                                                    />
                                                                    {editKey.models.length > 1 && (
                                                                        <button
                                                                            onClick={() => handleEditRemoveModel(index)}
                                                                            className="p-2 text-primary-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                            </svg>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            <button
                                                                onClick={handleEditModel}
                                                                className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                                                </svg>
                                                                Add Model
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-2 mb-3">
                                                            <input
                                                                type="checkbox"
                                                                id="editIsDefault"
                                                                checked={editKey.isDefault}
                                                                onChange={(e) => setEditKey({ ...editKey, isDefault: e.target.checked })}
                                                                className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/50"
                                                            />
                                                            <label htmlFor="editIsDefault" className="text-sm text-primary-300">Set as default</label>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={saveEdit}
                                                                className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-sm rounded-lg border border-purple-500/30 transition-all duration-200"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={cancelEditing}
                                                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-primary-300 text-sm rounded-lg border border-white/10 transition-all duration-200"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-sm font-medium text-white">{key.label}</span>
                                                                {key.isDefault && (
                                                                    <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">Default</span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-primary-400/60 mb-1">Account: {key.account}</p>
                                                            <p className="text-xs text-primary-400/60 mb-1">Provider: {key.provider}</p>
                                                            <p className="text-xs text-primary-400/60 mb-1">
                                                                API Key: <span className="font-mono">{showKeyIds.has(key.id) ? key.maskedKey.replace(/\*/g, '#') : key.maskedKey}</span>
                                                                <button
                                                                    onClick={() => toggleShowKey(key.id)}
                                                                    className="ml-2 text-purple-300 hover:text-purple-200"
                                                                >
                                                                    {showKeyIds.has(key.id) ? (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 inline" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                                                                            <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                                                                        </svg>
                                                                    ) : (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 inline" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                                                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            </p>
                                                            {key.baseUrl && (
                                                                <p className="text-xs text-primary-400/60 mb-1">Base URL: {key.baseUrl}</p>
                                                            )}
                                                            {key.models.length > 0 && (
                                                                <p className="text-xs text-primary-400/60">Models: {key.models.join(", ")}</p>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => startEditing(key)}
                                                                className="p-1.5 text-primary-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-all duration-200"
                                                                title="Edit"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                                </svg>
                                                            </button>
                                                            {!key.isDefault && (
                                                                <button
                                                                    onClick={() => handleSetDefault(key.id)}
                                                                    className="p-1.5 text-primary-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-all duration-200"
                                                                    title="Set as Default"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleDeleteKey(key.id)}
                                                                className="p-1.5 text-primary-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                                                                title="Delete"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {apiKeys.length === 0 && !showAddForm && (
                                            <div className="text-center py-8 text-primary-400/60 text-sm">
                                                No API keys added yet. Click "Add Key" to get started.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SettingsModal;
