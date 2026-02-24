const { database } = require("../database");
const { MOD_PERMISSIONS, STUDENT_PERMISSIONS, DEFAULT_CLASS_PERMISSIONS } = require("../permissions");
const { ClassStateStore } = require("@stores/class-state-store");
const { classCodeCacheStore } = require("@stores/class-code-cache-store");

const classStateStore = new ClassStateStore();
const DEFAULT_CLASS_SETTINGS = {
    mute: false,
    filter: "",
    sort: "",
    isExcluded: {
        guests: false,
        mods: true,
        teachers: true,
    },
};

// This class is used to add a new classroom to the session data
// The classroom will be used to add lessons, do lessons, and for the teacher to operate them
class Classroom {
    constructor({ id, className, key, owner, permissions, tags, settings } = {}) {
        this.id = id;
        this.className = className;
        this.isActive = false;
        this.owner = owner;
        this.students = {};
        this.poll = {
            status: false,
            prompt: "",
            responses: [],
            allowTextResponses: false,
            allowMultipleResponses: false,
            blind: false,
            weight: 1,
            excludedRespondents: [],
        };
        this.key = key;

        // Ensure permissions is an object, not a JSON string
        try {
            this.permissions = typeof permissions === "string" ? JSON.parse(permissions) : permissions || DEFAULT_CLASS_PERMISSIONS;
        } catch (err) {
            // Fallback to defaults if parsing fails
            this.permissions = DEFAULT_CLASS_PERMISSIONS;
        }

        this.tags = tags || ["Offline", "Excluded"];
        this.settings = settings || DEFAULT_CLASS_SETTINGS;
        this.timer = {
            startTime: 0,
            timeLeft: 0,
            active: false,
            sound: false,
        };

        // Ensure all default settings are present
        for (const settingKey of Object.keys(DEFAULT_CLASS_SETTINGS)) {
            if (!this.settings[settingKey]) {
                this.settings[settingKey] = DEFAULT_CLASS_SETTINGS[settingKey];
            }
        }

        if (!this.tags.includes("Offline") && Array.isArray(this.tags)) {
            this.tags.push("Offline");
        }
    }
}

/**
 * Asynchronous function to get the users of a class.
 * @param {Object} user - The user object.
 * @param {string} key - The class key.
 * @returns {Promise|Object} A promise that resolves to the class users or an error object.
 */
async function getClassUsers(user, key) {
    try {
        // Get the class permissions of the user
        let classPermissions = user.classPermissions;

        // Query the database for the users of the class
        let dbClassUsers = await new Promise((resolve, reject) => {
            database.all(
                "SELECT DISTINCT users.id, users.email, users.permissions, CASE WHEN users.id = classroom.owner THEN 5 ELSE COALESCE(classusers.permissions, 1) END AS classPermissions FROM users INNER JOIN classroom ON classroom.key = ? LEFT JOIN classusers ON users.id = classusers.studentId AND classusers.classId = classroom.id WHERE users.id = classroom.owner OR classusers.studentId IS NOT NULL",
                [key],
                (err, dbClassUsers) => {
                    try {
                        if (err) throw err;

                        if (!dbClassUsers) {
                            resolve({ error: "class does not exist" });
                            return;
                        }

                        resolve(dbClassUsers);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });

        if (dbClassUsers.error) return dbClassUsers;

        // Create an object to store the class users
        let classUsers = {};
        let cDClassUsers = {};
        let classId = await getClassIDFromCode(key);

        // Use classStateStore directly instead of proxy helper functions
        const cdClassroom = classId ? classStateStore.getClassroom(classId) : null;
        if (cdClassroom) {
            cDClassUsers = cdClassroom.students || {};
        }

        // For each user in the class
        for (let userRow of dbClassUsers) {
            // Add the user to the class users object
            classUsers[userRow.email] = {
                loggedIn: false,
                ...userRow,
                help: null,
                break: null,
                pogMeter: 0,
            };

            // If the user is logged in
            let cdUser = cDClassUsers[userRow.email];
            if (cdUser) {
                // Update the user's data with the data from the class
                classUsers[userRow.email].loggedIn = true;
                classUsers[userRow.email].help = cdUser.help;
                classUsers[userRow.email].break = cdUser.break;
                classUsers[userRow.email].pogMeter = cdUser.pogMeter;
            }

            // If the user has mod permissions or lower
            if (classPermissions <= MOD_PERMISSIONS) {
                // Update the user's help and break data
                if (classUsers[userRow.email].help) {
                    classUsers[userRow.email].help = true;
                }

                if (typeof classUsers[userRow.email].break == "string") {
                    classUsers[userRow.email].break = false;
                }
            }

            // If the user has student permissions or lower
            if (classPermissions <= STUDENT_PERMISSIONS) {
                // Remove the user's permissions, class permissions, help, break, quiz score, and pog meter data
                delete classUsers[userRow.email].permissions;
                delete classUsers[userRow.email].classPermissions;
                delete classUsers[userRow.email].help;
                delete classUsers[userRow.email].break;
                delete classUsers[userRow.email].pogMeter;
            }
        }

        // Return the class users
        return classUsers;
    } catch (err) {
        // If an error occurs, return the error
        return err;
    }
}

function getClassIDFromCode(code) {
    const cachedClassId = classCodeCacheStore.get(code);
    if (cachedClassId) {
        return cachedClassId;
    }

    return new Promise((resolve, reject) => {
        database.get("SELECT id FROM classroom WHERE key = ?", [code], (err, classroom) => {
            if (err) {
                reject(err);
                return;
            }

            if (!classroom) {
                resolve(null);
                return;
            }

            classCodeCacheStore.set(code, classroom.id);
            resolve(classroom.id);
        });
    });
}

module.exports = {
    Classroom,
    classStateStore,
    getClassUsers,
    getClassIDFromCode,
};
