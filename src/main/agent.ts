import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createAgent, tool } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import Database from "better-sqlite3";
import z from "zod";
import { getDefaultApiKey } from "./keyManager";
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import log from "electron-log";

const getWeather = tool(
    (input: { city: string }) => `It's always sunny in ${input.city}!`,
    {
        name: "get_weather",
        description: "Get the weather for a given city",
        schema: z.object({
            city: z.string().describe("The city to get the weather for"),
        }),
    },
);

async function getModel() {
    const { key, model, provider, baseUrl } = await getDefaultApiKey();

    if (!model || !key) {
        throw new Error('Model or API key is missing'); 
    }
    return baseUrl
        ? new ChatOpenAI({
              model: model,
              apiKey: key,
              streaming: true,
              configuration: {
                  baseURL: baseUrl,
              },
          })
        : new ChatOpenAI({
              model: model,
              apiKey: key,
              streaming: true,
              configuration: {
                  baseURL: "https://openrouter.ai/api/v1",
              },
          });
}

const userDataPath = app.getPath('userData');
const dbPath = join(userDataPath, 'app.db');
export const db = new Database(dbPath);
export const saver = new SqliteSaver(db);

export async function streamAgent(messages: any[], config: any, window: BrowserWindow | null) {
    const model = await getModel();
    const agent = createAgent({
        model,
        tools: [getWeather],
        systemPrompt: "You are a helpful assistant.",
        checkpointer: saver,
    });

    let currentTool: string | null = null;
    let currentContent = "";

    try {
        for await (const event of (agent as any).streamEvents(messages, config, {
            version: "v1"
        })) {
            const eventType = event.event;
            const data = event.data;

            if (eventType === "on_chat_model_stream") {
                const chunk = data?.chunk?.content;
                if (chunk) {
                    currentContent += chunk;
                    window?.webContents.send("ask:chunk", { type: "content", content: chunk });
                }
            } else if (eventType === "on_tool_start") {
                currentTool = data?.input?.name || event.name;
                window?.webContents.send("ask:tool", { type: "tool_start", tool: currentTool });
                log.info(`Tool started: ${currentTool}`);
            } else if (eventType === "on_tool_end") {
                const toolName = currentTool;
                currentTool = null;
                window?.webContents.send("ask:tool", { type: "tool_end", tool: toolName });
                log.info(`Tool ended: ${toolName}`);
            }
        }

        window?.webContents.send("ask:done", { content: currentContent });
        return currentContent;
    } catch (error) {
        log.error("Streaming error:", error);
        window?.webContents.send("ask:error", { error: String(error) });
        throw error;
    }
}
