/**
 * Content Hoarder
 * Collect content from URLs and feeds, then create articles in your voice
 */
interface StorageProxy {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
    list(prefix?: string): Promise<string[]>;
    getMany(keys: string[]): Promise<Record<string, unknown>>;
    setMany(entries: Record<string, unknown>): Promise<void>;
}
interface ConfigContext {
    get(key: string): string | undefined;
    has(key: string): boolean;
    keys(): string[];
}
type ActionResult = {
    responseMode: 'template' | 'passthrough';
    agentData?: Record<string, unknown>;
    userContent?: Record<string, unknown>;
};
type InvokeInput = {
    action: string;
    input: Record<string, unknown>;
    storage?: StorageProxy;
    config?: ConfigContext;
};
declare class ContentHoarderTrik {
    invoke(input: InvokeInput): Promise<ActionResult>;
}
declare const _default: ContentHoarderTrik;
export default _default;
