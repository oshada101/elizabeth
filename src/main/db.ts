import Database from "better-sqlite3";
import { app } from 'electron';
import { join } from 'path';

const userDataPath = app.getPath('userData');
const dbPath = join(userDataPath, 'app.db');

export const db = new Database(dbPath);
