import type { ClassroomRow, CustomPollRow, PollHistoryRow, PollAnswerRow } from "../types/database";
import type { UserState, PollRuntimeShape } from "../types/stores";

// --- Require statements with type assertions (CommonJS pattern) ---

const { classStateStore } = require("@services/classroom-service") as {
    classStateStore: {
        getClassroom: (classId: string | number) => ClassData | undefined;
        getUser: (email: string) => UserState | undefined;
    };
};

const { generateColors } = require("@modules/util") as {
    generateColors: (amount: number) => string[];
};

const { advancedEmitToClass, userUpdateSocket } = require("@services/socket-updates-service") as {
    advancedEmitToClass: (event: string, classId: number, options: Record<string, unknown>, ...data: unknown[]) => void;
    userUpdateSocket: (email: string, methodName: string, ...args: unknown[]) => void;
};

const { database, dbGet: _dbGet, dbGetAll: _dbGetAll, dbRun: _dbRun } = require("@modules/database") as {
    database: {
        run: (sql: string, params: unknown[], cb: (err: Error | null) => void) => void;
    };
    dbGet: (query: string, params?: unknown[]) => Promise<unknown>;
    dbGetAll: (query: string, params?: unknown[]) => Promise<unknown[]>;
    dbRun: (query: string, params?: unknown[]) => Promise<number>;
};

const { MANAGER_PERMISSIONS } = require("@modules/permissions") as { MANAGER_PERMISSIONS: number };

const { userSocketUpdates } = require("../sockets/init") as {
    userSocketUpdates: Map<string, Map<string, { classUpdate: (classId: number, options?: Record<string, unknown>) => void }>>;
};

const NotFoundError = require("@errors/not-found-error") as new (message: string) => Error;
const ValidationError = require("@errors/validation-error") as new (message: string) => Error;
const ForbiddenError = require("@errors/forbidden-error") as new (message: string) => Error;

const { requireInternalParam } = require("@modules/error-wrapper") as {
    requireInternalParam: (param: unknown, name: string) => void;
};

const { pollRuntimeStore } = require("@stores/poll-runtime-store") as {
    pollRuntimeStore: {
        resetPogMeterTracker: (classId: number) => void;
        clearPogMeterTracker: (classId: number) => void;
        hasPogMeterIncreased: (classId: number, email: string) => boolean;
        markPogMeterIncreased: (classId: number, email: string) => void;
        setPollStartTime: (classId: number, timestamp: number) => void;
        getPollStartTime: (classId: number) => number | null;
        clearPollStartTime: (classId: number) => void;
        setLastSavedPollId: (classId: number, pollId: number) => void;
        getLastSavedPollId: (classId: number) => number | null;
        clearLastSavedPollId: (classId: number) => void;
    };
};

const logger = require("@modules/logger") as { log: (level: string, msg: string) => void };

// --- Generic typed wrappers for database functions ---

const dbGet = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | undefined> => _dbGet(query, params) as Promise<T | undefined>;
const dbGetAll = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => _dbGetAll(query, params) as Promise<T[]>;
const dbRun = (query: string, params?: unknown[]): Promise<number> => _dbRun(query, params);

// --- Local Interfaces ---

interface PollResponse {
    answer: string;
    weight: number;
    color: string;
    correct?: boolean;
    responses?: number;
}

interface AnswerInput {
    answer?: string;
    weight?: number;
    color?: string;
    correct?: boolean;
}

interface PollData {
    prompt: string;
    answers: Record<number, AnswerInput>;
    blind: boolean;
    tags: string[];
    weight: number;
    excludedRespondents: (number | string)[];
    allowVoteChanges: boolean;
    indeterminate: boolean;
    allowTextResponses: boolean;
    allowMultipleResponses: boolean;
}

interface PollState {
    status: boolean;
    prompt: string;
    responses: PollResponse[];
    allowTextResponses: boolean;
    allowMultipleResponses: boolean;
    allowVoteChanges: boolean;
    blind: boolean;
    weight: number;
    excludedRespondents: number[];
    startTime?: number;
    studentsAllowedToVote?: number[];
    [key: string]: unknown;
}

interface StudentPollRes {
    buttonRes: string | string[];
    textRes: string;
    time: Date | string;
}

interface ClassStudent {
    email: string;
    id: number;
    pollRes: StudentPollRes;
    classPermissions: number;
    pogMeter: number;
    tags?: string[];
    [key: string]: unknown;
}

interface ClassData {
    id: number;
    isActive: boolean;
    poll: PollState;
    students: Record<string, ClassStudent>;
    settings: Record<string, unknown>;
    [key: string]: unknown;
}

interface UserSession {
    email: string;
    classId?: number;
    id?: number;
    [key: string]: unknown;
}

interface ProcessedPollHistory {
    id: number;
    class: number;
    prompt: string | null;
    responses: PollResponse[] | null;
    allowMultipleResponses: boolean;
    blind: boolean;
    allowTextResponses: boolean;
    createdAt: number;
}

// --- Helper Functions ---

/**
 * Gets a classroom by ID and throws an error if not found.
 */
function getClassroom(classId: number): ClassData {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        throw new NotFoundError("Classroom not found");
    }
    return classroom;
}

/**
 * Resets all students' poll responses in a classroom.
 */
function resetStudentPollResponses(classroom: ClassData): void {
    for (const key in classroom.students) {
        classroom.students[key].pollRes.buttonRes = "";
        classroom.students[key].pollRes.textRes = "";
    }
}

/**
 * Checks if a user is excluded from voting in a poll.
 */
function isUserExcludedFromVoting(classroom: ClassData, user: UserState, student: ClassStudent | undefined): boolean {
    // Check if user is excluded from voting using poll.excludedRespondents
    if (classroom.poll.excludedRespondents && classroom.poll.excludedRespondents.includes(user.id)) {
        logger.log("info", `[pollResponse] User ${user.id} is excluded from voting`);
        return true;
    }

    // Check if user has the "Excluded" tag
    if (student && student.tags && Array.isArray(student.tags) && student.tags.includes("Excluded")) {
        logger.log("info", `[pollResponse] User ${user.id} is excluded from voting due to Excluded tag`);
        return true;
    }

    return false;
}

/**
 * Validates if a poll response is valid for the current poll.
 */
function isValidPollResponse(poll: PollState, res: string | string[], isRemoving: boolean): boolean {
    if (!poll.allowMultipleResponses) {
        if (res !== "remove" && !poll.responses.some((response) => response.answer === res)) {
            return false;
        }
    } else {
        if (isRemoving) {
            return true;
        } else if (!Array.isArray(res)) {
            return false;
        } else {
            const validResponses = poll.responses.map((r) => r.answer);
            const allValid = res.every((response) => validResponses.includes(response));
            if (!allValid) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Calculates the weight of a poll response.
 */
function calculateResponseWeight(poll: PollState, res: string | string[]): number {
    let resWeight: number;

    if (poll.allowMultipleResponses && Array.isArray(res)) {
        // Sum weights for all selected responses
        resWeight = res.reduce((sum: number, answer: string) => {
            const responseObj = poll.responses.find((response) => response.answer === answer);
            return sum + (responseObj ? responseObj.weight : 1);
        }, 0);
    } else {
        // Single response
        const responseObj = poll.responses.find((response) => response.answer === res);
        resWeight = responseObj ? responseObj.weight : 1;
    }

    return resWeight;
}

/**
 * Updates a student's poll response state.
 */
function updateStudentPollResponse(
    student: ClassStudent,
    res: string | string[],
    textRes: string,
    isRemoving: boolean,
    allowMultipleResponses: boolean
): void {
    if (isRemoving) {
        student.pollRes.buttonRes = allowMultipleResponses ? [] : "";
        student.pollRes.textRes = "";
        student.pollRes.time = "";
    } else {
        student.pollRes.buttonRes = res;
        student.pollRes.textRes = textRes;
        student.pollRes.time = new Date();
    }
}

/**
 * Broadcasts a class update to all user sockets.
 */
function broadcastClassUpdate(email: string, classId: number): void {
    userUpdateSocket(email, "classUpdate", classId, { global: true });
}

// --- Main Service Functions ---

/**
 * Creates a new poll in the class.
 */
async function createPoll(classId: number, pollData: PollData, userData: UserSession): Promise<void> {
    const { prompt, answers, blind, tags, weight, excludedRespondents, allowVoteChanges, indeterminate, allowTextResponses, allowMultipleResponses } =
        pollData;
    const numberOfResponses = Object.keys(answers).length;

    requireInternalParam(classId, "classId");
    requireInternalParam(pollData, "pollData");
    requireInternalParam(userData, "userData");

    pollRuntimeStore.resetPogMeterTracker(classId);

    const classroom = getClassroom(classId);

    // Check if the class is active before continuing
    if (!classroom.isActive) {
        throw new ValidationError("This class is not currently active");
    }

    await clearPoll(classId, userData, false);
    const generatedColors = generateColors(Object.keys(answers).length);

    classroom.poll.allowVoteChanges = allowVoteChanges;
    classroom.poll.blind = blind;
    classroom.poll.status = true;

    // If excludedRespondents is provided and is a non-empty array, use it directly
    if (excludedRespondents && Array.isArray(excludedRespondents) && excludedRespondents.length > 0) {
        classroom.poll.excludedRespondents = excludedRespondents.map((id) => Number(id));
    }

    // Creates an object for every answer possible the teacher is allowing
    const letterString = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < numberOfResponses; i++) {
        let answer = letterString[i];
        let answerWeight = 1;
        let color = generatedColors[i];

        if (answers[i].answer) {
            answer = answers[i].answer as string;
        }

        if (answers[i].weight) {
            if (isNaN(answers[i].weight as number) || (answers[i].weight as number) <= 0) answerWeight = 1;
            answerWeight = Math.floor((answers[i].weight as number) * 100) / 100;
            answerWeight = answerWeight > 5 ? 5 : answerWeight;
        }

        if (answers[i].color) {
            color = answers[i].color as string;
        }

        classroom.poll.responses.push({
            answer: answer,
            weight: answerWeight,
            color: color,
            correct: answers[i].correct,
        });
    }

    const pollStartTime = Date.now();

    // Set the poll's data in the classroom
    pollRuntimeStore.setPollStartTime(classId, pollStartTime);
    classroom.poll.startTime = pollStartTime;
    classroom.poll.weight = weight;
    classroom.poll.allowTextResponses = allowTextResponses;
    classroom.poll.prompt = prompt;
    classroom.poll.allowMultipleResponses = allowMultipleResponses;

    resetStudentPollResponses(classroom);
    broadcastClassUpdate(userData.email, classId);
}

/**
 * Updates poll properties dynamically. Can update individual properties or clear the entire poll.
 */
async function updatePoll(classId: number, options: Record<string, unknown>, userSession: UserSession): Promise<boolean> {
    // If no classId or options provided, throw validation error
    if (!classId || !options) {
        throw new ValidationError("Missing classId or options");
    }

    const classroom = getClassroom(classId);

    // If an empty object is sent, clear the current poll
    const optionsKeys = Object.keys(options);
    if (optionsKeys.length === 0) {
        await clearPoll(classId, userSession);
        return true;
    }

    // Update each poll property
    for (const option of Object.keys(options)) {
        let value = options[option];

        // Save to history when ending poll
        if (option === "status" && value === false && classroom.poll.status === true) {
            const savedPollId = await savePollToHistory(classId);
            pollRuntimeStore.setLastSavedPollId(classId, savedPollId);
        }

        // If studentsAllowedToVote is being changed, then ensure it always contains numbers
        if (option === "studentsAllowedToVote" && Array.isArray(value)) {
            value = value.map((id: unknown) => Number(id));
        }

        // Update the property if it exists in the poll object
        if (option in classroom.poll) {
            classroom.poll[option] = value;
        }
    }

    // Broadcast update to all tabs
    const userSockets = userSocketUpdates.get(userSession.email);
    if (userSockets && userSockets.size > 0) {
        const firstSocket = userSockets.values().next().value;
        if (firstSocket) {
            firstSocket.classUpdate(classId, { global: true });
        }
    }
    return true;
}

/**
 * Gets previous polls for a class from the database with pagination.
 * Post-processes results to ensure proper types (booleans as actual booleans, responses as parsed objects).
 */
async function getPreviousPolls(classId: number, index: number = 0, limit: number = 20): Promise<ProcessedPollHistory[]> {
    requireInternalParam(classId, "classId");
    const polls = await dbGetAll<PollHistoryRow>("SELECT * FROM poll_history WHERE class = ? ORDER BY id DESC LIMIT ?, ?", [classId, index, limit]);

    return polls.map((poll) => {
        let parsedResponses: PollResponse[] | null = null;

        // Parse responses from JSON string to object
        if (typeof poll.responses === "string") {
            try {
                parsedResponses = JSON.parse(poll.responses) as PollResponse[];
            } catch (_err) {
                parsedResponses = null;
            }
        }

        return {
            id: poll.id,
            class: poll.class,
            prompt: poll.prompt,
            responses: parsedResponses,
            // Convert to booleans for API consistency
            allowMultipleResponses: !!poll.allowMultipleResponses,
            blind: !!poll.blind,
            allowTextResponses: !!poll.allowTextResponses,
            createdAt: poll.createdAt,
        };
    });
}

/**
 * Saves the current poll data to the poll history table in the database.
 */
async function savePollToHistory(classId: number): Promise<number> {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return 0;

    const createdAt = Date.now();
    const prompt = classroom.poll.prompt;
    const responses = JSON.stringify(classroom.poll.responses);
    const allowMultipleResponses = classroom.poll.allowMultipleResponses ? 1 : 0;
    const blind = classroom.poll.blind ? 1 : 0;
    const allowTextResponses = classroom.poll.allowTextResponses ? 1 : 0;

    return dbRun(
        "INSERT INTO poll_history(class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)",
        [classId, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt]
    );
}

/**
 * Clears the current poll in the specified class, optionally updates the class state,
 * and saves poll answers to the database.
 */
async function clearPoll(classId: number, userSession: UserSession, updateClass: boolean = true): Promise<void> {
    const classroom = classStateStore.getClassroom(classId) as ClassData | undefined;
    if (!classroom) return;

    if (classroom.poll.status) {
        await updatePoll(classId, { status: false }, userSession);
    }

    const currentPollId = pollRuntimeStore.getLastSavedPollId(classId);

    classroom.poll.responses = [];
    classroom.poll.prompt = "";
    classroom.poll = {
        status: false,
        responses: [],
        allowTextResponses: false,
        prompt: "",
        weight: 1,
        blind: false,
        excludedRespondents: [],
        allowMultipleResponses: false,
        allowVoteChanges: false,
    };

    // Adds data to the previous poll answers table upon clearing the poll
    if (!currentPollId) {
        if (updateClass && userSession) {
            broadcastClassUpdate(userSession.email, classId);
        }
        pollRuntimeStore.clearPogMeterTracker(classId);
        pollRuntimeStore.clearLastSavedPollId(classId);
        pollRuntimeStore.clearPollStartTime(classId);
        return;
    }

    for (const student of Object.values(classroom.students)) {
        if (student.classPermissions < MANAGER_PERMISSIONS) {
            const buttonRes = student.pollRes.buttonRes;
            let buttonResponse: string | null = null;
            if (Array.isArray(buttonRes) && buttonRes.length > 0) {
                // Multi-response: store the full array
                buttonResponse = JSON.stringify(buttonRes);
            } else if (!Array.isArray(buttonRes) && buttonRes !== "" && buttonRes !== null && buttonRes !== undefined) {
                // Single response: wrap in an array
                buttonResponse = JSON.stringify([buttonRes]);
            }

            const textResponse = student.pollRes.textRes || null;

            // Skip students with no response at all
            if (buttonResponse === null && textResponse === null) continue;

            const studentId = student.id;
            await dbRun(
                "INSERT OR REPLACE INTO poll_answers(pollId, classId, userId, buttonResponse, textResponse, createdAt) VALUES(?, ?, ?, ?, ?, ?)",
                [currentPollId, classId, studentId, buttonResponse, textResponse, Date.now()]
            );
        }
    }

    if (updateClass && userSession) {
        broadcastClassUpdate(userSession.email, classId);
    }

    pollRuntimeStore.clearPogMeterTracker(classId);
    pollRuntimeStore.clearLastSavedPollId(classId);
    pollRuntimeStore.clearPollStartTime(classId);
}

/**
 * Handles a student's poll response, updates their answer, manages pog meter, and triggers class updates.
 */
function sendPollResponse(classId: number, res: string | string[], textRes: string, userSession: UserSession): void {
    const _resLength = textRes != null ? textRes.length : 0;

    const email = userSession.email;
    const user = classStateStore.getUser(email);
    const classroom = classStateStore.getClassroom(classId);

    // If the classroom does not exist, return
    if (!classroom) {
        return;
    }

    // If there's no poll or the poll is not active, return
    if (!classroom.poll || !classroom.poll.status) {
        return;
    }

    const student = classroom.students[email];

    // Check if user is excluded from voting
    if (isUserExcludedFromVoting(classroom, user as UserState, student)) {
        return;
    }

    // If the user's response has not changed, return
    const prevRes = student.pollRes.buttonRes;
    let hasChanged = classroom.poll.allowMultipleResponses ? JSON.stringify(prevRes) !== JSON.stringify(res) : prevRes !== res;

    if (!classroom.poll.allowVoteChanges && prevRes !== "" && JSON.stringify(prevRes) !== JSON.stringify(res)) {
        return;
    }

    const isRemoving = res === "remove" || (classroom.poll.allowMultipleResponses && Array.isArray(res) && res.length === 0);

    // Validate poll response
    if (!isValidPollResponse(classroom.poll, res, isRemoving)) {
        return;
    }

    // If the user is removing their response and they previously had no response, do not play sound
    if (isRemoving && prevRes === "") {
        hasChanged = false;
    }

    if (hasChanged || student.pollRes.textRes !== textRes) {
        if (isRemoving) {
            advancedEmitToClass("removePollSound", classId, {});
        } else {
            advancedEmitToClass("pollSound", classId, {});
        }
    }

    // Update student's poll response
    updateStudentPollResponse(student, res, textRes, isRemoving, classroom.poll.allowMultipleResponses);

    // Handle pog meter updates
    if (!isRemoving && !pollRuntimeStore.hasPogMeterIncreased(classId, email)) {
        const resWeight = calculateResponseWeight(classroom.poll, res);

        // Increase pog meter by 100 times the weight of the response
        // If pog meter reaches 500, increase digipogs by 1 and reset pog meter to 0
        const pogMeterIncrease = Math.floor(100 * resWeight);
        student.pogMeter += pogMeterIncrease;
        if (student.pogMeter >= 500) {
            student.pogMeter -= 500;
            const addPogs = Math.floor(Math.random() * 10) + 1; // Randomly add between 1 and 10 digipogs
            database.run("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [addPogs, (user as UserState).id], (err: Error | null) => {
                if (err) {
                    // Error handled silently (matching original behavior)
                }
            });
        }
        pollRuntimeStore.markPogMeterIncreased(classId, email);
    }

    broadcastClassUpdate(email, classId);
}

/**
 * Function to get the poll responses in a class.
 */
function getPollResponses(classData: ClassData): Record<string, PollResponse> {
    // Create an empty object to store the poll responses
    const tempPolls: Record<string, PollResponse> = {};

    // If the poll is not active, return an empty object
    if (!classData.poll.status) return {};

    // If there are no responses to the poll, return an empty object
    if (classData.poll.responses.length === 0) return {};

    // For each response in the poll responses
    for (const resValue of classData.poll.responses) {
        // Add the response to the tempPolls object and initialize the count of responses to 0
        tempPolls[resValue.answer] = {
            ...resValue,
            responses: 0,
        };
    }

    // For each student in the class
    for (const student of Object.values(classData.students)) {
        // If the student exists and has responded to the poll
        if (student && Object.keys(tempPolls).includes(student.pollRes.buttonRes as string)) {
            // Increment the count of responses for the student's response
            tempPolls[student.pollRes.buttonRes as string].responses++;
        }
    }

    // Return the tempPolls object
    return tempPolls;
}

/**
 * Gets the current poll for an active class and validates access.
 */
async function getCurrentPoll(classId: number | string, userData: UserSession): Promise<PollState & { totalStudents: number }> {
    requireInternalParam(classId, "classId");
    requireInternalParam(userData, "userData");

    const classroom = classStateStore.getClassroom(classId);

    if (!classroom) {
        const classroomRow = await dbGet<ClassroomRow>("SELECT id FROM classroom WHERE id = ?", [classId]);
        if (classroomRow) {
            throw new NotFoundError("This class is not currently active");
        }
        throw new NotFoundError("This class does not exist");
    }

    if (!classroom.students[userData.email]) {
        throw new ForbiddenError("You do not have permission to view polls in this class");
    }

    const poll = structuredClone(classroom.poll);
    return {
        ...poll,
        status: poll.status,
        totalStudents: Object.keys(classroom.students).length,
    };
}

/**
 * Deletes all custom polls owned by a user
 */
async function deleteCustomPolls(userId: number): Promise<void> {
    const customPolls = await dbGetAll<CustomPollRow>("SELECT * FROM custom_polls WHERE owner=?", [userId]);
    if (customPolls.length === 0) return;

    await dbRun("DELETE FROM custom_polls WHERE owner=?", [userId]);
    for (const customPoll of customPolls) {
        await dbRun("DELETE FROM shared_polls WHERE pollId=?", [customPoll.id]);
    }
}

module.exports = {
    createPoll,
    updatePoll,
    getPreviousPolls,
    getCurrentPoll,
    savePollToHistory,
    clearPoll,
    sendPollResponse,
    getPollResponses,
    deleteCustomPolls,
    pollRuntimeStore,
};
