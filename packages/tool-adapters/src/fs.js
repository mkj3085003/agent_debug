import fs from "node:fs/promises";
export async function readText(path) {
    return fs.readFile(path, "utf8");
}
export async function writeText(path, data) {
    await fs.writeFile(path, data, "utf8");
}
//# sourceMappingURL=fs.js.map