import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createAgent, tool } from "langchain";
import Database from "better-sqlite3";
import z from "zod";
import { getDefaultApiKey } from "./keyManager";
import { app } from 'electron';
import { join } from 'path';

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
              configuration: {
                  baseURL: baseUrl,
              },
          })
        : new ChatOpenAI({
              model: model,
              apiKey: key,
              configuration: {
                  baseURL: "https://openrouter.ai/api/v1",
              },
          });
}

const userDataPath = app.getPath('userData');
const dbPath = join(userDataPath, 'app.db');
export const db = new Database(dbPath);
export const saver = new SqliteSaver(db);

export async function invokeAgent(messages: any, config: any) {
    const model = await getModel();
    const agent = createAgent({
        model,
        tools: [getWeather],
        systemPrompt: "You are a helpful assistant.",
        checkpointer: saver,
    });
    return (agent as any).invoke(messages, config);
}
