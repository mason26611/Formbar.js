import fs = require("fs");
import winston = require("winston");
require("winston-daily-rotate-file");
import path = require("path");

const logsDir = "logs";

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

const dailyRotateTransport = new (winston.transports as Record<string, unknown> & typeof winston.transports & { DailyRotateFile: new (opts: Record<string, unknown>) => winston.transport }).DailyRotateFile({
    filename: path.join(logsDir, "app-%DATE%.ndjson"),
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxFiles: "14d",
    level: "info",
    format: winston.format.json(),
});

function deleteEmptyLogFiles(): void {
    try {
        fs.readdirSync("logs").forEach((file) => {
            const currentDate = new Date().toISOString().split("T")[0];
            if (fs.statSync(`logs/${file}`).size === 0 && !file.includes(currentDate)) {
                fs.unlinkSync(`logs/${file}`);
            }
        });
    } catch {
        // Silently ignore errors during cleanup
    }
}

async function loadSeqTransport(): Promise<new (opts: Record<string, unknown>) => winston.transport> {
    const seqModule = await import("@datalust/winston-seq");
    return seqModule.SeqTransport as unknown as new (opts: Record<string, unknown>) => winston.transport;
}

async function createLogger(): Promise<winston.Logger> {
    deleteEmptyLogFiles();
    const SeqTransport = await loadSeqTransport();

    const transports: winston.transport[] = [];
    transports.push(dailyRotateTransport);

    if (process.env.SEQ_URL) {
        transports.push(
            new SeqTransport({
                level: "info",
                serverUrl: process.env.SEQ_URL,
            })
        );
    }

    return winston.createLogger({
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports,
    });
}

function logEvent(logger: winston.Logger, level: string, event: string, message: string = "", meta: Record<string, unknown> = {}): void {
    logger.log({
        level: level,
        event: event,
        message: message,
        ...meta,
    });
}

let logger: winston.Logger | undefined;

async function getLogger(): Promise<winston.Logger> {
    if (!logger) {
        logger = await createLogger();
    }

    return logger;
}

module.exports = {
    getLogger,
    logEvent,
};
