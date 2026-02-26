export interface HttpInput {
    url: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
}
export interface HttpResult {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export declare function httpRequest(_input: HttpInput): Promise<HttpResult>;
//# sourceMappingURL=network.d.ts.map