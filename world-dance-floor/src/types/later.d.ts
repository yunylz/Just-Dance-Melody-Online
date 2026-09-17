// Minimal type declarations for the 'later' package (no official @types)
declare module "later" {
    interface ParseResult {
        schedules: object[];
        exceptions: object[];
        error: number;
    }

    interface Recur {
        on(...args: number[]): Recur;
        hour(): Recur;
        minute(): Recur;
        second(): Recur;
        dayOfWeek(): Recur;
        dayOfMonth(): Recur;
        month(): Recur;
    }

    interface Schedule {
        next(count: number, start?: Date): Date | Date[];
        prev(count: number, start?: Date): Date | Date[];
    }

    const parse: {
        recur(): Recur;
        text(text: string): ParseResult;
        cron(expr: string): ParseResult;
    };

    function schedule(recur: Recur | ParseResult): Schedule;

    function setInterval(fn: () => void, sched: Recur | ParseResult): { clear(): void };
    function setTimeout(fn: () => void, sched: Recur | ParseResult): { clear(): void };
}
