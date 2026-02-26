// Support module aliases for importing
require("module-alias/register");

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const csv = require("csv-parser");

const itemsCSVPath = "./database/items.csv";

initializeDatabase();
function initializeDatabase() {
    new Promise((resolve) => {
        if (fs.existsSync("./database/database.db")) {
            console.log("Database already exists. Skipping initialization.");
            process.exit(1);
        }

        if (!fs.existsSync("./database/init.sql")) {
            console.log("SQL initialization file not found.");
            process.exit(1);
        }

        const initSQL = fs.readFileSync("./database/init.sql", "utf8");
        const database = new sqlite3.Database("./database/database.db");
        database.serialize(() => {
            database.run("BEGIN TRANSACTION");

            populateItemRegistry(database);

            // Execute initialization SQL
            database.exec(initSQL, (err) => {
                if (err) {
                    console.error("Error executing initialization SQL:", err);
                    database.run("ROLLBACK");
                    database.close();
                    process.exit(1);
                }

                database.run("COMMIT", (err) => {
                    if (err) {
                        console.error("Error committing initialization SQL:", err);
                        database.run("ROLLBACK");
                        database.close();
                        process.exit(1);
                    }

                    console.log("Database initialized successfully.");
                    resolve();
                });

                // Set flag to skip backup during init, then run the migrations
                process.env.SKIP_BACKUP = "true";
                require("./migrate.js");
            });
        });
    });
}

function populateItemRegistry(database) {
    const results = [];

    fs.createReadStream(itemsCSVPath)
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim()
        }))
        .on('data', (data) => {
            results.push({
                name: data.name,
                description: data.desc,
                stackSize: parseInt(data.stackSize),
            });
            console.log(`Read item from CSV`);
            console.log(data);
        })
        .on('end', () => {
            console.log(results);
            results.forEach((item) => {
                const {name, description, stackSize } = item;
                console.log(`Inserting item: ${name}`);
                database.run("INSERT INTO item_registry (name, description, stack_size) VALUES (?, ?, ?)", [name, description, stackSize], (err) => {
                    if (err) {
                        console.error("Error inserting item into database:", err);
                    }
                });
            });
        });
}


module.exports = {
    initializeDatabase,
};
