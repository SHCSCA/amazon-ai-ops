// 职责模块保留原有公开接口及安全校验边界。


export function stamp(): string {
    return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`;
}

export let lastGeneratedTimestampMs = 0;

export function isoNow(): string {
    const nextTimestampMs = Math.max(Date.now(), lastGeneratedTimestampMs + 1);
    lastGeneratedTimestampMs = nextTimestampMs;
    return new Date(nextTimestampMs).toISOString();
}

export function isoAfter(value: string): string {
    const floor = Date.parse(value);
    if (!Number.isFinite(floor))
        throw new Error('resume updatedAt must be a valid timestamp');
    const nextTimestampMs = Math.max(Date.now(), lastGeneratedTimestampMs + 1, floor + 1);
    lastGeneratedTimestampMs = nextTimestampMs;
    return new Date(nextTimestampMs).toISOString();
}
