import { jest } from "@jest/globals";

const originalWarn = console.warn;
jest.spyOn(console, "warn").mockImplementation((msg, ...args) => {
    // Suppress specific Arcjet local IP warning
    if (typeof msg === "string" && msg.includes("Arcjet will use 127.0.0.1")) {
        return;
    }
    // Let all other warnings through
    originalWarn(msg, ...args);
});