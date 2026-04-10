const { logger } = require("../../../modules/logger");
const { dbGet } = require("../../../modules/database");
const { getUserOwnedClasses, getUserJoinedClasses } = require("../../../modules/user/user");
const { MANAGER_PERMISSIONS } = require("../../../modules/permissions");

module.exports = {
    run(router) {
        // Gets classes that a user has joined
        router.get("/user/:id/classes", async (req, res) => {
            try {
                const userId = req.params.id;
                const user = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
                if (!user) {
                    return res.status(404).json({ error: "User not found" });
                }

                // Check if the user is a manager, or is the user themselves
                const isManager = req.session.user.permissions === MANAGER_PERMISSIONS;
                const isSelf = req.session.user.id == user.id;
                if (!isManager && !isSelf) {
                    return res.status(403).json({ error: "You do not have permission to view this user's classes." });
                }

                // Get owned classes
                const ownedClasses = await getUserOwnedClasses(user.email, req.session.user);

                // Get joined classes (with permissions != 0)
                let joinedClasses = await getUserJoinedClasses(userId);
                joinedClasses = joinedClasses.filter((classroom) => classroom.permissions !== 0);

                // Create a map to track classes and combine data
                const classesMap = new Map();

                // Add owned classes first (these are definitely owned)
                for (const ownedClass of ownedClasses) {
                    classesMap.set(ownedClass.id, {
                        id: ownedClass.id,
                        name: ownedClass.name,
                        key: ownedClass.key,
                        owner: ownedClass.owner,
                        isOwner: true,
                        permissions: 5, // Owner permissions
                        tags: ownedClass.tags != null ? ownedClass.tags.split(",") : [],
                    });
                }

                // Add joined classes (mark as not owned unless already in map as owned)
                for (const joinedClass of joinedClasses) {
                    if (!classesMap.has(joinedClass.id)) {
                        classesMap.set(joinedClass.id, {
                            id: joinedClass.id,
                            name: joinedClass.name,
                            isOwner: false,
                            permissions: joinedClass.permissions,
                        });
                    }
                }

                // Convert map to array
                const allClasses = Array.from(classesMap.values());

                res.status(200).json(allClasses);
            } catch (err) {
                logger.log("error", err.stack);
                res.status(500).json({ error: "There was a server error try again." });
            }
        });
    },
};
