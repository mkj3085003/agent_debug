export function nowIso() {
    return new Date().toISOString();
}
export function makeSessionId(prefix = "sess") {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now()}_${rand}`;
}
export function makeCallId(prefix = "call") {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now()}_${rand}`;
}
//# sourceMappingURL=utils.js.map