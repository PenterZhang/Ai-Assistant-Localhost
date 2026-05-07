import path from "path";
import fs from "fs";
import type { AppConfig } from "./types";

export const ROOT = process.env.APP_ROOT || process.cwd();
export const CFG: AppConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"),
);

export function saveConfig(): void {
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
}
