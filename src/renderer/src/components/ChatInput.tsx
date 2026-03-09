import React, { useState, useCallback, memo } from "react";

interface ChatInputProps {
    onSubmit: (value: string) => void;
    placeholder: string;
    disabled: boolean;
}

function ChatInput({ onSubmit, placeholder, disabled }: ChatInputProps) {
    const [value, setValue] = useState("");

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!value.trim() || disabled) return;
        onSubmit(value);
        setValue("");
    }, [value, disabled, onSubmit]);

    return (
        <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
            <div className="flex gap-2">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500/50"
                />
                <button
                    type="submit"
                    disabled={disabled || !value.trim()}
                    className="px-4 py-2 bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 rounded-xl transition-colors disabled:opacity-50"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </button>
            </div>
        </form>
    );
}

export default memo(ChatInput);
