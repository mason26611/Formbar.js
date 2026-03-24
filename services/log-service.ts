import fs = require("fs");
const fsPromises = fs.promises;
const logDir = "logs/";
const AppError = require("@errors/app-error");

async function getAllLogs(): Promise<string[]> {
    try {
        const files = await fsPromises.readdir(logDir);
        const logs = await Promise.all(
            files
                .filter((fileName: string) => fileName.endsWith(".log"))
                .map(async (fileName: string): Promise<string | null> => {
                    try {
                        const stat = await fsPromises.stat(`${logDir}${fileName}`);
                        return stat.size > 0 ? fileName : null;
                    } catch (_e) {
                        return null;
                    }
                })
        );
        return logs.filter((log): log is string => log !== null);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new AppError(`Failed to retrieve logs: ${message}`, { statusCode: 500, event: "logs.get.failed", reason: "read_directory_error" });
    }
}

async function getLog(logFileName: string): Promise<string> {
    try {
        const content = await fsPromises.readFile(`${logDir}${logFileName}`, "utf8");
        return content;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new AppError(`Failed to read log file ${logFileName}: ${message}`, {
            statusCode: 500,
            event: "logs.get.failed",
            reason: "read_file_error",
        });
    }
}

module.exports = {
    getAllLogs,
    getLog,
};
