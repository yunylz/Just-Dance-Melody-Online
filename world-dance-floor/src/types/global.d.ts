// Global variable declarations for the WDF server

declare global {
    var root: string;
    var project: {
        name: string;
        version: string;
        description: string;
        [key: string]: unknown;
    };
}

export {};
