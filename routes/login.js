const { hash, compare } = require('../modules/crypto');
const { database } = require("../modules/database");
const { classInformation, getClassIDFromCode } = require("../modules/class");
const { logNumbers } = require("../modules/config");
const { logger } = require("../modules/logger");
const { Student } = require("../modules/student");
const { STUDENT_PERMISSIONS, MANAGER_PERMISSIONS, GUEST_PERMISSIONS } = require("../modules/permissions");
const { managerUpdate } = require("../modules/socketUpdates");
const { sendMail, limitStore, RATE_LIMIT } = require('../modules/mail.js');
const crypto = require('crypto');
const fs = require('fs');

// Regex to test if the username, password, and display name are valid
const usernameRegex = /^[a-zA-Z0-9_]{5,20}$/;
const passwordRegex = /^[a-zA-Z0-9!@#$%^&*()\-_+=\{\}\[\]<>,.:;'\"~?/\|\\]{5,20}$/;
const displayRegex = /^[a-zA-Z0-9_ ]{5,20}$/;

module.exports = {
    run(app) {
        app.get('/login', (req, res) => {
            try {
                // If the user is not logged in, render the login page
                if (req.session.email !== undefined) {
                    res.render('pages/message', {
                        message: 'You are already logged in.',
                        title: 'Login'
                    });
                    return;
                // If the session 
                } else if (!req.session.createData) {
                    logger.log('info', `[get /login] ip=(${req.ip}) session=(${JSON.stringify(req.session)})`)
                    res.render('pages/login', {
                        title: 'Login',
                        redirectURL: undefined
                    });
                    return;
                } else if (!req.query.code) { 
                    req.session.createData = undefined;
                    logger.log('info', `[get /login] ip=(${req.ip}) session=(${JSON.stringify(req.session)})`)
                    res.render('pages/login', {
                        title: 'Login',
                        redirectURL: undefined
                    });
                    return;
                } else {
                    // Assign the create data to a variable for easier access
                    const user = req.session.createData;
                    // If the codes don't match, wipe the create data and render a message saying the codes don't match
                    if (req.query.code !== user.newSecret) {
                        req.session.createData = undefined;
                        res.render('pages/message', {
                            message: 'Invalid verification code. Please try again.',
                            title: 'Error'
                        });
                        return;
                    };
                    database.run(
                        'INSERT INTO users(username, email, password, permissions, API, secret, displayName, verified) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            user.username,
                            user.email,
                            user.hashedPassword,
                            user.permissions,
                            user.newAPI,
                            user.newSecret,
                            user.displayName,
                            1
                        ], (err) => {
                            try {
                                if (err) throw err
                                logger.log('verbose', '[get /login] Added user to database')
                                // Find the user in which was just created to get the id of the user
                                database.get('SELECT * FROM users WHERE username=?', [user.username], (err, userData) => {
                                    try {
                                        if (err) throw err;
                                        classInformation.users[userData.username] = new Student(
                                            userData.username,
                                            userData.id,
                                            userData.permissions,
                                            userData.API,
                                            [],
                                            [],
                                            userData.tags,
                                            userData.displayName,
                                            false
                                        );
                                        // Add the user to the session in order to transfer data between each page
                                        req.session.userId = userData.id
                                        req.session.username = userData.username
                                        req.session.classId = null
                                        req.session.displayName = userData.displayName;
                                        req.session.email = userData.email;
                                        req.session.verified = 1
                    
                                        logger.log('verbose', `[post /login] session=(${JSON.stringify(req.session)})`)
                                        logger.log('verbose', `[post /login] classInformation=(${JSON.stringify(classInformation)})`)
                    
                                        managerUpdate()
                    
                                        res.redirect('/')
                                        return;
                                    } catch (err) {
                                        logger.log('error', err.stack);
                                        res.render('pages/message', {
                                            message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                            title: 'Error'
                                        });
                                        return;
                                    };
                                });
                            } catch (err) {
                                // Handle the same email being used for multiple accounts
                                if (err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE constraint failed: users.email')) {
                                    logger.log('verbose', '[post /login] Email already exists')
                                    res.render('pages/message', {
                                        message: 'A user with that email already exists.',
                                        title: 'Login'
                                    });
                                    return;
                                }
                    
                                // Handle other errors
                                logger.log('error', err.stack);
                                res.render('pages/message', {
                                    message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                    title: 'Error'
                                })
                                return;
                            };
                        });
                };
            } catch (err) {
                logger.log('error', err.stack);
                res.render('pages/message', {
                    message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                    title: 'Error'
                })
            }
        })

        // This lets the user log into the server, it uses each element from the database to allow the server to do so
        // This lets users actually log in instead of not being able to log in at all
        // It uses the usernames, passwords, etc. to verify that it is the user that wants to log in logging in
        // This also hashes passwords to make sure people's accounts don't get hacked
        app.post('/login', (req, res) => {
            try {
                const user = {
                    username: req.body.username,
                    password: req.body.password,
                    email: req.body.email,
                    loginType: req.body.loginType,
                    userType: req.body.userType,
                    displayName: req.body.displayName
                };
                logger.log('info', `[post /login] ip=(${req.ip}) session=(${JSON.stringify(req.session)}`)
                logger.log('verbose', `[post /login] username=(${user.username}) password=(${Boolean(user.password)}) loginType=(${user.loginType}) userType=(${user.userType})`)

                // Check whether user is logging in or signing up
                if (user.loginType == 'login') {
                    logger.log('verbose', '[post /login] User is logging in')

                    // Get the users login in data to verify password
                    database.get('SELECT users.*, CASE WHEN shared_polls.pollId IS NULL THEN json_array() ELSE json_group_array(DISTINCT shared_polls.pollId) END as sharedPolls, CASE WHEN custom_polls.id IS NULL THEN json_array() ELSE json_group_array(DISTINCT custom_polls.id) END as ownedPolls FROM users LEFT JOIN shared_polls ON shared_polls.userId = users.id LEFT JOIN custom_polls ON custom_polls.owner = users.id WHERE users.username=?', [user.username], async (err, userData) => {
                        try {
                            // Check if a user with that name was not found in the database
                            if (!userData.username) {
                                logger.log('verbose', '[post /login] User does not exist')
                                res.render('pages/message', {
                                    message: 'No user found with that username.',
                                    title: 'Login'
                                });
                                return;
                            };
                            if (!userData.displayName) {
                                database.run("UPDATE users SET displayName = ? WHERE username = ?", [userData.username, userData.username]), (err) => {
                                    try {
                                        if (err) throw err;
                                        logger.log('verbose', '[post /login] Added displayName to database');
                                    } catch (err) {
                                        logger.log('error', err.stack);
                                        res.render('pages/message', {
                                            message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                            title: 'Error'
                                        });
                                    };
                                };
                            };
                            // Compare password hashes and check if it is correct
                            const passwordMatches = await compare(user.password, userData.password);
                            if (!passwordMatches) {
                                logger.log('verbose', '[post /login] Incorrect password')
                                res.render('pages/message', {
                                    message: 'Incorrect password',
                                    title: 'Login'
                                })
                                return
                            }

                            let loggedIn = false
                            let classId = ''

                            for (let classData of Object.values(classInformation.classrooms)) {
                                if (classData.key) {
                                    for (let username of Object.keys(classData.students)) {
                                        if (username == userData.username) {
                                            loggedIn = true
                                            classId = classData.id
                                            break
                                        }
                                    }
                                }
                            }

                            if (loggedIn) {
                                logger.log('verbose', '[post /login] User is already logged in')
                                req.session.classId = classId
                            } else {
                                classInformation.users[userData.username] = new Student(
                                    userData.username,
                                    userData.id,
                                    userData.permissions,
                                    userData.API,
                                    JSON.parse(userData.ownedPolls),
                                    JSON.parse(userData.sharedPolls),
                                    userData.tags,
                                    userData.displayName,
                                    false
                                )

                                req.session.classId = null;
                            }

                            // Add a cookie to transfer user credentials across site
                            req.session.userId = userData.id;
                            req.session.username = userData.username;
                            req.session.tags = userData.tags;
                            req.session.displayName = userData.displayName;
                            req.session.verified = userData.verified;
                            req.session.email = userData.email;

                            logger.log('verbose', `[post /login] session=(${JSON.stringify(req.session)})`)
                            logger.log('verbose', `[post /login] classInformation=(${JSON.stringify(classInformation)})`)

                            res.redirect('/')
                        } catch (err) {
                            logger.log('error', err.stack);
                            res.render('pages/message', {
                                message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                title: 'Error'
                            })
                        }
                    })
                } else if (user.loginType == 'new') {
                    // Check if the username, password, and display name are valid
                    if (!usernameRegex.test(user.username) || !passwordRegex.test(user.password) || !displayRegex.test(user.displayName)) {
                        logger.log('verbose', '[post /login] Invalid data provided to create new user');
                        res.render('pages/message', {
                            message: 'Invalid username, password, or display name. Please try again.',
                            title: 'Login'
                        });
                        return;
                    }

                    // Trim whitespace from email
                    user.email = user.email.trim()

                    logger.log('verbose', '[post /login] Creating new user')
                    let permissions = STUDENT_PERMISSIONS
                    database.all('SELECT API, secret, username FROM users', async (err, users) => {
                        try {
                            if (err) throw err

                            let existingAPIs = []
                            let existingSecrets = []
                            let newAPI
                            let newSecret

                            if (users.length == 0) permissions = MANAGER_PERMISSIONS

                            for (let dbUser of users) {
                                existingAPIs.push(dbUser.API)
                                existingSecrets.push(dbUser.secret)
                                if (dbUser.username == user.username) {
                                    logger.log('verbose', '[post /login] User already exists')
                                    res.render('pages/message', {
                                        message: 'A user with that username already exists.',
                                        title: 'Login'
                                    })
                                    return
                                }
                            }

                            do {
                                newAPI = crypto.randomBytes(64).toString('hex')
                            } while (existingAPIs.includes(newAPI))

                            do {
                                newSecret = crypto.randomBytes(256).toString('hex')
                            } while (existingSecrets.includes(newSecret))

                            // Hash the provided password
                            const hashedPassword = await hash(user.password);

                            if (!fs.existsSync('.env')) {
                                user.newAPI = newAPI;
                                user.newSecret = newSecret;
                                user.hashedPassword = hashedPassword;
                                user.permissions = permissions;
                                database.run(
                                    'INSERT INTO users(username, email, password, permissions, API, secret, displayName, verified) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
                                    [
                                        user.username,
                                        user.email,
                                        user.hashedPassword,
                                        user.permissions,
                                        user.newAPI,
                                        user.newSecret,
                                        user.displayName,
                                        1
                                    ], (err) => {
                                        try {
                                            if (err) throw err
                                            logger.log('verbose', '[get /login] Added user to database')
                                            // Find the user in which was just created to get the id of the user
                                            database.get('SELECT * FROM users WHERE username=?', [user.username], (err, userData) => {
                                                try {
                                                    if (err) throw err;
                                                    classInformation.users[userData.username] = new Student(
                                                        userData.username,
                                                        userData.id,
                                                        userData.permissions,
                                                        userData.API,
                                                        [],
                                                        [],
                                                        userData.tags,
                                                        userData.displayName,
                                                        false
                                                    );
                                                    // Add the user to the session in order to transfer data between each page
                                                    req.session.userId = userData.id
                                                    req.session.username = userData.username
                                                    req.session.classId = null
                                                    req.session.displayName = userData.displayName;
                                                    req.session.email = userData.email;
                                                    req.session.verified
                                
                                                    logger.log('verbose', `[post /login] session=(${JSON.stringify(req.session)})`)
                                                    logger.log('verbose', `[post /login] classInformation=(${JSON.stringify(classInformation)})`)
                                
                                                    managerUpdate()
                                
                                                    res.redirect('/')
                                                    return;
                                                } catch (err) {
                                                    logger.log('error', err.stack);
                                                    res.render('pages/message', {
                                                        message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                                        title: 'Error'
                                                    });
                                                    return;
                                                };
                                            });
                                        } catch (err) {
                                            // Handle the same email being used for multiple accounts
                                            if (err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE constraint failed: users.email')) {
                                                logger.log('verbose', '[post /login] Email already exists')
                                                res.render('pages/message', {
                                                    message: 'A user with that email already exists.',
                                                    title: 'Login'
                                                });
                                                return;
                                            }
                                
                                            // Handle other errors
                                            logger.log('error', err.stack);
                                            res.render('pages/message', {
                                                message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                                title: 'Error'
                                            })
                                            return;
                                        };
                                    });
                                return;
                            };
                            // Set the creation data for the user
                            req.session.createData = user;
                            req.session.createData.newAPI = newAPI;
                            req.session.createData.newSecret = newSecret;
                            req.session.createData.hashedPassword = hashedPassword;
                            req.session.createData.permissions = permissions;
                            // Process LOCATION from the .env file
                            const location = process.env.LOCATION;
                            // Create the HTML content for the email
                            const html = `
                            <h1>Verify your email</h1>
                            <p>Click the link below to verify your email address with Formbar</p>
                                <a href='${location}/login?code=${newSecret}'>Verify Email</a>
                            `;
                            // Send the email
                            sendMail(user.email, 'Formbar Verification', html);
                            if (limitStore.has(user.email) && (Date.now() - limitStore.get(user.email) < RATE_LIMIT)) {
                                res.render('pages/message', {
                                    message: `Email has been rate limited. Please wait ${Math.ceil((limitStore.get(user.email) + RATE_LIMIT - Date.now())/1000)} seconds.`,
                                    title: 'Verification'
                                });
                            } else {
                                res.render('pages/message', {
                                    message: 'Verification email sent. Please check your email. Please close this tab.',
                                    title: 'Verification'
                                });
                            };
                        } catch (err) {
                            logger.log('error', err.stack);
                            res.render('pages/message', {
                                message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                                title: 'Error'
                            })
                        }
                    })
                } else if (user.loginType == 'guest') {
                    if (user.displayName.trim() == '') {
                        logger.log('verbose', '[post /login] Invalid display name provided to create guest user');
                        res.render('pages/message', {
                            message: 'Invalid display name. Please try again.',
                            title: 'Login'
                        });
                        return;
                    }
                    logger.log('verbose', '[post /login] Logging in as guest');

                    // Create a temporary guest user
                    const username = 'guest' + crypto.randomBytes(4).toString('hex');
                    const userData = {
                        username,
                        id: username,
                        email: null,
                        tags: [],
                        displayName: user.displayName,
                        verified: false
                    };

                    classInformation.users[userData.username] = new Student(
                        username, // Username
                        userData.id, // Id
                        GUEST_PERMISSIONS,
                        null, // API key
                        [], // Owned polls
                        [], // Shared polls
                        [], // Tags
                        user.displayName,
                        true
                    );

                    // Set their current class to no class
                    req.session.classId = null;

                    // Add a cookie to transfer user credentials across site
                    req.session.userId = userData.id;
                    req.session.username = userData.username;
                    req.session.email = userData.email;
                    req.session.tags = userData.tags;
                    req.session.displayName = userData.displayName;
                    req.session.verified = userData.verified;
                    res.redirect('/');
                }
            } catch (err) {
                logger.log('error', err.stack);
                res.render('pages/message', {
                    message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                    title: 'Error'
                })
            }
        })

    }
}