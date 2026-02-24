const { dbGetAll } = require("@modules/database");

async function getIpAccess(type) {
    const isWhitelist = type === "whitelist" ? 1 : 0;
    const ipList = await dbGetAll("SELECT id, ip FROM ip_access_list WHERE is_whitelist = ?", [isWhitelist]);
    return ipList.reduce((ips, ip) => {
        ips[ip.id] = ip;
        return ips;
    }, {});
}

module.exports = {
    getIpAccess,
};
