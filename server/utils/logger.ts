// 统一日志模块
// 所有文件 import { log } from "../utils/logger" 即可

function timestamp(): string {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function format(tag: string, msg: string): string {
    return `[${timestamp()}] [${tag}] ${msg}`;
}

export const log = {
    info: (tag: string, msg: string) => console.log(format(tag, msg)),
    warn: (tag: string, msg: string) => console.warn(format(tag, msg)),
    error: (tag: string, msg: string) => console.error(format(tag, msg)),
};

// 全局拦截：让所有 console.log 也走统一格式
// 这样不用改现有代码，自动生效
const _log = console.log;
const _warn = console.warn;
const _error = console.error;

console.log = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[")) {
        // 已经有 [tag] 前缀的，加时间戳
        _log(`[${timestamp()}]`, ...args);
    } else {
        _log(`[${timestamp()}]`, ...args);
    }
};

console.warn = (...args: any[]) => {
    _warn(`[${timestamp()}]`, ...args);
};

console.error = (...args: any[]) => {
    _error(`[${timestamp()}]`, ...args);
};
