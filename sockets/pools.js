const { dbRun, dbGet } = require("@modules/database");
const pools = require("@services/digipog-service");

module.exports = {
    run(socket) {
        socket.on("poolAddMember", async (data) => {
            try {
                const { poolId, userId } = data;
                if (typeof poolId !== "number") {
                    return socket.emit("poolAddMemberResponse", { success: false, message: "Invalid pool ID." });
                }
                if (typeof userId !== "number" || userId <= 0) {
                    return socket.emit("poolAddMemberResponse", { success: false, message: "Invalid user ID." });
                }

                // Check if the current user owns this pool
                const isOwner = await pools.isUserOwner(socket.request.session.userId, poolId);
                if (!isOwner) {
                    return socket.emit("poolAddMemberResponse", { success: false, message: "You do not own this pool." });
                }

                // Check if the user exists
                const userToAdd = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
                if (!userToAdd) {
                    return socket.emit("poolAddMemberResponse", { success: false, message: "User not found." });
                }

                // Check if user is already in the pool
                const isInPool = await pools.isUserInPool(userId, poolId);
                if (isInPool) {
                    return socket.emit("poolAddMemberResponse", { success: false, message: "User is already a member of this pool." });
                }

                // Add the user as a member (owner flag = 0)
                await pools.addUserToPool(poolId, userId, 0);

                return socket.emit("poolAddMemberResponse", { success: true, message: "User added to pool successfully." });
            } catch (err) {
                return socket.emit("poolAddMemberResponse", { success: false, message: "An error occurred while adding the user." });
            }
        });

        socket.on("poolRemoveMember", async (data) => {
            try {
                const { poolId, userId } = data;
                if (typeof poolId !== "number") {
                    return socket.emit("poolRemoveMemberResponse", { success: false, message: "Invalid pool ID." });
                }
                if (typeof userId !== "number" || userId <= 0) {
                    return socket.emit("poolRemoveMemberResponse", { success: false, message: "Invalid user ID." });
                }

                // Check if the current user owns this pool
                const isOwner = await pools.isUserOwner(socket.request.session.userId, poolId);
                if (!isOwner) {
                    return socket.emit("poolRemoveMemberResponse", { success: false, message: "You do not own this pool." });
                }

                // Check if the target user is in the pool
                const isInPool = await pools.isUserInPool(userId, poolId);
                if (!isInPool) {
                    return socket.emit("poolRemoveMemberResponse", { success: false, message: "User is not a member of this pool." });
                }

                // Remove the user from the pool
                await pools.removeUserFromPool(poolId, userId);

                return socket.emit("poolRemoveMemberResponse", { success: true, message: "User removed from pool successfully." });
            } catch (err) {
                return socket.emit("poolRemoveMemberResponse", { success: false, message: "An error occurred while removing the user." });
            }
        });

        socket.on("poolPayout", async (data) => {
            try {
                const { poolId } = data;
                if (typeof poolId !== "number" || poolId < 0) {
                    return socket.emit("poolPayoutResponse", { success: false, message: "Invalid pool ID." });
                }

                // Check if the current user owns this pool
                const isOwner = await pools.isUserOwner(socket.request.session.userId, poolId);
                if (!isOwner) {
                    return socket.emit("poolPayoutResponse", { success: false, message: "You do not own this pool." });
                }

                // Get the pool
                const pool = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [poolId]);
                if (!pool) {
                    return socket.emit("poolPayoutResponse", { success: false, message: "Pool not found." });
                }

                // Get all members (owners and non-owners)
                const members = await pools.getUsersForPool(poolId);

                if (members.length === 0) {
                    return socket.emit("poolPayoutResponse", { success: false, message: "Pool has no members." });
                }

                const amountPerMember = Math.floor(pool.amount / members.length);

                // Pay out to each member
                for (const member of members) {
                    const user = await dbGet("SELECT * FROM users WHERE id = ?", [member.user_id]);
                    if (user) {
                        const newBalance = user.digipogs + amountPerMember;
                        await dbRun("UPDATE users SET digipogs = ? WHERE id = ?", [newBalance, member.user_id]);
                        await dbRun(
                            "INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            [pool.id, member.user_id, "pool", "user", amountPerMember, `Pool Payout`, Date.now()]
                        );
                    }
                }

                // Reset pool amount to 0
                await dbRun("UPDATE digipog_pools SET amount = 0 WHERE id = ?", [poolId]);

                return socket.emit("poolPayoutResponse", { success: true, message: "Pool payout successful." });
            } catch (err) {
                return socket.emit("poolPayoutResponse", { success: false, message: "An error occurred during payout." });
            }
        });
    },
};
