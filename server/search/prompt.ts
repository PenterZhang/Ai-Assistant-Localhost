import { buildSearchPrompt as _buildSearchPrompt } from "../llm/prompts";

export function buildSearchPrompt(query: string, context: string): string {
    return _buildSearchPrompt(query, context);
}
